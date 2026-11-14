"""Standalone Intel GPU check; no Flask, settings writes, OCR or occupancy updates."""
import argparse
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    from backend.detection.detection_devices import intel_status
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--discover-only', action='store_true')
    parser.add_argument('--video', default='public/sample-CCTV/Bays 1-2.mp4')
    parser.add_argument('--frames', type=int, default=12)
    args = parser.parse_args()
    if not 1 <= args.frames <= 60:
        parser.error('--frames must be between 1 and 60')
    status = intel_status()
    print(json.dumps(status), flush=True)
    if not status['available']:
        return 2
    if args.discover_only:
        return 0  # Discovery is not proof of working inference.
    import cv2
    from backend.detection.detection_openvino import intel_worker
    from backend.detection.detection_process import ProcessAdapter
    path = Path(args.video)
    path = path if path.is_absolute() else ROOT / path
    if not path.is_file():
        raise ValueError('Verification recording is missing.')
    cap = cv2.VideoCapture(str(path), cv2.CAP_FFMPEG, [cv2.CAP_PROP_N_THREADS, 1])
    worker = None
    try:
        ok, frame = cap.read()
        if not ok:
            raise ValueError('Cannot decode verification recording.')
        worker = ProcessAdapter('yolov8', target=intel_worker, label='Intel OpenVINO')
        print(json.dumps(worker.info), flush=True)
        worker.predict(frame)  # Warmup excluded from timings.
        elapsed = []
        for index in range(args.frames):
            if index:
                ok, frame = cap.read()
                if not ok:
                    raise ValueError('Video ended before the requested test completed.')
            start = time.perf_counter()
            result = worker.predict_details(frame)
            elapsed.append((time.perf_counter() - start) * 1000)
            print(json.dumps({'frame': index, 'milliseconds': round(elapsed[-1], 2),
                              'detections': result}), flush=True)
        print(json.dumps({'gpu_inference_completed': True, 'frames': len(elapsed),
                          'mean_end_to_end_ms': round(sum(elapsed) / len(elapsed), 2)}))
    finally:
        cap.release()
        if worker:
            worker.close()
    return 0


if __name__ == '__main__':
    from multiprocessing import freeze_support
    freeze_support()
    try:
        sys.exit(main())
    except Exception as error:
        print(f'Intel verification failed: {error}', file=sys.stderr)
        sys.exit(1)
