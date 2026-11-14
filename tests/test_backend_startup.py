"""Regression checks for package paths, safe imports and launcher startup."""
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


class BackendStartupTests(unittest.TestCase):
    def test_imports_and_resources_from_another_working_directory(self):
        # A fresh interpreter also catches accidental startup during spawn imports.
        code = '''
import multiprocessing, runpy, sqlite3, sys, threading
from pathlib import Path
from unittest.mock import patch
root = Path(sys.argv[1])
with patch.object(sqlite3, 'connect', side_effect=AssertionError('import touched DB')), \\
     patch.object(threading.Thread, 'start', side_effect=AssertionError('import started thread')):
    import app
    runpy.run_path(str(root / 'app.py'), run_name='__mp_main__')
    assert 'backend.server' not in sys.modules
    from backend import server
    from backend.paths import DATABASE_PATH, SAMPLE_VIDEO_DIR
    from backend.detection import detector, detection_runtime, detection_directml
    from backend.ocr.route_recognition import CONFIG_PATH, load_config
    assert server.DB_FILE == DATABASE_PATH == root / 'terminalsight.db'
    assert SAMPLE_VIDEO_DIR == root / 'public' / 'sample-videos'
    assert CONFIG_PATH == root / 'config' / 'routes.json'
    assert load_config()['routes']
    assert detector.runtime is detection_runtime.runtime
    assert detector.runtime.adapter is None
    assert detector.runtime.config_path == root / 'config' / 'detection.local.json'
    for name in detection_runtime.MODELS:
        assert detection_runtime.weights_path(name).is_relative_to(root / 'trained_models')
        assert detection_runtime.amd_weights_path(name) == detection_directml.onnx_path(name)
    assert server.ocr_worker is None
    assert not multiprocessing.active_children()
'''
        with tempfile.TemporaryDirectory() as folder:
            result = subprocess.run(
                [sys.executable, '-B', '-c', code, str(ROOT)], cwd=folder,
                env={**os.environ, 'PYTHONPATH': str(ROOT), 'PYTHONDONTWRITEBYTECODE': '1'},
                capture_output=True, text=True, timeout=60,
            )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_root_launcher_delegates_once(self):
        from backend import server
        with patch.object(server, 'main') as main, patch('multiprocessing.freeze_support') as freeze:
            runpy.run_path(str(ROOT / 'app.py'), run_name='__main__')
        freeze.assert_called_once_with()
        main.assert_called_once_with()

    def test_main_initializes_one_detector_ocr_and_managed_cameras(self):
        from backend import server
        from backend.detection.detection_runtime import runtime
        with patch.dict(os.environ, {'TERMINALSIGHT_DISABLE_AI': '0'}), \
             patch.object(server, 'init_db') as initialize_db, \
             patch.object(runtime, 'initialize') as initialize_detector, \
             patch.object(server, 'OCRWorker') as ocr, \
             patch.object(server, 'ocr_worker', None), \
             patch.object(server, 'camera_manager', None), \
             patch.object(server.occupancy, 'history', None), \
             patch.object(server, 'CameraManager') as manager, \
             patch('backend.state.occupancy_history.OccupancyHistory') as history, \
             patch.object(server.app, 'run') as serve, patch('builtins.print'):
            server.main()
            initialize_db.assert_called_once_with()
            initialize_detector.assert_called_once_with()
            ocr.assert_called_once_with(server.occupancy)
            ocr.return_value.start.assert_called_once_with()
            manager.assert_called_once_with(server.ROOT, server.app.config['CAMERA_FEEDS_DATABASE'], server.occupancy, server.run_ai_background, ocr.return_value)
            manager.return_value.start.assert_called_once_with()
            manager.return_value.close.assert_called_once_with()
            history.assert_called_once_with(server.DB_FILE)
            ocr.return_value.stop.assert_called_once_with()
            serve.assert_called_once_with(port=5000, debug=False)

    def test_api_only_startup_does_not_start_inference_or_cameras(self):
        from backend import server
        from backend.detection.detection_runtime import runtime
        with patch.dict(os.environ, {'TERMINALSIGHT_DISABLE_AI': '1'}), \
             patch.object(server, 'init_db') as initialize_db, \
             patch.object(runtime, 'initialize') as initialize_detector, \
             patch.object(server, 'OCRWorker') as ocr, \
             patch.object(server.threading, 'Thread') as thread, \
             patch.object(server.app, 'run') as serve, patch('builtins.print'):
            server.main()
            initialize_db.assert_called_once_with()
            initialize_detector.assert_not_called()
            ocr.assert_not_called()
            thread.assert_not_called()
            serve.assert_called_once_with(port=5000, debug=False)
