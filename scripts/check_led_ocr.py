"""Real-frame OCR comparison; isolated in-memory sessions, no operational DB/server."""
import argparse
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--samples', type=int, default=11)
    parser.add_argument('--interval', type=float, default=3)
    parser.add_argument('--output', default='tmp/led-review/results.json')
    args = parser.parse_args()
    os.environ.setdefault('YOLO_CONFIG_DIR', str(ROOT/'tmp/led-review/ultralytics'))
    import cv2
    from backend.detection.detection_runtime import runtime
    from backend.detection.detector import analyze_frame
    from backend.detection.roi_config import load_roi
    from backend.ocr.ocr_worker import create_engine, crop_sign, read_sign
    from backend.ocr.led import led_crop, LEDReader
    from backend.state.occupancy import OccupancyState
    runtime.switch('yolov8', 'cpu', persist=False)
    engine = create_engine()
    video = ROOT / 'public/sample-CCTV/Bays 2-5.mp4'
    capture = cv2.VideoCapture(str(video))
    destination = ROOT / args.output
    destination.parent.mkdir(parents=True, exist_ok=True)
    baseline, enhanced = OccupancyState(), OccupancyState()
    reader = LEDReader()
    records = []
    saved = set()
    try:
        ok, frame = capture.read()
        if not ok:
            raise RuntimeError('Cannot decode test video')
        roi = load_roi(ROOT/'config/roi/bays-2-5.json', video, frame.shape[1], frame.shape[0], root=ROOT)
        for index in range(args.samples):
            seconds = index * args.interval
            capture.set(cv2.CAP_PROP_POS_MSEC, seconds*1000)
            ok, frame = capture.read()
            if not ok: break
            statuses, assignments = analyze_frame(frame, roi=roi, include_detections=True, annotate=False)
            for bay in statuses:
                detection = assignments.get(bay)
                first = baseline.update(bay, detection, now=seconds)
                second = enhanced.update(bay, detection, now=seconds)
                if not detection or not first or not second or not second['ocr_eligible']: continue
                image = crop_sign(frame, detection, baseline.config)
                if image is None: continue
                start = time.perf_counter()
                text, score, lines = read_sign(engine, image, include_lines=True)
                static_ms = (time.perf_counter()-start)*1000
                led_text, led_score = ('',0)
                if detection['vehicle_type'] == 'Bus':
                    led_text, led_score = reader.read(bay, second['id'], image, lambda crop: read_sign(engine,crop), now=seconds)
                merged = ' '.join(part for part in (text,led_text) if part)
                quality = min(score,led_score) if text and led_text else score if text else led_score
                baseline.apply_ocr(bay,first['id'],text,score,now=seconds,lines=lines)
                enhanced.apply_ocr(bay,second['id'],merged,quality,now=seconds,lines=lines)
                candidate = led_crop(image) if detection['vehicle_type']=='Bus' else None
                if candidate is not None and bay not in saved:
                    cv2.imwrite(str(destination.parent/f'{bay}-static.png'),image)
                    cv2.imwrite(str(destination.parent/f'{bay}-led.png'),candidate[0])
                    saved.add(bay)
                row = dict(seconds=seconds,bay=bay,vehicle_type=detection['vehicle_type'],
                    static_text=text,static_score=score,static_ms=round(static_ms,2),led_text=led_text,led_score=led_score,
                    candidate=candidate is not None,baseline=baseline.snapshot(now=seconds)[int(bay[4:])-1]['route'],
                    enhanced=enhanced.snapshot(now=seconds)[int(bay[4:])-1]['route'])
                records.append(row)
                print(json.dumps(row),flush=True)
    finally:
        capture.release()
    destination.write_text(json.dumps(dict(records=records,led=reader.diagnostics()),indent=2),encoding='utf-8')


if __name__ == '__main__':
    main()
