"""Local, ephemeral sample diagnostics. Never imports operational server/state."""
import atexit
import base64
import hashlib
import json
import multiprocessing
from pathlib import Path
import threading
import time
import tempfile
from uuid import uuid4

from flask import Blueprint, jsonify, request

# Explicit, reviewed associations: filenames are identifiers, not bay definitions.
MAPPINGS = {
    'sample-CCTV/Bays 1-2.mp4': ('config/roi/bays-1-2.json', ('Bay_1', 'Bay_2'), 'northbound'),
    'sample-CCTV/Bays 2-5.mp4': ('config/roi/bays-2-5.json', ('Bay_3', 'Bay_4', 'Bay_5'), 'northbound'),
    'sample-CCTV/Bays 6-10.mp4': ('config/roi/bays-6-10.json', tuple(f'Bay_{n}' for n in range(6, 11)), 'southbound'),
}


def resolve_mapping(root, video_id):
    from tools.roi_mapper import validate_document
    root = Path(root).resolve()
    if not isinstance(video_id, str) or video_id not in MAPPINGS:
        raise ValueError('This recording has no approved ROI mapping.')
    relative, expected, direction = MAPPINGS[video_id]
    video = root / 'public' / video_id
    roi = root / relative
    for path in (video, roi):
        # Reject redirected files/directories as well as traversal.
        if path.resolve() != path.absolute() or not path.is_file():
            raise ValueError('Mapped video or ROI is missing or redirected.')
    if roi.stat().st_size > 65536:
        raise ValueError('ROI configuration is too large.')
    try:
        data = json.loads(roi.read_text(encoding='utf-8'))
        validate_document(data)
    except (ValueError, TypeError, KeyError) as exc:
        raise ValueError('Invalid saved ROI configuration.') from exc
    if (data['source_video'] != 'public/' + video_id or
            {b['id'] for b in data['bays']} != set(expected) or
            any(b['direction'] != direction for b in data['bays'])):
        raise ValueError('Saved ROI does not match its approved recording and bays.')
    return video, data


class PreviewError(Exception):
    def __init__(self, message, status=409):
        super().__init__(message)
        self.status = status


class PreviewManager:
    """One spawned worker per Flask process; one outstanding frame, 20s idle lease."""
    def __init__(self, root, context=None, clock=time.monotonic):
        self.root, self.context, self.clock = Path(root), context or multiprocessing.get_context('spawn'), clock
        self.lock, self.frame_lock = threading.RLock(), threading.Lock()
        self.session = None
        self.reaper_started = False

    def _stop(self):
        session, self.session = self.session, None
        if session:
            process = session['process']
            if process.is_alive():
                try:
                    session['pipe'].send({'stop': True})
                    process.join(timeout=1)
                except (OSError, EOFError):
                    pass
            if process.is_alive():
                process.terminate()
            process.join(timeout=2)
            if process.is_alive():
                process.kill()
                process.join(timeout=2)
            session['pipe'].close()
            process.close()
            # Parent owns scratch so forced worker termination cannot orphan it.
            session['scratch'].cleanup()

    def close(self):
        with self.lock:
            self._stop()

    def reap(self):
        with self.lock:
            if self.session and not self.session['busy'] and self.clock() - self.session['touched'] > 20:
                self._stop()

    def _reaper(self):
        while True:
            time.sleep(2)
            self.reap()

    def start(self, owner, video_id, method):
        if method not in ('ioa', 'ground'):
            raise ValueError('Choose IoA or Ground assignment.')
        resolve_mapping(self.root, video_id)
        with self.lock:
            self.reap()
            if self.session:
                raise PreviewError('Another AI preview is active. Stop it first, or wait for its idle timeout.')
            parent, child = self.context.Pipe()
            from backend.cameras.sample_ai_worker import run_preview
            scratch = tempfile.TemporaryDirectory(prefix='terminalsight-sample-ai-', ignore_cleanup_errors=True)
            if not Path(scratch.name).resolve().is_relative_to(Path(tempfile.gettempdir()).resolve()):
                raise RuntimeError('Preview scratch directory is outside the OS temporary directory.')
            process = self.context.Process(target=run_preview,
                args=(child, str(self.root), video_id, method, scratch.name), daemon=True)
            try:
                process.start()
            except Exception:
                parent.close()
                scratch.cleanup()
                raise PreviewError('Could not start the isolated preview worker.', 503) from None
            finally:
                child.close()
            identifier = uuid4().hex
            self.session = dict(id=identifier, owner=owner, pipe=parent, process=process,
                                touched=self.clock(), busy=False, scratch=scratch)
            if not self.reaper_started:
                threading.Thread(target=self._reaper, name='sample-ai-reaper', daemon=True).start()
                atexit.register(self.close)
                self.reaper_started = True
            return identifier

    def _owned(self, owner, identifier):
        if not self.session or self.session['id'] != identifier or self.session['owner'] != owner:
            raise PreviewError('Preview expired or is not owned by this login. Enable it again.', 404)
        return self.session

    def stop(self, owner, identifier):
        with self.lock:
            self._owned(owner, identifier)
            self._stop()

    def frame(self, owner, identifier, advance):
        if not self.frame_lock.acquire(blocking=False):
            raise PreviewError('A frame is already being processed.')
        session = None
        try:
            with self.lock:
                session = self._owned(owner, identifier)
                session['busy'] = True
                pipe = session['pipe']
                pipe.send({'advance': advance})
            if not pipe.poll(90):
                raise PreviewError('AI preview timed out. Ordinary video playback is still available.', 503)
            result = pipe.recv()
            if 'error' in result:
                raise PreviewError(result['error'], 503)
            result['image'] = base64.b64encode(result['image']).decode('ascii')
            return result
        except (EOFError, BrokenPipeError, OSError, ValueError):
            with self.lock:
                if session is not None and self.session is session:
                    self._stop()
            raise PreviewError('AI preview stopped unexpectedly. Restart it or use ordinary playback.', 503) from None
        except PreviewError:
            with self.lock:
                if session is not None and self.session is session:
                    self._stop()
            raise
        finally:
            with self.lock:
                if session is not None and self.session is session:
                    session['busy'] = False
                    session['touched'] = self.clock()
            self.frame_lock.release()


def create_sample_ai_blueprint(authorize, root, manager=None, retired=False):
    bp = Blueprint('sample_ai', __name__)
    manager = manager or PreviewManager(root)

    @bp.before_request
    def protect():
        denied = authorize()
        if denied is not None:
            return denied
        if retired and request.method == 'POST':
            return jsonify(message='Use the integrated sample preview. Separate diagnostic workers are disabled.'), 409

    @bp.after_request
    def private(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    def owner():
        return hashlib.sha256(request.headers.get('Authorization', '').encode()).hexdigest()

    @bp.errorhandler(PreviewError)
    def preview_error(exc):
        return jsonify(message=str(exc)), exc.status

    @bp.errorhandler(ValueError)
    def invalid(exc):
        return jsonify(message=str(exc)), 400

    def body():
        if request.content_length is None or request.content_length > 2048:
            raise ValueError('Invalid preview request size.')
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            raise ValueError('Provide a preview request.')
        return data

    @bp.get('/api/sample-ai/mappings')
    def mappings():
        entries = []
        for video_id, (_, bays, direction) in MAPPINGS.items():
            try:
                _, document = resolve_mapping(root, video_id)
                entries.append(dict(videoId=video_id, bays=list(bays), direction=direction,
                    roi=dict(width=document['source_width'], height=document['source_height'],
                             normalization=document['normalization'], polygons=document['bays'])))
            except (ValueError, OSError):
                pass  # Missing/invalid configurations are not advertised as eligible.
        return jsonify(mappings=entries)

    @bp.post('/api/sample-ai/sessions')
    def start():
        data = body()
        if set(data) != {'videoId', 'method'} or not isinstance(data['method'], str):
            raise ValueError('Provide only a mapped video and assignment method.')
        try:
            return jsonify(id=manager.start(owner(), data['videoId'], data['method'])), 201
        except OSError:
            raise PreviewError('Local recording or ROI is unavailable.', 503) from None

    @bp.post('/api/sample-ai/sessions/<identifier>/frame')
    def frame(identifier):
        data = body()
        if set(data) != {'advance'} or type(data['advance']) is not bool:
            raise ValueError('Provide an advance flag.')
        return jsonify(manager.frame(owner(), identifier, data['advance']))

    @bp.delete('/api/sample-ai/sessions/<identifier>')
    def stop(identifier):
        manager.stop(owner(), identifier)
        return jsonify(stopped=True)

    return bp
