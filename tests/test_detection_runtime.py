import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import torch

from detection_runtime import Adapter, DetectionRuntime


class FakeAdapter:
    def __init__(self, name, device):
        self.name = name

    def predict(self, frame):
        return [{'bbox': [1, 2, 3, 4], 'vehicle_type': 'Bus'}]


class DetectionRuntimeTests(unittest.TestCase):
    def test_switch_persists_and_failed_candidate_preserves_old_model(self):
        with tempfile.TemporaryDirectory() as folder:
            runtime = DetectionRuntime(Path(folder) / 'selection.json', factory=FakeAdapter)
            runtime.switch('yolov8', 'cpu')
            original = runtime.adapter
            runtime.factory = lambda *args: (_ for _ in ()).throw(ValueError('bad checkpoint'))
            with self.assertRaises(ValueError):
                runtime.switch('ssd300_vgg16', 'cpu')
            self.assertIs(runtime.adapter, original)
            self.assertEqual(json.loads(runtime.config_path.read_text())['model'], 'yolov8')
            self.assertFalse(runtime.loading)
            self.assertEqual(runtime.predict(np.zeros((20, 20, 3)))[0]['vehicle_type'], 'Bus')

    def test_rejects_unknown_and_unsupported_selections(self):
        runtime = DetectionRuntime(factory=FakeAdapter)
        for name, device in [('fake', 'cpu'), ('yolov8', 'intel')]:
            with self.assertRaises(ValueError):
                runtime.switch(name, device)

    def test_missing_amd_export_cannot_switch(self):
        with tempfile.TemporaryDirectory() as folder:
            runtime = DetectionRuntime(Path(folder) / 'settings.json', factory=FakeAdapter)
            with patch('detection_runtime.amd_weights_path', return_value=Path(folder) / 'missing.onnx'):
                with self.assertRaisesRegex(ValueError, 'weights are missing'):
                    runtime.switch('ssd300_vgg16', 'amd')

    def test_concurrent_switch_is_rejected(self):
        runtime = DetectionRuntime(factory=FakeAdapter)
        runtime.change_lock.acquire()
        try:
            with self.assertRaises(RuntimeError):
                runtime.switch('yolov8', 'cpu')
        finally:
            runtime.change_lock.release()

    def test_torchvision_preprocessing_coordinates_and_classes(self):
        adapter = Adapter.__new__(Adapter)
        adapter.name, adapter.device = 'ssd300_vgg16', 'cpu'
        def predict(images):
            self.assertEqual(tuple(images[0].shape), (3, 416, 416))
            self.assertEqual(float(images[0][0, 0, 0]), 1.)  # BGR -> RGB
            return [{'boxes': torch.tensor([[0., 0., 208., 208.], [208., 208., 416., 416.], [0., 0., 20., 20.]]),
                     'labels': torch.tensor([1, 2, 1]), 'scores': torch.tensor([.9, .8, .1])}]
        adapter.model = predict
        frame = np.zeros((100, 200, 3), dtype=np.uint8); frame[:, :, 2] = 255
        result = adapter.predict(frame)
        self.assertEqual(result, [{'bbox': [0., 0., 100., 50.], 'vehicle_type': 'Bus'},
                                  {'bbox': [100., 50., 200., 100.], 'vehicle_type': 'UV Express'}])

    def test_parking_assignments_are_shared_across_adapters(self):
        import detector
        with patch.object(detector.runtime, 'predict', return_value=[{'bbox': [500, 550, 1650, 900], 'vehicle_type': 'UV Express'}]):
            statuses, boxes = detector.analyze_frame(np.zeros((1080, 1920, 3), dtype=np.uint8), 'northbound', True, False)
        self.assertEqual(statuses['Bay_1'], 'OCCUPIED')
        self.assertEqual(boxes['Bay_1']['vehicle_type'], 'UV Express')


if __name__ == '__main__':
    unittest.main()
