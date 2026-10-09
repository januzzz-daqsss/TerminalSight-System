"""Check the existing YOLO ONNX export on real frames without changing the app."""
import ast
import json
from pathlib import Path
import time

import cv2
import numpy as np
import onnxruntime as ort

ROOT = Path(__file__).resolve().parents[1]


def main():
    if 'DmlExecutionProvider' not in ort.get_available_providers():
        raise RuntimeError('Run with .venv/Scripts/python.exe after installing the Windows requirements: DirectML is missing.')
    options = ort.SessionOptions()
    options.enable_mem_pattern = False
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    session = ort.InferenceSession(
        str(ROOT / 'trained_models/yolov8n/AMD/best.onnx'),
        sess_options=options,
        providers=[('DmlExecutionProvider', {'device_id': 0}), 'CPUExecutionProvider'],
    )
    session.disable_fallback()
    if 'DmlExecutionProvider' not in session.get_providers():
        raise RuntimeError('DirectML session creation failed; refusing a CPU-only test.')
    meta = session.get_modelmeta().custom_metadata_map
    names = ast.literal_eval(meta['names'])
    if names != {0: 'bus', 1: 'uv'}:
        raise ValueError(f'Unexpected class mapping: {names}')
    inp = session.get_inputs()[0]
    if inp.shape != [1, 3, 512, 512] or inp.type != 'tensor(float)':
        raise ValueError(f'Unexpected model input: {inp.shape} {inp.type}')
    output_dir = ROOT / 'tmp/amd-check'
    output_dir.mkdir(parents=True, exist_ok=True)
    print('Session providers:', session.get_providers(), flush=True)
    print('Model:', meta.get('description'), flush=True)
    session.run(None, {inp.name: np.zeros(inp.shape, dtype=np.float32)})
    records = []
    for camera, filename in [('northbound', 'sample-VID_20260604_131402.mp4'),
                             ('southbound', 'sample-VID_20260604_133427.mp4')]:
        cap = cv2.VideoCapture(str(ROOT / 'public/sample-videos' / filename))
        try:
            for seconds in (0, 5, 10):
                cap.set(cv2.CAP_PROP_POS_MSEC, seconds * 1000)
                ok, frame = cap.read()
                if not ok:
                    raise RuntimeError(f'Cannot read {camera} at {seconds}s')
                height, width = frame.shape[:2]
                scale = min(512 / width, 512 / height)
                resized = cv2.resize(frame, (round(width * scale), round(height * scale)))
                dh, dw = 512 - resized.shape[0], 512 - resized.shape[1]
                top, left = round(dh / 2 - .1), round(dw / 2 - .1)
                padded = cv2.copyMakeBorder(resized, top, dh - top, left, dw - left,
                                            cv2.BORDER_CONSTANT, value=(114, 114, 114))
                tensor = np.ascontiguousarray(padded[:, :, ::-1].transpose(2, 0, 1)[None], dtype=np.float32) / 255
                start = time.perf_counter()
                raw = session.run(None, {inp.name: tensor})[0]
                elapsed = (time.perf_counter() - start) * 1000
                if raw.shape != (1, 6, 5376):
                    raise ValueError(f'Unexpected YOLO output: {raw.shape}')
                rows = raw[0].T
                labels = rows[:, 4:].argmax(axis=1)
                scores = rows[:, 4:].max(axis=1)
                detections = []
                for label in names:
                    selected = rows[(labels == label) & (scores >= .5)]
                    if not len(selected):
                        continue
                    confidence = selected[:, 4 + label]
                    boxes = selected[:, :4].copy()
                    boxes[:, :2] -= boxes[:, 2:] / 2
                    indices = cv2.dnn.NMSBoxes(boxes.tolist(), confidence.tolist(), .5, .45)
                    for index in np.asarray(indices).reshape(-1):
                        x, y, w, h = boxes[index]
                        bbox = [int(np.clip((x - left) / scale, 0, width)),
                                int(np.clip((y - top) / scale, 0, height)),
                                int(np.clip((x + w - left) / scale, 0, width)),
                                int(np.clip((y + h - top) / scale, 0, height))]
                        score = float(confidence[index])
                        detections.append(dict(label=names[label], confidence=score, bbox=bbox))
                        x1, y1, x2, y2 = bbox
                        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 220, 0), 3)
                        cv2.putText(frame, f'{names[label]} {score:.2f}', (x1, max(25, y1 - 8)),
                                    cv2.FONT_HERSHEY_SIMPLEX, .9, (0, 220, 0), 2)
                image = output_dir / f'{camera}-{seconds}s.jpg'
                if not cv2.imwrite(str(image), frame):
                    raise RuntimeError(f'Cannot save {image}')
                records.append(dict(camera=camera, seconds=seconds, inference_ms=elapsed, detections=detections))
                print(f'{camera} {seconds}s: {elapsed:.1f} ms; {detections}', flush=True)
        finally:
            cap.release()
    (output_dir / 'results.json').write_text(json.dumps(dict(metadata=meta, frames=records), indent=2), encoding='utf-8')
    print('Images and results saved to:', output_dir)
    print('These timings exclude video decoding, drawing, OCR and streaming. CPU nodes may remain.')


if __name__ == '__main__':
    main()
