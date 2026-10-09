import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
from detection_process import ProcessAdapter
from detection_runtime import DetectionRuntime


def crash_on_frame(connection, name):
    connection.send(('ok', None))
    connection.recv()
    os._exit(23)


class WorkerRecoveryTests(unittest.TestCase):
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
        with tempfile.TemporaryDirectory() as folder, patch('detection_runtime.devices', return_value=[{'id':'amd','available':True},{'id':'cpu','available':True}]), patch('detection_runtime.amd_weights_path') as path:
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
