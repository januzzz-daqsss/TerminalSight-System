"""Local camera ownership and bounded operational monitoring. No import-time workers."""
from contextlib import closing, ExitStack
from collections import deque
import hashlib
import json
from pathlib import Path
import sqlite3
import threading
import time
import logging
import cv2
from uuid import uuid4
from flask import Blueprint, Response, jsonify, request, stream_with_context

from backend.cameras.roi_catalog import mapping, validate_labels
from backend.cameras.sample_ai import MAPPINGS
from backend.detection.roi_config import load_roi
from backend.cameras.camera_inference import FairInferenceExecutor

LOGGER = logging.getLogger(__name__)
FRESH_SECONDS = 15


class CameraRecord:
    def __init__(self, spec):
        self.spec = spec
        self.instance = uuid4().hex
        self.stop = threading.Event()
        self.condition = threading.Condition(threading.RLock())
        self.thread = None
        self.jpeg = None
        self.sequence = 0
        self.generation = 0
        self.last_frame = self.last_result = None
        self.state = 'Starting'
        self.error = None
        self.completions = deque(maxlen=100)
        self.started = time.monotonic()
        self.streams = 0

    def health(self):
        with self.condition:
            now = time.monotonic()
            healthy = (not self.stop.is_set() and self.last_frame is not None and self.last_result is not None
                       and now - self.last_frame < 10 and now - self.last_result < FRESH_SECONDS)
            state = self.state if healthy or self.state != 'Live' else 'Unstable'
            return dict(id=self.spec['id'], instance=self.instance, name=self.spec['name'], bays=self.spec['bays'], state=state,
                        message=self.error, healthy=healthy, generation=self.generation,
                        inferenceFps=round(sum(now - t <= 5 for t in self.completions) / max(1, min(5, now - self.started)), 2),
                        notificationId=self.spec['notificationId'], legacy=self.spec['legacy'])

    def rewind(self, occupancy, ocr):
        with self.condition:
            self.generation += 1
            self.last_result = None
            self.jpeg = None
            self.state = 'Starting'
            occupancy.clear(self.spec['bays'])
            if ocr:
                ocr.discard(self.spec['bays'])


class CameraManager:
    def __init__(self, root, database, occupancy, runner, ocr=None):
        self.root, self.database = Path(root), Path(database)
        self.occupancy, self.runner, self.ocr = occupancy, runner, ocr
        self.lock = threading.RLock()
        self.records, self.errors = {}, {}
        self.paused = set()
        self.closed = threading.Event()
        self.thread = None
        # Every capture may queue ONE job. FIFO plus one model consumer prevents
        # a fast camera overtaking another; bay ownership bounds captures to ten.
        self.executor = FairInferenceExecutor(capacity=10)
        self.configuration_error = None

    def _specs(self):
        rows = []
        if self.database.is_file():
            with closing(sqlite3.connect(self.database.as_uri() + '?mode=ro', uri=True, timeout=.2)) as conn:
                if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='feeds'").fetchone():
                    rows = conn.execute('SELECT rowid, id, configuration FROM feeds ORDER BY rowid LIMIT 100').fetchall()
        candidates, errors, claimed = {}, {}, set()
        for number, identifier, raw in rows:
            bays = []
            try:
                feed = json.loads(raw)
                if not isinstance(feed, dict):
                    raise ValueError('Invalid saved feed record.')
                if feed.get('kind') != 'sample':
                    continue  # RTSP remains configuration-only.
                original = MAPPINGS.get(feed.get('videoId'))
                roi_id = feed.get('roiId', Path(original[0]).name if original else '')
                if not roi_id:
                    continue  # Explicitly unmapped recordings stay playback-only.
                bays = [f'Bay_{n}' for n in feed['bays'] if type(n) is int and 1 <= n <= 10]
                if original and 'roiId' not in feed:
                    bays = list(original[1])
                selected = mapping(self.root, feed['videoId'], roi_id)
                if 'roiId' in feed:
                    validate_labels(feed, selected)
                video = self.root / 'public' / feed['videoId']
                roi_path = self.root / 'config/roi' / roi_id
                roi = load_roi(roi_path, video, selected['roi']['width'], selected['roi']['height'], root=self.root)
                bays = list(roi.polygons)
                if set(bays) & claimed:
                    raise ValueError('Bay conflict: another configured feed owns one or more selected bays.')
                claimed.update(bays)
                stat = video.stat()
                revision = (feed['videoId'], hashlib.sha256(roi_path.read_bytes()).hexdigest(), stat.st_size, stat.st_mtime_ns)
                candidates[identifier] = dict(id=identifier, name=feed['name'], direction=selected['direction'],
                    bays=bays, video=str(video), roi=roi, revision=revision, notificationId=number + 2, legacy=False)
            except (ValueError, OSError, KeyError, TypeError, cv2.error):
                # Invalid mappings do not make their bays appear monitored by an
                # unrelated legacy recording. Do not leak absolute paths/errors.
                conflict = bool(set(bays) & claimed)
                claimed.update(bays)
                errors[identifier] = dict(id=identifier, name='Configured sample feed', bays=bays,
                    state='Conflict' if conflict else 'Invalid', healthy=False, inferenceFps=0, generation=0,
                    message='Bay ownership conflict. Edit or remove the overlapping feed.' if conflict else 'Recording/ROI is missing or invalid. Check the selected mapping and bay labels.',
                    notificationId=number + 2, legacy=False)
        for identifier, number, bay, filename in (
            ('northbound', 1, 'Bay_1', 'sample-VID_20260604_131402.mp4'),
            ('southbound', 2, 'Bay_6', 'sample-VID_20260604_133427.mp4')):
            if bay not in claimed:
                candidates[identifier] = dict(id=identifier, name=f'{identifier.title()} Cam 1', direction=identifier,
                    bays=[bay], video=str(self.root / 'public/sample-videos' / filename), roi=None,
                    revision=('legacy', filename), notificationId=number, legacy=True)
        return candidates, errors

    def _stop(self, identifier):
        record = self.records[identifier]
        record.stop.set()
        with record.condition:
            record.condition.notify_all()
        record.thread.join(timeout=3)
        if record.thread.is_alive():
            raise RuntimeError('Previous camera is still stopping; ownership retained.')
        self.occupancy.clear(record.spec['bays'])
        if self.ocr:
            self.ocr.discard(record.spec['bays'])
        del self.records[identifier]

    def reconcile(self):
        with self.lock:
            if self.closed.is_set():
                return
            try:
                desired, errors = self._specs()
            except (sqlite3.Error, OSError):
                self.configuration_error = 'Feed configuration cannot be read; existing workers retained.'
                return
            self.configuration_error = None
            self.errors = errors
            for identifier, record in list(self.records.items()):
                spec = desired.get(identifier)
                if identifier in self.paused or spec is None or spec['revision'] != record.spec['revision']:
                    self._stop(identifier)
                elif spec:
                    record.spec['name'] = spec['name']
            for identifier, spec in desired.items():
                if identifier in self.records:
                    continue
                if identifier in self.paused:
                    self.errors[identifier] = dict(id=identifier, name=spec['name'], bays=spec['bays'], state='Stopped',
                        healthy=False, message='Stopped by local administrator.', inferenceFps=0, generation=0,
                        notificationId=spec['notificationId'], legacy=spec['legacy'])
                    continue
                record = CameraRecord(spec)
                self.records[identifier] = record
                self.occupancy.clear(spec['bays'])
                record.thread = threading.Thread(target=self._run, args=(record,), name=f'camera-{identifier[:12]}', daemon=True)
                record.thread.start()

    def _run(self, record):
        try:
            self.runner(record.spec['video'], record.spec['direction'], record.stop,
                        roi=record.spec['roi'], operational=record, executor=self.executor)
        except Exception:
            LOGGER.exception('Operational camera failed')
            with record.condition:
                record.state, record.error = 'Disconnected', 'Camera worker failed. Restart the feed after checking local resources.'

    def start(self):
        self.reconcile()
        self.thread = threading.Thread(target=self._watch, name='camera-manager', daemon=True)
        self.thread.start()

    def _watch(self):
        while not self.closed.wait(2):
            try:
                self.reconcile()
            except Exception:
                LOGGER.exception('Camera reconciliation delayed')
                self.configuration_error = 'Camera update delayed while a previous worker stops.'

    def control(self, identifier, action):
        with self.lock:
            if identifier not in self.records and identifier not in self.errors:
                raise KeyError(identifier)
            if action == 'stop':
                self.paused.add(identifier)
            elif action == 'restart':
                self.paused.discard(identifier)
            else:
                raise ValueError('Choose stop or restart.')
            if identifier in self.records:
                self._stop(identifier)
            self.reconcile()

    def status(self):
        with self.lock:
            return dict(feeds=[r.health() for r in self.records.values()] + list(self.errors.values()),
                        message=self.configuration_error, historyError=self.occupancy.history_error)

    def bay_snapshot(self):
        with self.lock, ExitStack() as locks:
            # Rewind takes the same record lock before clearing occupancy. Read
            # health and occupancy together so a loop cannot masquerade as empty.
            for record in self.records.values():
                locks.enter_context(record.condition)
            owners = {bay: r.health() for r in self.records.values() for bay in r.spec['bays']}
            rows = self.occupancy.snapshot()
            for row in rows:
                owner = owners.get(f"Bay_{row['id']}")
                row.update(monitored=bool(owner and owner['healthy']), cameraId=owner['id'] if owner else None,
                           observationEpoch=f"{owner['instance']}:{owner['generation']}" if owner else None)
                if not row['monitored']:
                    row.update(status='Unmonitored', vehicleType=None, route=None, routeDetails=[], ocrState=None,
                               ocrConfidence=None, timeRemaining=None, sessionId=None, elapsedSeconds=0)
            return rows

    def stream(self, identifier):
        with self.lock:
            record = self.records.get(identifier)
            if not record:
                raise KeyError(identifier)
        def frames():
            with record.condition:
                if record.streams >= 3:
                    return
                record.streams += 1
            try:
                sequence = -1
                while not record.stop.is_set():
                    with record.condition:
                        record.condition.wait_for(lambda: record.stop.is_set() or record.sequence != sequence, timeout=2)
                        if record.stop.is_set():
                            return
                        sequence, jpeg, generation = record.sequence, record.jpeg, record.generation
                    if jpeg:
                        yield (f'--frame\r\nContent-Type: image/jpeg\r\nContent-Length: {len(jpeg)}\r\nX-Generation: {generation}\r\n\r\n'.encode() + jpeg + b'\r\n')
            finally:
                with record.condition:
                    record.streams -= 1
        return frames()

    def close(self):
        self.closed.set()
        if self.thread:
            self.thread.join(timeout=3)
        with self.lock:
            for identifier in list(self.records):
                try:
                    self._stop(identifier)
                except RuntimeError:
                    LOGGER.error('Camera decoder is still stopping; no replacement started')
        self.executor.shutdown(wait=False, cancel_futures=True)


def create_operational_blueprint(authorize, manager):
    bp = Blueprint('operational_cameras', __name__)

    @bp.before_request
    def protect():
        denied = authorize()
        if denied is not None:
            return denied
        if manager() is None:
            return jsonify(message='Operational monitoring is disabled. Restart the backend with AI enabled.'), 503

    @bp.after_request
    def private(response):
        response.headers['Cache-Control'] = 'no-store'
        return response

    @bp.get('/api/operational-cameras')
    def status():
        return jsonify(manager().status())

    @bp.post('/api/operational-cameras/<identifier>')
    def control(identifier):
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or set(data) != {'action'} or data['action'] not in ('stop', 'restart'):
            return jsonify(message='Choose stop or restart.'), 400
        try:
            manager().control(identifier, data['action'])
            return jsonify(manager().status())
        except KeyError:
            return jsonify(message='Camera no longer exists.'), 404
        except RuntimeError:
            return jsonify(message='Previous worker is stopping. Retry shortly.'), 409

    @bp.get('/api/operational-cameras/<identifier>/stream')
    def stream(identifier):
        try:
            frames = manager().stream(identifier)
        except KeyError:
            return jsonify(message='Camera is not running.'), 404
        @stream_with_context
        def guarded():
            checked = time.monotonic()
            try:
                for frame in frames:
                    if time.monotonic() - checked > 30:
                        if authorize() is not None:
                            return
                        checked = time.monotonic()
                    yield frame
            finally:
                frames.close()
        return Response(guarded(), mimetype='multipart/x-mixed-replace; boundary=frame')

    return bp
