"""Optional Intel discovery; never select a CPU through OpenVINO AUTO/HETERO."""
from functools import lru_cache
import os


@lru_cache(maxsize=4)
def intel_device(requested=None):
    try:
        import onnx  # Needed to validate local export metadata before compilation.
        from openvino import Core
        core = Core()
        gpus = sorted(d for d in core.available_devices if d == 'GPU' or d.startswith('GPU.'))
        target = requested or (gpus[0] if gpus else None)
        if target not in gpus:
            return {'available': False, 'target': None, 'reason': 'Requested Intel GPU is not available.'}
        name = str(core.get_property(target, 'FULL_DEVICE_NAME'))
        if 'intel' not in name.lower():
            return {'available': False, 'target': None, 'reason': 'GPU is not identified as Intel.'}
        return {'available': True, 'target': target, 'name': name, 'reason': None}
    except Exception:
        return {'available': False, 'target': None,
                'reason': 'Optional OpenVINO/ONNX runtime or Intel GPU driver is unavailable.'}


def intel_status():
    return dict(intel_device(os.environ.get('TERMINALSIGHT_INTEL_DEVICE') or None))
