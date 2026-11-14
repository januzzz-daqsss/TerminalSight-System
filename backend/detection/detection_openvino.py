"""Optional fixed-shape custom YOLO on an explicitly selected Intel GPU."""
import ast

from backend.detection.detection_devices import intel_status
from backend.paths import MODELS_DIR


def intel_weights_path():
    # ONNX is backend-neutral despite the existing directory name.
    return MODELS_DIR / 'yolov8n/AMD/best.onnx'


class OpenVINOAdapter:
    def __init__(self, name):
        if name != 'yolov8':
            raise ValueError('Intel OpenVINO currently supports only the custom YOLOv8 export.')
        import onnx
        from openvino import Core
        device = intel_status()
        if not device['available']:
            raise RuntimeError(device['reason'])
        path = intel_weights_path()
        if not path.is_file():
            raise ValueError('Local YOLO ONNX export is missing.')
        proto = onnx.load(str(path), load_external_data=False)
        metadata = {item.key: item.value for item in proto.metadata_props}
        self.names = ast.literal_eval(metadata.get('names', '{}'))
        if self.names != {0: 'bus', 1: 'uv'}:
            raise ValueError('YOLO ONNX vehicle classes do not match bus/uv.')
        del proto
        self.core = Core()
        model = self.core.read_model(str(path))
        if (len(model.inputs) != 1 or list(model.input(0).shape) != [1, 3, 512, 512]
                or model.input(0).get_element_type().get_type_name() != 'f32'
                or len(model.outputs) != 1 or list(model.output(0).shape) != [1, 6, 5376]):
            raise ValueError('Unexpected YOLO ONNX input/output contract.')
        self.compiled = self.core.compile_model(model, device['target'], {
            'PERFORMANCE_HINT': 'LATENCY', 'NUM_STREAMS': 1,
            'PERFORMANCE_HINT_NUM_REQUESTS': 1, 'INFERENCE_PRECISION_HINT': 'f32'})
        self.execution_devices = list(self.compiled.get_property('EXECUTION_DEVICES'))
        if not self.execution_devices or any(not (d == 'GPU' or d.startswith('GPU.')) for d in self.execution_devices):
            raise RuntimeError('Intel verification requires GPU execution, not CPU/AUTO fallback.')
        self.request = self.compiled.create_infer_request()
        self.device_name = device['name']

    def predict_details(self, frame):
        from backend.detection.yolo_onnx import predict_details
        def infer(tensor):
            self.request.infer({self.compiled.input(0): tensor})
            return self.request.get_output_tensor(0).data
        return predict_details(frame, infer, self.names)

    def predict(self, frame):
        return [{'bbox': item['bbox'], 'vehicle_type': item['vehicle_type']}
                for item in self.predict_details(frame)]


def intel_worker(connection, name):
    """One compiled model/request in a disposable child shared by all cameras."""
    try:
        adapter = OpenVINOAdapter(name)
        connection.send(('ok', {'execution_devices': adapter.execution_devices,
                                'device_name': adapter.device_name}))
        while True:
            frame = connection.recv()
            if frame is None:
                break
            result = (adapter.predict_details(frame['details']) if isinstance(frame, dict)
                      else adapter.predict(frame))
            connection.send(('ok', result))
    except EOFError:
        pass
    except Exception as error:
        try:
            connection.send(('error', str(error)))
        except (OSError, EOFError):
            pass
    finally:
        connection.close()
