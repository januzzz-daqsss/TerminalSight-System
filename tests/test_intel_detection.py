"""Hardware-independent Intel contracts. These do not prove Iris Xe execution."""
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import numpy as np

from backend.detection.detection_devices import intel_device, intel_status
from backend.detection.detection_openvino import OpenVINOAdapter, intel_worker
from backend.detection.detection_runtime import Adapter, DetectionRuntime
from backend.detection.yolo_onnx import predict_details


class IntelDiscoveryTests(unittest.TestCase):
    def setUp(self):
        intel_device.cache_clear()

    def tearDown(self):
        intel_device.cache_clear()

    def test_missing_optional_package_does_not_break_cpu_discovery(self):
        with patch.dict(sys.modules, {'openvino': None}):
            self.assertFalse(intel_device()['available'])

    def test_cpu_only_nonintel_or_invalid_target_are_rejected(self):
        core = Mock(available_devices=['CPU'])
        with patch.dict(sys.modules, {'openvino': SimpleNamespace(Core=lambda: core), 'onnx': Mock()}):
            self.assertFalse(intel_device()['available'])
            core.available_devices = ['CPU', 'GPU.0']
            core.get_property.return_value = 'Other graphics vendor'
            intel_device.cache_clear()
            self.assertFalse(intel_device()['available'])
            self.assertFalse(intel_device('CPU')['available'])
            self.assertFalse(intel_device('AUTO')['available'])

    def test_discovery_cached_and_explicit_gpu_choice_respected(self):
        core = Mock(available_devices=['CPU', 'GPU.0', 'GPU.1'])
        core.get_property.return_value = 'Intel Iris Xe Graphics'
        factory = Mock(return_value=core)
        with patch.dict(sys.modules, {'openvino': SimpleNamespace(Core=factory), 'onnx': Mock()}):
            with patch.dict('os.environ', {'TERMINALSIGHT_INTEL_DEVICE': 'GPU.1'}):
                self.assertEqual(intel_status()['target'], 'GPU.1')
                self.assertTrue(intel_status()['available'])
            self.assertEqual(factory.call_count, 1)
            self.assertEqual(intel_device()['target'], 'GPU.0')


class IntelAdapterTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name) / 'model.onnx'
        self.path.touch()
        self.input = Mock(shape=[1, 3, 512, 512])
        self.input.get_element_type.return_value.get_type_name.return_value = 'f32'
        output = Mock(shape=[1, 6, 5376])
        self.model = Mock(inputs=[self.input], outputs=[output])
        self.model.input.return_value = self.input
        self.model.output.return_value = output
        self.raw = np.zeros((1, 6, 5376), dtype=np.float32)
        self.raw[0, :, 0] = [256, 256, 256, 128, .9, .1]
        self.request = Mock()
        self.request.get_output_tensor.return_value = SimpleNamespace(data=self.raw)
        self.compiled = Mock()
        self.compiled.get_property.return_value = ['GPU.0']
        self.compiled.create_infer_request.return_value = self.request
        self.core = Mock()
        self.core.read_model.return_value = self.model
        self.core.compile_model.return_value = self.compiled
        self.metadata = SimpleNamespace(key='names', value="{0: 'bus', 1: 'uv'}")
        self.onnx = Mock()
        self.onnx.load.return_value = SimpleNamespace(metadata_props=[self.metadata])
        for p in (
            patch.dict(sys.modules, {'openvino': SimpleNamespace(Core=lambda: self.core), 'onnx': self.onnx}),
            patch('backend.detection.detection_openvino.intel_weights_path', return_value=self.path),
            patch('backend.detection.detection_openvino.intel_status', return_value={
                'available': True, 'target': 'GPU.0', 'name': 'Intel Iris Xe'}),
        ):
            p.start(); self.addCleanup(p.stop)

    def test_gpu_only_single_request_and_source_coordinates(self):
        adapter = OpenVINOAdapter('yolov8')
        for _ in range(3):
            details = adapter.predict_details(np.zeros((256, 512, 3), np.uint8))
            self.assertEqual(details[0]['bbox'], [128, 64, 384, 192])
            self.assertEqual(details[0]['vehicle_type'], 'Bus')
            self.assertAlmostEqual(details[0]['confidence'], .9, places=5)
        self.core.compile_model.assert_called_once()
        self.assertEqual(self.core.compile_model.call_args.args[1], 'GPU.0')
        self.assertEqual(self.core.compile_model.call_args.args[2]['NUM_STREAMS'], 1)
        self.compiled.create_infer_request.assert_called_once()
        result = adapter.predict(np.zeros((256, 512, 3), np.uint8))
        self.assertEqual(set(result[0]), {'bbox', 'vehicle_type'})

    def test_metadata_shapes_unsupported_models_and_cpu_execution_rejected(self):
        with self.assertRaises(ValueError):
            OpenVINOAdapter('ssd300_vgg16')
        self.metadata.value = "{0: 'car', 1: 'bus'}"
        with self.assertRaises(ValueError):
            OpenVINOAdapter('yolov8')
        self.metadata.value = "{0: 'bus', 1: 'uv'}"
        self.input.shape = [1, 3, 640, 640]
        with self.assertRaises(ValueError):
            OpenVINOAdapter('yolov8')
        self.input.shape = [1, 3, 512, 512]
        self.compiled.get_property.return_value = ['CPU']
        with self.assertRaisesRegex(RuntimeError, 'GPU execution'):
            OpenVINOAdapter('yolov8')

    def test_directml_and_intel_share_identical_postprocessing(self):
        from backend.detection.detection_directml import DirectMLAdapter
        amd = DirectMLAdapter.__new__(DirectMLAdapter)
        amd.names, amd.input_name = {0: 'bus', 1: 'uv'}, 'images'
        amd.session = Mock()
        amd.session.run.return_value = [self.raw]
        frame = np.zeros((1296, 2304, 3), np.uint8)
        self.assertEqual(OpenVINOAdapter('yolov8').predict_details(frame), amd.predict_details(frame))
        # Both class identities and class-wise suppression survive the extraction.
        self.raw[0, :, 1] = [256, 256, 256, 128, .1, .8]
        details = predict_details(frame, lambda _: self.raw, amd.names)
        self.assertEqual([d['class_name'] for d in details], ['bus', 'uv'])

    def test_worker_handshake_and_errors(self):
        connection = Mock()
        connection.recv.side_effect = [np.zeros((256, 512, 3), np.uint8), None]
        intel_worker(connection, 'yolov8')
        self.assertEqual(connection.send.call_args_list[0].args[0][1]['execution_devices'], ['GPU.0'])
        connection.close.assert_called_once()
        self.core.compile_model.side_effect = RuntimeError('compile failed')
        connection = Mock()
        intel_worker(connection, 'yolov8')
        self.assertEqual(connection.send.call_args.args[0], ('error', 'compile failed'))
        connection.close.assert_called_once()


class IntelRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.config = Path(self.folder.name) / 'selection.json'
        self.events = []
        events = self.events
        class Fake:
            def __init__(self, model, device):
                self.device = device; events.append(('load', device))
            def predict(self, frame):
                return []
            def close(self):
                events.append(('close', self.device))
        self.fake = Fake
        for p in (
            patch('backend.detection.detection_runtime.devices', return_value=[
                {'id': 'cpu', 'available': True}, {'id': 'intel', 'available': True}]),
            patch('backend.detection.detection_runtime.intel_weights_path', return_value=Path(__file__)),
        ):
            p.start(); self.addCleanup(p.stop)

    def test_selection_persisted_and_switch_closes_previous_gpu(self):
        runtime = DetectionRuntime(self.config, self.fake)
        runtime.switch('yolov8', 'intel')
        self.assertEqual(json.loads(self.config.read_text())['device'], 'intel')
        runtime.switch('yolov8', 'cpu', persist=False)
        self.assertEqual(self.events, [('load', 'intel'), ('close', 'intel'), ('load', 'cpu')])
        self.assertEqual(json.loads(self.config.read_text())['device'], 'intel')
        self.assertFalse(next(m for m in runtime.status()['models'] if m['id'] == 'ssd300_vgg16')['intel_available'])
        with self.assertRaises(ValueError):
            runtime.switch('fasterrcnn_resnet50_fpn', 'intel')

    def test_failed_warmup_retains_cpu_and_saved_preference(self):
        runtime = DetectionRuntime(self.config, self.fake)
        runtime.switch('yolov8', 'cpu')
        previous = runtime.adapter
        broken = Mock(); broken.predict.side_effect = RuntimeError('warmup failed')
        runtime.factory = lambda *args: broken
        with self.assertRaises(RuntimeError):
            runtime.switch('yolov8', 'intel')
        self.assertIs(runtime.adapter, previous)
        broken.close.assert_called_once()
        self.assertEqual(json.loads(self.config.read_text())['device'], 'cpu')

    def test_worker_failure_falls_back_once_without_changing_saved_selection(self):
        runtime = DetectionRuntime(self.config, self.fake)
        runtime.switch('yolov8', 'intel')
        runtime.adapter.predict = Mock(side_effect=RuntimeError('GPU lost'))
        with self.assertLogs(level='ERROR'):
            self.assertEqual(runtime.predict(np.zeros((5, 5, 3))), [])
        self.assertEqual(runtime.device, 'cpu')
        runtime.predict(np.zeros((5, 5, 3)))
        self.assertEqual(self.events.count(('load', 'cpu')), 1)
        self.assertEqual(json.loads(self.config.read_text())['device'], 'intel')

    def test_saved_unavailable_intel_falls_back_on_startup(self):
        self.config.write_text(json.dumps({'model': 'yolov8', 'device': 'intel'}))
        runtime = DetectionRuntime(self.config, self.fake)
        with patch('backend.detection.detection_runtime.devices', return_value=[{'id': 'cpu', 'available': True}]), self.assertLogs(level='ERROR'):
            runtime.initialize()
        self.assertEqual(runtime.device, 'cpu')
        self.assertEqual(json.loads(self.config.read_text())['device'], 'intel')

    def test_adapter_dispatch_uses_isolated_worker_not_torch_intel_device(self):
        from backend.detection.detection_openvino import intel_worker
        with patch('backend.detection.detection_process.ProcessAdapter') as factory:
            adapter = Adapter('yolov8', 'intel')
            factory.assert_called_once_with('yolov8', target=intel_worker, label='Intel OpenVINO')
            frame = np.zeros((2, 2, 3))
            adapter.predict(frame); adapter.predict(frame, details=True); adapter.close()
            factory.return_value.predict.assert_called_once_with(frame)
            factory.return_value.predict_details.assert_called_once_with(frame)
            factory.return_value.close.assert_called_once()
