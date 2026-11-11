"""Timestamped, diagnostic-only sample frames using the active shared runtime.

Checkpoint B: one approved recording, one in-flight request, no queued work,
no new model processes and no operational state writes. Captures always close.
"""
import math
import threading
import time
from flask import Blueprint, jsonify, request
from backend.cameras.sample_ai import resolve_mapping

PILOT_VIDEO = 'sample-CCTV/Bays 1-2.mp4'


def create_synchronized_blueprint(authorize, root, runtime=None, capture_factory=None, clock=time.monotonic, retired=False):
    bp = Blueprint('synchronized_preview', __name__)
    gate = threading.Lock()
    next_allowed = 0.0

    @bp.before_request
    def protect():
        denied = authorize()
        if denied is not None:
            return denied
        if retired:
            return jsonify(message='Use the integrated sample preview instead of timestamp polling.'), 409

    @bp.after_request
    def private(response):
        response.headers['Cache-Control'] = 'no-store'
        return response

    @bp.post('/api/sample-monitor/frame')
    def frame():
        nonlocal next_allowed
        if request.content_length is None or request.content_length > 2048:
            return jsonify(message='Invalid frame request size.'), 413
        data = request.get_json(silent=True)
        if (not isinstance(data, dict) or set(data) != {'videoId', 'seconds', 'method', 'epoch'}
                or data['videoId'] != PILOT_VIDEO or data['method'] not in ('ioa', 'ground')
                or type(data['seconds']) not in (int, float) or not math.isfinite(data['seconds'])
                or not 0 <= data['seconds'] <= 86400 or type(data['epoch']) is not int or not 0 <= data['epoch'] <= 2147483647):
            return jsonify(message='Choose the approved pilot recording and a valid video timestamp.'), 400
        if not gate.acquire(blocking=False):
            return jsonify(message='Diagnostic processing busy; frame skipped.'), 429
        cap = None
        try:
            if clock() < next_allowed:
                return jsonify(message='Diagnostic rate limit; frame skipped.'), 429
            next_allowed = clock() + .5
            import cv2
            from shapely.geometry import Polygon
            from tools.roi_detection_test import assign_vehicles, ground_assign
            video, roi = resolve_mapping(root, data['videoId'])
            cap = (capture_factory or cv2.VideoCapture)(str(video))
            fps, count = cap.get(cv2.CAP_PROP_FPS), int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            if not cap.isOpened() or not math.isfinite(fps) or not 1 <= fps <= 120 or count <= 0:
                raise ValueError('Unsupported recording timing or decoder.')
            if data['seconds'] > count / fps:
                raise ValueError('Timestamp is outside the recording.')
            index = min(count - 1, int(data['seconds'] * fps))
            started = clock()
            if not cap.set(cv2.CAP_PROP_POS_FRAMES, index):
                raise ValueError('The decoder cannot seek this recording.')
            ok, image = cap.read()
            if not ok:
                raise ValueError('Cannot decode the requested frame.')
            height, width = image.shape[:2]
            if (width, height) != (roi['source_width'], roi['source_height']):
                raise ValueError('Decoded dimensions do not match saved ROI.')
            actual_index = int(cap.get(cv2.CAP_PROP_POS_FRAMES)) - 1
            seconds = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
            if not math.isfinite(seconds) or seconds < 0 or (seconds == 0 and actual_index > 0):
                seconds = actual_index / fps
            if actual_index < 0 or abs(seconds - data['seconds']) > .15:
                raise ValueError('Decoder could not locate the requested timestamp accurately.')
            selected_runtime = runtime
            if selected_runtime is None:
                from backend.detection.detection_runtime import runtime as selected_runtime
            detections, selection = selected_runtime.predict_diagnostic(image)
            for item in detections:
                if (item.get('class_name') not in ('bus', 'uv') or
                    item.get('vehicle_type') != {'bus': 'Bus', 'uv': 'UV Express'}.get(item.get('class_name')) or
                    not math.isfinite(item.get('confidence', float('nan'))) or not 0 <= item['confidence'] <= 1):
                    raise ValueError('Model did not return valid custom vehicle classes/confidence.')
            polygons = {bay['id']: Polygon([(x * width, y * height) for x, y in bay['points']]) for bay in roi['bays']}
            assigned, scores, ambiguity = assign_vehicles(polygons, detections, .20)
            states = {bay: 'OCCUPIED' if bay in assigned else 'AVAILABLE' for bay in polygons}
            if data['method'] == 'ground':
                assigned, states, ambiguity = ground_assign(polygons, detections, .20, frame_height=height)
            return jsonify(videoId=data['videoId'], epoch=data['epoch'], seconds=seconds, frame=actual_index,
                width=width, height=height, sourceFps=fps, method=data['method'], detections=detections,
                states=states, diagnostics=ambiguity, runtime=selection,
                processingFps=round(1 / max(clock() - started, .0001), 2))
        except RuntimeError:
            return jsonify(message='YOLO runtime busy or unavailable. Select YOLOv8 in AI Detection; playback continues.'), 503
        except (ValueError, OSError):
            return jsonify(message='Recording, ROI or decoded timestamp is invalid. No AI overlay is displayed.'), 400
        except Exception:
            return jsonify(message='Diagnostic processing failed. Playback continues without AI overlays.'), 503
        finally:
            if cap is not None:
                cap.release()
            gate.release()

    return bp
