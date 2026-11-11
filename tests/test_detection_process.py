import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
from backend.detection.detection_process import ProcessAdapter
from backend.detection.detection_runtime import DetectionRuntime


def crash_on_frame(connection, name):
    connection.send(('ok', None))
    connection.recv()
    os._exit(23)


class WorkerRecoveryTests(unittest.TestCase):
    def test_detailed_request_uses_existing_worker_and_preserves_normal_requests(self):
        from unittest.mock import Mock
        from backend.detection.detection_process import _worker
        connection, adapter = Mock(), Mock()
        frame = np.zeros((4, 4, 3), dtype=np.uint8)
        connection.recv.side_effect = [{'details': frame}, frame, None]
        adapter.predict_details.return_value = [{'confidence': .8, 'class_name': 'bus'}]
        adapter.predict.return_value = [{'vehicle_type': 'Bus'}]
        with patch('backend.detection.detection_directml.DirectMLAdapter', return_value=adapter):
            _worker(connection, 'yolov8')
        adapter.predict_details.assert_called_once_with(frame)
        adapter.predict.assert_called_once_with(frame)
        self.assertEqual(connection.send.call_args_list[1].args[0], ('ok', [{'confidence': .8, 'class_name': 'bus'}]))
        connection.close.assert_called_once()
    def test_native_worker_exit_does_not_kill_parent(self):
        worker = ProcessAdapter('test', target=crash_on_frame, startup_timeout=10)
        try:
            with self.assertRaisesRegex(RuntimeError, 'stopped unexpectedly|exited'):
                worker.predict(np.zeros((4, 4, 3), dtype=np.uint8))
        finally:
            worker.close()
        self.assertFalse(worker.process.is_alive())

    def test_switch_releases_amd_before_load_and_recovers_on_cpu(self):
        events = []
        class Fake:
            def __init__(self, name, device):
                events.append(('load', name, device))
                self.device = device
                if name == 'fasterrcnn_resnet50_fpn':
                    raise RuntimeError('simulated native failure')
            def predict(self, frame):
                return []
            def close(self):
                events.append(('close', self.device))
        with tempfile.TemporaryDirectory() as folder, patch('backend.detection.detection_runtime.devices', return_value=[{'id':'amd','available':True},{'id':'cpu','available':True}]), patch('backend.detection.detection_runtime.amd_weights_path') as path:
            path.return_value.is_file.return_value = True
            runtime = DetectionRuntime(Path(folder)/'config.json', factory=Fake)
            runtime.switch('ssd300_vgg16', 'amd')
            with self.assertRaises(RuntimeError):
                runtime.switch('fasterrcnn_resnet50_fpn', 'amd')
            self.assertEqual(events[1:],[('close','amd'),('load','fasterrcnn_resnet50_fpn','amd'),('load','ssd300_vgg16','cpu')])
            self.assertEqual(runtime.device,'cpu')
            self.assertEqual(runtime.predict(np.zeros((4,4,3))),[])
            self.assertFalse(runtime.loading)

    def test_inference_failure_falls_back_without_losing_camera_worker(self):
        class Broken:
            def predict(self, frame):
                raise RuntimeError('worker died')
            def close(self):
                pass
        class Healthy:
            def predict(self, frame):
                return [{'vehicle_type':'Bus'}]
        runtime = DetectionRuntime(factory=lambda name, device: Healthy())
        runtime.adapter, runtime.device = Broken(), 'amd'
        self.assertEqual(runtime.predict(np.zeros((4,4,3))),[{'vehicle_type':'Bus'}])
        self.assertEqual(runtime.device,'cpu')
