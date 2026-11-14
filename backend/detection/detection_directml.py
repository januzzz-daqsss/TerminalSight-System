"""Validated local YOLOv8 ONNX inference on the default DirectML adapter."""
import ast
import hashlib
import json
import cv2
import numpy as np
import onnxruntime as ort
from backend.paths import MODELS_DIR


def onnx_path(name):
    folder = 'yolov8n' if name == 'yolov8' else name
    return MODELS_DIR / folder / 'AMD/best.onnx'


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
            str(onnx_path('yolov8')),
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
        return [{'bbox': item['bbox'], 'vehicle_type': item['vehicle_type']} for item in self.predict_details(frame)]

    def predict_details(self, frame):
        from backend.detection.yolo_onnx import predict_details
        return predict_details(frame, lambda tensor: self.session.run(None, {self.input_name: tensor})[0], self.names)
