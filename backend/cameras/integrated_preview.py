"""Single diagnostic playback timeline. No operational state or model lifecycle writes."""
import atexit
from concurrent.futures import ThreadPoolExecutor
from collections import deque
import hashlib
import json
import math
from pathlib import Path
import sqlite3
import threading
import time
from uuid import uuid4

import cv2
from flask import Blueprint, Response, jsonify, request
from backend.detection.roi_config import load_roi
from backend.detection.detector import assign_detections
from backend.cameras.sample_ai import MAPPINGS

PILOT = 'sample-CCTV/Bays 1-2.mp4'
FRESH_SECONDS = 2.0
BOX_SECONDS = .35
LEASE_SECONDS = 20.0


def freshness(result, generation, seconds, now):
    valid = bool(result and result['generation'] == generation
                 and 0 <= now - result['submitted'] <= FRESH_SECONDS
                 and 0 <= seconds - result['seconds'] <= FRESH_SECONDS)
    boxes = valid and seconds - result['seconds'] <= BOX_SECONDS
    return valid, boxes


def render_overlay(frame, roi, result, generation, seconds, now):
    image = frame.copy()
    valid, boxes = freshness(result, generation, seconds, now)
    scale = max(1., frame.shape[1] / 1200)
    for bay, points in roi.arrays.items():
        state = result['states'][bay] if valid else 'UNKNOWN'
        color = {'AVAILABLE': (94, 197, 34), 'OCCUPIED': (68, 68, 239)}.get(state, (184, 163, 148))
        cv2.polylines(image, [points], True, color, max(2, round(2 * scale)))
        anchor = tuple(points.mean(axis=0).astype(int))
        cv2.putText(image, f'{bay}: {state}', anchor, cv2.FONT_HERSHEY_SIMPLEX, .55 * scale, color, 2)
    if boxes:
        for item in result['detections']:
            x1, y1, x2, y2 = map(int, item['bbox'])
            cv2.rectangle(image, (x1, y1), (x2, y2), (246, 130, 59), max(2, round(2 * scale)))
            confidence = item.get('confidence')
            label = item['vehicle_type'] + (f' {confidence:.0%}' if confidence is not None else '')
            cv2.putText(image, label, (max(0, x1), max(25, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, .6 * scale, (246, 130, 59), 2)
    return image, valid


class PreviewSession:
    def __init__(self, owner, capture, roi, frame, fps, count):
        self.id, self.owner = uuid4().hex, owner
        self.cap, self.roi, self.frame = capture, roi, frame
        self.fps, self.count = fps, count
        self.position, self.generation = 0, 0
        self.paused, self.loop = False, True
        self.seek_to = None
        self.result, self.jpeg = None, None
        self.sequence = 0
        self.jpeg_generation = 0
        self.status = 'AI loading'
        self.selection = None
        self.touched = time.monotonic()
        self.stop = threading.Event()
        self.condition = threading.Condition(threading.RLock())
        self.thread = None
        self.streaming = False
        self.completions = deque(maxlen=100)
        self.started = time.monotonic()

    def reset(self):
        self.generation += 1
        self.result, self.jpeg = None, None
        self.status = 'AI loading'

    def snapshot(self):
        now = time.monotonic()
        valid, _ = freshness(self.result, self.generation, self.position / self.fps, now)
        recent = [stamp for stamp in self.completions if now - stamp <= 5]
        return dict(id=self.id, generation=self.generation, seconds=self.position / self.fps,
                    duration=(self.count - 1) / self.fps, paused=self.paused, loop=self.loop,
                    status='AI active' if valid else self.status if self.status != 'AI active' else 'AI awaiting fresh result',
                    sourceFps=self.fps, inferenceFps=round(len(recent) / max(.5, min(5, now - self.started)), 2),
                    runtime=self.selection, stopped=self.stop.is_set())


class IntegratedPreview:
    def __init__(self, root, runtime, capture_factory=cv2.VideoCapture):
        self.root, self.runtime, self.capture_factory = Path(root), runtime, capture_factory
        self.lock = threading.RLock()
        self.session = None
        # One pending inference across session switches, including uncancellable native calls.
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='sample-preview-inference')
        self.future = None
        self.reaper = None
        self.closed = threading.Event()

    def _stop(self):
        session = self.session
        if not session:
            return
        session.stop.set()
        with session.condition:
            session.reset()
            session.condition.notify_all()
        session.thread.join(timeout=2)
        if session.thread.is_alive():
            raise RuntimeError('Previous decoder is still stopping. Try again shortly.')
        self.session = None

    def start(self, owner, video_id, roi_id):
        if not isinstance(video_id, str) or video_id not in MAPPINGS or not isinstance(roi_id, str) or Path(roi_id).name != roi_id or '/' in roi_id or '\\' in roi_id:
            raise ValueError('Choose an approved recording with a selected ROI JSON.')
        _, expected_bays, direction = MAPPINGS[video_id]
        with self.lock:
            if self.session and self.session.owner != owner and not self.session.stop.is_set():
                raise RuntimeError('Another local administrator owns the active preview.')
            self._stop()
            video = self.root / 'public' / video_id
            if video.resolve() != video.absolute() or not video.is_file():
                raise ValueError('Recording unavailable.')
            cap = self.capture_factory(str(video))
            try:
                fps, count = cap.get(cv2.CAP_PROP_FPS), cap.get(cv2.CAP_PROP_FRAME_COUNT)
                if not math.isfinite(fps) or not 1 <= fps <= 120 or not math.isfinite(count) or count < 1:
                    raise ValueError('Recording has unsupported timing.')
                ok, frame = cap.read()
                if not ok or frame is None:
                    raise ValueError('Recording cannot be decoded.')
                roi = load_roi(self.root / 'config/roi' / roi_id, video, int(frame.shape[1]), int(frame.shape[0]), root=self.root)
                if set(roi.polygons) != set(expected_bays) or any(value != direction for value in roi.directions.values()):
                    raise ValueError('ROI bay assignments do not match the approved recording.')
                session = PreviewSession(owner, cap, roi, frame, fps, int(count))
            except Exception:
                cap.release()
                raise
            self.session = session
            session.thread = threading.Thread(target=self._play, args=(session,), name='sample-preview-playback', daemon=True)
            session.thread.start()
            if self.reaper is None:
                self.reaper = threading.Thread(target=self._reap, name='sample-preview-lease', daemon=True)
                self.reaper.start()
            return session.snapshot()

    def _infer(self, frame, roi, generation, seconds, submitted):
        detections, selection = self.runtime.predict_diagnostic(frame)
        for item in detections:
            if item.get('vehicle_type') not in ('Bus', 'UV Express'):
                raise ValueError('Unsupported vehicle class.')
            if 'class_name' in item and item['vehicle_type'] != {'bus': 'Bus', 'uv': 'UV Express'}.get(item['class_name']):
                raise ValueError('Inconsistent vehicle classification.')
            if len(item.get('bbox', [])) != 4 or not all(math.isfinite(v) for v in item['bbox']):
                raise ValueError('Invalid detection box.')
            if item.get('confidence') is not None and (not math.isfinite(item['confidence']) or not 0 <= item['confidence'] <= 1):
                raise ValueError('Invalid confidence.')
        states, _ = assign_detections(detections, roi.polygons)
        return dict(generation=generation, seconds=seconds, submitted=submitted,
                    detections=detections, states=states, runtime=selection)

    def _play(self, s):
        future = None
        origin = time.monotonic()
        next_inference = 0.
        local_generation = s.generation
        try:
            while not s.stop.is_set():
                now = time.monotonic()
                with s.condition:
                    generation, paused = s.generation, s.paused
                    seek = s.seek_to
                    s.seek_to = None
                    if generation != local_generation:
                        origin = now - s.position / s.fps
                        local_generation = generation
                    target = s.position if paused else min(s.count - 1, int((now - origin) * s.fps))
                    if seek is not None:
                        target = seek
                        origin = now - target / s.fps
                    current = s.position
                if seek is not None or target != current:
                    if seek is not None or target < current or target - current > 10:
                        if not s.cap.set(cv2.CAP_PROP_POS_FRAMES, target):
                            raise ValueError('Video seeking failed.')
                    else:
                        for _ in range(target - current - 1):
                            if not s.cap.grab():
                                raise ValueError('Video decoding failed.')
                    ok, frame = s.cap.read()
                    if not ok or frame is None or frame.shape[:2] != (s.roi.height, s.roi.width):
                        raise ValueError('Video decoding failed.')
                    actual = s.cap.get(cv2.CAP_PROP_POS_FRAMES) - 1
                    if not math.isfinite(actual) or abs(actual - target) > 1:
                        raise ValueError('Decoder cannot locate the requested frame.')
                    with s.condition:
                        if generation != s.generation:
                            # A newer seek arrived while decoding; never publish this frame.
                            continue
                        s.frame, s.position = frame, int(actual)
                with s.condition:
                    if generation != s.generation or s.seek_to is not None:
                        continue
                    if future is not None and future.done():
                        try:
                            result = future.result()
                            if result['generation'] == s.generation:
                                s.result, s.selection = result, result['runtime']
                                s.status = 'AI active'
                                s.completions.append(time.monotonic())
                        except Exception:
                            # A brief busy result does not clear a still-fresh observation.
                            s.status = 'AI unavailable or busy; select YOLOv8 in AI Detection'
                        future = None
                    if (time.monotonic() >= next_inference and future is None
                            and (self.future is None or self.future.done())):
                        future = self.executor.submit(self._infer, s.frame.copy(), s.roi, s.generation,
                                                      s.position / s.fps, time.monotonic())
                        self.future = future
                        next_inference = time.monotonic() + .2
                    generation = s.generation
                    image, _ = render_overlay(s.frame, s.roi, s.result, generation, s.position / s.fps, time.monotonic())
                if image.shape[1] > 960:
                    image = cv2.resize(image, (960, round(image.shape[0] * 960 / image.shape[1])))
                ok, encoded = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 80])
                if not ok:
                    raise ValueError('Preview encoding failed.')
                with s.condition:
                    if generation == s.generation:
                        s.jpeg, s.jpeg_generation = encoded.tobytes(), generation
                        s.sequence += 1
                        s.condition.notify_all()
                    if not s.paused and s.position >= s.count - 1:
                        s.reset()
                        if s.loop:
                            s.seek_to = 0
                        else:
                            s.paused = True
                    # Work time is part of the source frame interval, not added to it.
                    delay = (1 / min(30, s.fps) if s.paused else
                             max(0, min(1 / min(30, s.fps), origin + (s.position + 1) / s.fps - time.monotonic())))
                s.stop.wait(delay)
        except Exception:
            with s.condition:
                s.status = 'Preview unavailable: check recording, mapping and local runtime'
                s.jpeg, s.result = None, None
        finally:
            s.stop.set()
            s.cap.release()
            with s.condition:
                s.condition.notify_all()

    def get(self, owner, identifier):
        s = self.session
        if not s or s.id != identifier or s.owner != owner:
            raise LookupError('Preview session no longer exists.')
        return s

    def control(self, owner, identifier, data):
        with self.lock:
            s = self.get(owner, identifier)
            with s.condition:
                action = data.get('action')
                if action not in ('pause', 'play', 'seek', 'restart', 'loop'):
                    raise ValueError('Unknown playback control.')
                expected = {'action', 'seconds'} if action == 'seek' else {'action', 'enabled'} if action == 'loop' else {'action'}
                if set(data) != expected:
                    raise ValueError('Unsupported playback fields.')
                if action == 'seek':
                    seconds = data.get('seconds')
                    if type(seconds) not in (int, float) or not math.isfinite(seconds) or not 0 <= seconds <= (s.count - 1) / s.fps:
                        raise ValueError('Seek is outside the recording.')
                    s.seek_to = round(seconds * s.fps)
                elif action == 'loop':
                    if type(data.get('enabled')) is not bool:
                        raise ValueError('Choose a loop setting.')
                    s.loop = data['enabled']
                elif action == 'restart':
                    s.seek_to, s.paused = 0, False
                else:
                    s.paused = action == 'pause'
                    s.seek_to = s.position
                if action != 'loop':
                    s.reset()
                s.touched = time.monotonic()
                return s.snapshot()

    def stop(self, owner, identifier):
        with self.lock:
            self.get(owner, identifier)
            self._stop()

    def _reap(self):
        while not self.closed.wait(2):
            with self.lock:
                if self.session and time.monotonic() - self.session.touched > LEASE_SECONDS:
                    try:
                        self._stop()
                    except RuntimeError:
                        pass

    def close(self):
        self.closed.set()
        with self.lock:
            try:
                self._stop()
            except RuntimeError:
                pass
        self.executor.shutdown(wait=False, cancel_futures=True)


def create_integrated_blueprint(authorize, root, feed_database, manager):
    bp = Blueprint('integrated_preview', __name__)

    @bp.before_request
    def protect():
        return authorize()

    @bp.after_request
    def private(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    def owner():
        return hashlib.sha256(request.headers.get('Authorization', '').encode()).hexdigest()

    @bp.errorhandler(ValueError)
    def invalid(error):
        return jsonify(message='Invalid recording, ROI association or playback control.'), 400

    @bp.errorhandler(LookupError)
    def missing(error):
        return jsonify(message='Preview session no longer exists.'), 404

    @bp.errorhandler(RuntimeError)
    def busy(error):
        return jsonify(message=str(error)), 409

    def body():
        if request.content_length is None or request.content_length > 2048:
            raise ValueError('Invalid body size.')
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            raise ValueError('Expected JSON object.')
        return data

    @bp.post('/api/sample-preview')
    def start():
        data = body()
        if set(data) != {'feedId'} or not isinstance(data['feedId'], str):
            raise ValueError('Choose a saved feed.')
        try:
            conn = sqlite3.connect(Path(feed_database()).resolve().as_uri() + '?mode=ro', uri=True)
            try:
                row = conn.execute('SELECT configuration FROM feeds WHERE id = ?', (data['feedId'],)).fetchone()
            finally:
                conn.close()
            if not row:
                raise LookupError()
            feed = json.loads(row[0])
            if feed['kind'] != 'sample' or feed['videoId'] not in MAPPINGS:
                raise ValueError('Choose an approved sample recording.')
            relative, expected_bays, direction = MAPPINGS[feed['videoId']]
            # Omitted ROI retains the reviewed pre-2A association; empty disables mapping.
            roi_id = feed.get('roiId', Path(relative).name)
            if 'roiId' in feed and (feed['direction'] != direction or sorted(feed['bays']) != sorted(int(bay[4:]) for bay in expected_bays)):
                raise ValueError('Feed labels differ from the recording mapping.')
            result = manager.start(owner(), feed['videoId'], roi_id)
            return jsonify(result), 201
        except (OSError, sqlite3.Error):
            return jsonify(message='Local feed configuration or recording unavailable.'), 503
        except (KeyError, TypeError):
            return jsonify(message='Saved feed configuration is invalid.'), 400

    @bp.get('/api/sample-preview/<identifier>')
    def status(identifier):
        with manager.lock:
            s = manager.get(owner(), identifier)
            with s.condition:
                s.touched = time.monotonic()  # Authenticated heartbeat owns the lease.
                return jsonify(s.snapshot())

    @bp.patch('/api/sample-preview/<identifier>')
    def control(identifier):
        return jsonify(manager.control(owner(), identifier, body()))

    @bp.delete('/api/sample-preview/<identifier>')
    def stop(identifier):
        manager.stop(owner(), identifier)
        return jsonify(stopped=True)

    @bp.get('/api/sample-preview/<identifier>/stream')
    def stream(identifier):
        with manager.lock:
            s = manager.get(owner(), identifier)
            with s.condition:
                if s.streaming:
                    raise RuntimeError('This session already has a stream.')
                s.streaming = True
        def chunks():
            previous = -1
            try:
                while not s.stop.is_set():
                    with s.condition:
                        s.condition.wait_for(lambda: s.stop.is_set() or (s.jpeg is not None and s.sequence != previous), timeout=1)
                        if s.stop.is_set():
                            break
                        if s.jpeg is None or s.sequence == previous:
                            continue
                        jpeg, generation, previous = s.jpeg, s.jpeg_generation, s.sequence
                    yield (f'--frame\r\nContent-Type: image/jpeg\r\nContent-Length: {len(jpeg)}\r\nX-Generation: {generation}\r\n\r\n'.encode()
                           + jpeg + b'\r\n')
            finally:
                s.stop.set()  # Disconnect stops only this capture, never the shared runtime.
                with s.condition:
                    s.streaming = False
                    s.condition.notify_all()
        return Response(chunks(), mimetype='multipart/x-mixed-replace; boundary=frame')

    atexit.register(manager.close)
    return bp
