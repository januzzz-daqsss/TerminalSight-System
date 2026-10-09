"""Local model selection shared by camera workers and authenticated settings API."""
import json
import logging
from pathlib import Path
import threading

import cv2
import numpy as np
import torch

ROOT = Path(__file__).resolve().parent
MODELS = {'yolov8': 'YOLOv8', 'fasterrcnn_resnet50_fpn': 'Faster R-CNN (ResNet-50-FPN)',
          'ssd300_vgg16': 'SSD300 (VGG16)'}


def weights_path(name):
    return ROOT / 'trained_models' / ('yolov8n/best.pt' if name == 'yolov8' else f'{name}/best.pth')


def amd_weights_path(name):
    return ROOT / 'trained_models' / ('yolov8n' if name == 'yolov8' else name) / 'AMD/best.onnx'


def devices():
    cuda = torch.cuda.is_available() and torch.version.hip is None
    try:
        import onnxruntime as ort
        directml = 'DmlExecutionProvider' in ort.get_available_providers()
    except ImportError:
        directml = False
    return [{'id': 'cpu', 'label': 'CPU', 'available': True},
            {'id': 'cuda', 'label': 'NVIDIA CUDA', 'available': cuda},
            {'id': 'amd', 'label': 'AMD / DirectML — default GPU', 'available': directml},
            {'id': 'intel', 'label': 'Intel GPU — runtime not integrated', 'available': False}]


class Adapter:
    def __init__(self, name, device):
        self.name, self.device = name, device
        if device == 'amd':
            from detection_process import ProcessAdapter
            self.directml = ProcessAdapter(name)
            return
        path = weights_path(name)
        if not path.is_file():
            raise ValueError(f'Missing local weights for {MODELS[name]}.')
        if name == 'yolov8':
            from ultralytics import YOLO
            self.model = YOLO(str(path))
        else:
            from detection_models import build_model
            checkpoint = torch.load(path, map_location='cpu', weights_only=True)
            meta = checkpoint['metadata']
            if meta['architecture'] != name or {int(k): v for k, v in meta['class_names'].items()} != {0: '__background__', 1: 'bus', 2: 'uv'}:
                raise ValueError('Checkpoint architecture or vehicle classes do not match.')
            if 'resize' not in meta:
                raise ValueError('Checkpoint is missing resize metadata.')
            self.model = build_model(name, pretrained=False, resize=meta['resize'])
            self.model.load_state_dict(checkpoint['state_dict'], strict=True)
            self.model.to(device).eval()
            # v18 was exported with stretch-to-square before model preprocessing.
            dimensions = meta.get('dataset_splits', {}).get('train', {}).get('dimensions')
            if not dimensions or [list(size) for size in dimensions] != [[416, 416]]:
                raise ValueError('This adapter expects the trained v18 416x416 export.')

    def close(self):
        if self.device == 'amd':
            self.directml.close()

    @torch.inference_mode()
    def predict(self, frame):
        if self.device == 'amd':
            return self.directml.predict(frame)
        height, width = frame.shape[:2]
        output = []
        if self.name == 'yolov8':
            result = self.model(frame, conf=.5, verbose=False, device=self.device)[0]
            for box in result.boxes:
                name = str(result.names[int(box.cls.item())]).lower()
                if name in ('bus', 'uv'):
                    output.append({'bbox': box.xyxy[0].cpu().tolist(),
                                   'vehicle_type': 'Bus' if name == 'bus' else 'UV Express'})
        else:
            rgb = cv2.cvtColor(cv2.resize(frame, (416, 416)), cv2.COLOR_BGR2RGB)
            tensor = torch.from_numpy(np.ascontiguousarray(rgb.transpose(2, 0, 1))).to(self.device, dtype=torch.float32) / 255
            result = self.model([tensor])[0]
            for box, label, score in zip(result['boxes'].cpu().tolist(), result['labels'].cpu().tolist(), result['scores'].cpu().tolist()):
                if label in (1, 2) and score >= .5:
                    x1, y1, x2, y2 = box
                    output.append({'bbox': [x1 * width / 416, y1 * height / 416,
                                            x2 * width / 416, y2 * height / 416],
                                   'vehicle_type': 'Bus' if label == 1 else 'UV Express'})
        return output


class DetectionRuntime:
    def __init__(self, config_path=None, factory=Adapter):
        self.config_path = Path(config_path) if config_path else ROOT / 'config/detection.local.json'
        self.factory = factory
        self.lock = threading.RLock()
        self.change_lock = threading.Lock()
        self.adapter = None
        self.model = 'yolov8'
        self.device = 'cpu'
        self.error = None
        self.loading = False

    def status(self):
        with self.lock:
            return {'model': self.model, 'device': self.device, 'ready': self.adapter is not None,
                    'loading': self.loading, 'error': self.error,
                    'models': [{'id': name, 'label': label, 'available': weights_path(name).is_file(),
                                'amd_available': amd_weights_path(name).is_file()}
                               for name, label in MODELS.items()], 'devices': devices()}

    def switch(self, model, device, persist=True):
        if model not in MODELS:
            raise ValueError('Unknown detection algorithm.')
        if device == 'amd' and not amd_weights_path(model).is_file():
            raise ValueError('AMD ONNX weights are missing for this model. Export and validate them first.')
        if not any(item['id'] == device and item['available'] for item in devices()):
            raise ValueError('Selected inference device is not available.')
        if not self.change_lock.acquire(blocking=False):
            raise RuntimeError('Another model is loading. Please wait.')
        try:
            with self.lock:
                self.loading = True
                self.error = None
                previous = self.adapter
                previous_model, previous_device = self.model, self.device
                released = previous is not None and previous_device == 'amd'
                candidate = None
                try:
                    # Release the old DirectML process before constructing another.
                    # Inference pauses; the independent preview keeps playing.
                    if released:
                        previous.close()
                        self.adapter = None
                    candidate = self.factory(model, device)
                    candidate.predict(np.zeros((416, 416, 3), dtype=np.uint8))
                    if persist:
                        self.config_path.parent.mkdir(parents=True, exist_ok=True)
                        temporary = self.config_path.with_suffix('.tmp')
                        temporary.write_text(json.dumps({'model': model, 'device': device}), encoding='utf-8')
                        temporary.replace(self.config_path)
                    self.adapter, self.model, self.device = candidate, model, device
                except Exception:
                    if candidate is not None and hasattr(candidate, 'close'):
                        candidate.close()
                    if released:
                        # Recovery uses CPU so a damaged GPU context isn't retried.
                        self.adapter = self.factory(previous_model, 'cpu')
                        self.model, self.device = previous_model, 'cpu'
                        self.error = 'AMD switch failed. Previous algorithm restored on CPU; restart before retrying AMD.'
                    else:
                        self.error = 'Could not load the selected model. Previous selection remains active.'
                    raise
        finally:
            with self.lock:
                self.loading = False
            self.change_lock.release()
        return self.status()

    def initialize(self):
        try:
            config = json.loads(self.config_path.read_text(encoding='utf-8')) if self.config_path.exists() else {}
            self.switch(config.get('model', 'yolov8'), config.get('device', 'cpu'), persist=False)
        except Exception:
            logging.exception('Saved detector unavailable; falling back to YOLO CPU')
            self.switch('yolov8', 'cpu', persist=False)
            self.error = 'Saved selection unavailable; using YOLOv8 on CPU.'

    def predict(self, frame):
        with self.lock:
            if self.adapter is None:
                raise RuntimeError('Detection runtime has not been initialized.')
            try:
                return self.adapter.predict(frame)
            except Exception:
                if self.device != 'amd':
                    raise
                logging.exception('AMD worker failed; continuing detection on CPU')
                self.adapter.close()
                self.adapter = self.factory(self.model, 'cpu')
                self.device = 'cpu'
                self.error = 'AMD worker failed. Detection is continuing on CPU.'
                return self.adapter.predict(frame)


runtime = DetectionRuntime()
