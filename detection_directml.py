"""Validated local YOLOv8 ONNX inference on the default DirectML adapter."""
import ast
import hashlib
import json
from pathlib import Path
import cv2
import numpy as np
import onnxruntime as ort
ROOT = Path(__file__).resolve().parent


def onnx_path(name):
    folder = 'yolov8n' if name == 'yolov8' else name
    return ROOT / 'trained_models' / folder / 'AMD/best.onnx'


class TorchvisionDirectMLAdapter:
    def __init__(self, name, profile_prefix=None):
        if name not in ('fasterrcnn_resnet50_fpn', 'ssd300_vgg16'):
            raise ValueError('Unsupported DirectML architecture.')
        if 'DmlExecutionProvider' not in ort.get_available_providers():
            raise RuntimeError('DirectML is not installed.')
        options = ort.SessionOptions()
        options.enable_mem_pattern = False
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        if profile_prefix:
            options.enable_profiling = True
            options.profile_file_prefix = str(profile_prefix)
        self.session = ort.InferenceSession(str(onnx_path(name)), sess_options=options,
            providers=[('DmlExecutionProvider', {'device_id': 0}), 'CPUExecutionProvider'])
        self.session.disable_fallback()
        if 'DmlExecutionProvider' not in self.session.get_providers():
            raise RuntimeError('DirectML session initialization failed.')
        metadata = self.session.get_modelmeta().custom_metadata_map
        source = onnx_path(name).parent.parent / 'best.pth'
        if (metadata.get('architecture') != name or metadata.get('preprocessing') != 'rgb_stretch_416'
                or json.loads(metadata.get('class_names', '{}')) != {'1': 'bus', '2': 'uv'}
                or metadata.get('source_sha256') != hashlib.sha256(source.read_bytes()).hexdigest()):
            raise ValueError('ONNX metadata or source checkpoint changed; re-export and validate the model.')
        inp = self.session.get_inputs()[0]
        if inp.shape != [1, 3, 416, 416] or inp.type != 'tensor(float)':
            raise ValueError('Unexpected ONNX input shape or type.')
        self.input_name = inp.name

    def predict(self, frame):
        height, width = frame.shape[:2]
        rgb = cv2.cvtColor(cv2.resize(frame, (416, 416)), cv2.COLOR_BGR2RGB)
        tensor = np.ascontiguousarray(rgb.transpose(2, 0, 1)[None], dtype=np.float32) / 255
        boxes, labels, scores = self.session.run(['boxes', 'labels', 'scores'], {self.input_name: tensor})
        result = []
        for box, label, score in zip(boxes, labels, scores):
            if int(label) in (1, 2) and score >= .5:
                box = box * np.array([width / 416, height / 416, width / 416, height / 416])
                result.append({'bbox': box.tolist(), 'vehicle_type': 'Bus' if label == 1 else 'UV Express'})
        return result

class DirectMLAdapter:
    def __init__(self):
        if 'DmlExecutionProvider' not in ort.get_available_providers():
            raise RuntimeError('Install the Windows requirements: DirectML is missing.')
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
        self.session, self.input_name, self.names = session, inp.name, names

    def predict(self, frame):
        height, width = frame.shape[:2]
        scale = min(512 / width, 512 / height)
        resized = cv2.resize(frame, (round(width * scale), round(height * scale)))
        dh, dw = 512 - resized.shape[0], 512 - resized.shape[1]
        top, left = round(dh / 2 - .1), round(dw / 2 - .1)
        padded = cv2.copyMakeBorder(resized, top, dh - top, left, dw - left,
                                    cv2.BORDER_CONSTANT, value=(114, 114, 114))
        tensor = np.ascontiguousarray(padded[:, :, ::-1].transpose(2, 0, 1)[None], dtype=np.float32) / 255
        raw = self.session.run(None, {self.input_name: tensor})[0]
        if raw.shape != (1, 6, 5376):
            raise ValueError(f'Unexpected YOLO output: {raw.shape}')
        rows = raw[0].T
        labels = rows[:, 4:].argmax(axis=1)
        scores = rows[:, 4:].max(axis=1)
        detections = []
        for label in self.names:
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
                detections.append(dict(label=self.names[label], confidence=score, bbox=bbox))
        return [{"bbox": item["bbox"], "vehicle_type": "Bus" if item["label"] == "bus" else "UV Express"} for item in detections]
