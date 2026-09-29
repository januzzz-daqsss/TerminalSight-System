"""Run real OCR on sampled video frames; does not modify the live server/database."""
import argparse
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--samples', type=int, default=12)
    parser.add_argument('--interval', type=float, default=1.5)
    parser.add_argument('--output', default='docs/ocr-evidence.local/sample-results.json')
    args = parser.parse_args()
    import cv2
    from detector import analyze_frame
    from occupancy import OccupancyState
    from ocr_worker import create_engine, crop_sign, read_sign
    engine = create_engine()
    records = []
    for camera, filename in [('northbound', 'sample-VID_20260604_131402.mp4'), ('southbound', 'sample-VID_20260604_133427.mp4')]:
        state = OccupancyState()
        cap = cv2.VideoCapture(str(ROOT / 'public' / 'sample-videos' / filename))
        try:
            for index in range(args.samples):
                seconds = index * args.interval
                cap.set(cv2.CAP_PROP_POS_MSEC, seconds * 1000)
                ok, frame = cap.read()
                if not ok:
                    break
                start = time.perf_counter()
                statuses, detections = analyze_frame(frame.copy(), camera, include_detections=True)
                for bay in statuses:
                    detection = detections.get(bay)
                    session = state.update(bay, detection, now=seconds)
                    if not detection or not session or not session['ocr_eligible']:
                        continue
                    image = crop_sign(frame, detection, state.config)
                    if image is None:
                        continue
                    text, confidence, lines = read_sign(engine, image, include_lines=True)
                    state.apply_ocr(bay, session['id'], text, confidence, now=seconds, lines=lines)
                    row = state.snapshot(now=seconds, debug=True)[int(bay.split('_')[1]) - 1]
                    row.update(camera=camera, video_seconds=seconds, ocrLines=lines,
                               processing_seconds=round(time.perf_counter() - start, 3))
                    records.append(row)
                    print(camera, seconds, repr(text), row['route'], row['routeDetails'], row['ocrState'], flush=True)
                    if index == 0:
                        output_dir = ROOT / Path(args.output).parent
                        output_dir.mkdir(parents=True, exist_ok=True)
                        cv2.imwrite(str(output_dir / f'{camera}-sign.jpg'), image)
        finally:
            cap.release()
    destination = ROOT / args.output
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(records, indent=2), encoding='utf-8')
    print('Saved:', destination)


if __name__ == '__main__':
    main()
