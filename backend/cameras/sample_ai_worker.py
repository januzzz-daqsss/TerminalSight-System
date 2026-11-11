"""Disposable CPU diagnostic worker. No server startup or OCR/occupancy state use."""
import os
import sys
import tempfile
import time


def run_preview(pipe, root, video_id, method, scratch):
    sys.dont_write_bytecode = True
    os.environ['YOLO_OFFLINE'] = 'true'
    os.environ['YOLO_AUTOINSTALL'] = 'false'
    os.environ['OPENBLAS_NUM_THREADS'] = '1'
    cap = detector = None
    # Library settings are temporary; never use the user's operational settings.
    try:
        os.environ['YOLO_CONFIG_DIR'] = scratch
        tempfile.tempdir = scratch
        import cv2
        import torch
        torch.set_num_threads(1)
        from backend.cameras.sample_ai import resolve_mapping
        from tools.roi_detection_test import YoloDetector, prepare_rois, assign_vehicles, ground_assign, overlay
        video, data = resolve_mapping(root, video_id)  # Recheck inside the child.
        cap = cv2.VideoCapture(str(video))
        ok, frame = cap.read()
        if not ok:
            pipe.send({'error': 'Cannot decode this recording. Ordinary playback may still work in the browser.'})
            return
        height, width = frame.shape[:2]
        polygons, _ = prepare_rois(data, video, width, height)
        detector = YoloDetector('cpu')
        source_fps = cap.get(cv2.CAP_PROP_FPS)
        if not 1 <= source_fps <= 120:
            source_fps = 25
        count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        index, last, cached, ended = 0, None, None, False
        while pipe.poll(25):
            command = pipe.recv()
            if command.get('stop'):
                break
            advance = command['advance']
            now = time.monotonic()
            if cached is not None and (not advance or ended):
                last = None
                pipe.send(cached)
                continue
            if cached is not None:
                steps = max(1, min(round((now - last) * source_fps), round(source_fps * 2))) if last else 1
                for _ in range(steps):
                    ok, next_frame = cap.read()
                    if not ok:
                        if count > 0 and index + 1 < count:
                            pipe.send({'error': 'Video decoding stopped before the expected end.'})
                            return
                        ended = True
                        break
                    frame, index = next_frame, index + 1
            last = now if advance else None
            started = time.monotonic()
            if frame.shape[:2] != (height, width):
                raise ValueError('Resolution changed')
            detections = detector.predict(frame)
            assignments, scores, ambiguities = assign_vehicles(polygons, detections, detector.threshold)
            if method == 'ground':
                assignments, states, ambiguities = ground_assign(polygons, detections, detector.threshold, frame_height=height)
            else:
                states = {name: 'OCCUPIED' if name in assignments else 'AVAILABLE' for name in polygons}
            fps = 1 / max(time.monotonic() - started, .0001)
            image = overlay(frame, polygons, detections, states, index, fps, not advance, 1, method=method)
            # Standalone keyboard hints do not apply to the browser. Replace header.
            image[:92] = 0
            cv2.putText(image, f'SAMPLE AI | {method.upper()} | frame {index} | {fps:.1f} processing FPS',
                        (10, 30), cv2.FONT_HERSHEY_SIMPLEX, .6, (255, 255, 255), 1)
            cv2.putText(image, 'Instantaneous only - no operational occupancy / OCR | ground point is approximate',
                        (10, 60), cv2.FONT_HERSHEY_SIMPLEX, .48, (255, 255, 255), 1)
            ok, jpeg = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 80])
            if not ok:
                raise ValueError('JPEG encoding failed')
            cached = dict(image=jpeg.tobytes(), frame=index, seconds=index / source_fps, ended=ended,
                          method=method, states=states, processingFps=round(fps, 1),
                          diagnostics=ambiguities, overlaps={k: max(v, default=0) for k, v in scores.items()})
            pipe.send(cached)
    except (BrokenPipeError, EOFError):
        pass
    except Exception:
        try:
            pipe.send({'error': 'Sample AI could not run. Check the local YOLO weights, ROI dimensions and video codec.'})
        except (BrokenPipeError, EOFError, OSError):
            pass
    finally:
        if cap is not None:
            cap.release()
        if detector is not None:
            detector.close()
        pipe.close()
