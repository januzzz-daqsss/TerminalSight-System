"""Compare real-frame AMD detections with PyTorch and record provider profiling."""
import argparse
from collections import Counter
import json
from pathlib import Path
import sys
import time
import cv2
import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from detection_directml import TorchvisionDirectMLAdapter
from detection_runtime import Adapter


def iou(a, b):
    intersection = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))
    return intersection / ((a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - intersection)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('model', choices=['ssd300_vgg16', 'fasterrcnn_resnet50_fpn'])
    name = parser.parse_args().model
    torch.set_num_threads(2)
    output = ROOT / 'tmp/amd-check'
    output.mkdir(parents=True, exist_ok=True)
    cpu = Adapter(name, 'cpu')
    amd = TorchvisionDirectMLAdapter(name, output / name)
    rows = []
    for filename in ['sample-VID_20260604_131402.mp4', 'sample-VID_20260604_133427.mp4']:
        cap = cv2.VideoCapture(str(ROOT / 'public/sample-videos' / filename))
        try:
            for seconds in [0, 5, 10]:
                cap.set(cv2.CAP_PROP_POS_MSEC, seconds * 1000)
                ok, frame = cap.read()
                if not ok:
                    raise RuntimeError('Sample video could not be read.')
                expected = cpu.predict(frame)
                start = time.perf_counter()
                actual = amd.predict(frame)
                elapsed = (time.perf_counter()-start)*1000
                assert len(expected) == len(actual), (expected, actual)
                unmatched = list(actual)
                overlaps = []
                for detection in expected:
                    candidates = [(iou(detection['bbox'], other['bbox']), index) for index, other in enumerate(unmatched)
                                  if other['vehicle_type'] == detection['vehicle_type']]
                    overlap, index = max(candidates)
                    assert overlap > .98, overlap
                    overlaps.append(overlap)
                    unmatched.pop(index)
                rows.append(dict(video=filename, seconds=seconds, inference_ms=elapsed,
                                 overlaps=overlaps, detections=actual))
                print(name, seconds, round(elapsed, 1), overlaps, actual, flush=True)
        finally:
            cap.release()
    profile = json.loads(Path(amd.session.end_profiling()).read_text())
    providers = Counter(e.get('args', {}).get('provider') for e in profile if e.get('args', {}).get('provider'))
    assert providers['DmlExecutionProvider'] > 0, providers
    report = {'model': name, 'frames': rows, 'profile_providers': dict(providers)}
    (output / f'{name}-validation.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print('Passed. Profile providers:', providers, flush=True)


if __name__ == '__main__':
    main()
