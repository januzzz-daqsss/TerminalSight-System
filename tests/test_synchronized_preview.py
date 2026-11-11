"""No operational initialization, model loading or real database mutations."""
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock

import cv2
import numpy as np
from flask import Flask, request
from backend.cameras.synchronized_preview import PILOT_VIDEO, create_synchronized_blueprint
from backend.detection.detection_runtime import DetectionRuntime


class Capture:
    def __init__(self, path):
        self.index, self.closed = 0, False

    def isOpened(self):
        return True

    def get(self, key):
        return {cv2.CAP_PROP_FPS: 15, cv2.CAP_PROP_FRAME_COUNT: 150,
                cv2.CAP_PROP_POS_FRAMES: self.index + 1, cv2.CAP_PROP_POS_MSEC: self.index / 15 * 1000}[key]

    def set(self, key, index):
        self.index = index
        return True

    def read(self):
        return True, np.zeros((100, 100, 3), np.uint8)

    def release(self):
        self.closed = True


class SynchronizedPreviewTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        video = self.root / 'public' / PILOT_VIDEO
        video.parent.mkdir(parents=True)
        video.write_bytes(b'fixture')
        roi = self.root / 'config/roi/bays-1-2.json'
        roi.parent.mkdir(parents=True)
        roi.write_text(json.dumps(dict(schema_version=1, source_video='public/' + PILOT_VIDEO,
            source_width=100, source_height=100, frame_index=0, normalization='x/width, y/height',
            bays=[dict(id=f'Bay_{n}', direction='northbound', points=points) for n, points in (
                (1, [[0, 0], [.4, 0], [.4, 1], [0, 1]]), (2, [[.6, 0], [1, 0], [1, 1], [.6, 1]]))])))
        self.runtime = Mock()
        self.runtime.predict_diagnostic.return_value = ([dict(bbox=[0, 0, 40, 90], class_name='bus', class_id=0,
            vehicle_type='Bus', confidence=.91)], dict(model='yolov8', device='amd'))
        self.captures = []
        def capture(path):
            result = Capture(path)
            self.captures.append(result)
            return result
        self.now = 100.
        app = Flask('sync-fixture')
        app.register_blueprint(create_synchronized_blueprint(
            lambda: None if request.headers.get('Authorization') == 'Bearer fixture' else ({'message': 'Denied'}, 401),
            self.root, self.runtime, capture, clock=lambda: self.now))
        self.client = app.test_client()
        self.headers = {'Authorization': 'Bearer fixture'}
        self.payload = dict(videoId=PILOT_VIDEO, seconds=1.03, epoch=2, method='ioa')

    def call(self, **changes):
        return self.client.post('/api/sample-monitor/frame', headers=self.headers, json={**self.payload, **changes})

    def test_timestamp_classification_and_isolation(self):
        response = self.call()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json['frame'], 15)
        self.assertEqual(response.json['seconds'], 1)
        self.assertEqual(response.json['epoch'], 2)
        self.assertEqual(response.json['runtime']['device'], 'amd')
        self.assertEqual(response.json['states'], {'Bay_1': 'OCCUPIED', 'Bay_2': 'AVAILABLE'})
        self.assertEqual(response.json['detections'][0]['confidence'], .91)
        self.assertNotIn('ocr', response.json)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertTrue(self.captures[0].closed)
        self.assertEqual([call[0] for call in self.runtime.mock_calls], ['predict_diagnostic'])
        self.assertFalse(list(self.root.rglob('*.db')))

    def test_unauthorized_and_other_recordings_rejected_before_decode(self):
        self.assertEqual(self.client.post('/api/sample-monitor/frame', json=self.payload).status_code, 401)
        for video in ('../private', 'sample-CCTV/Bays 2-5.mp4', 'sample-CCTV/Bays 6-10.mp4'):
            self.assertEqual(self.call(videoId=video).status_code, 400)
        for value in (-1, float('nan'), True):
            self.assertEqual(self.call(seconds=value).status_code, 400)
        self.assertEqual(self.call(epoch=-1).status_code, 400)
        self.assertEqual(self.call(method='fake').status_code, 400)
        self.assertFalse(self.captures)

    def test_limits_concurrency_and_cleans_failure(self):
        nested = []
        def prediction(frame):
            nested.append(self.call().status_code)
            raise RuntimeError('busy')
        self.runtime.predict_diagnostic.side_effect = prediction
        self.assertEqual(self.call().status_code, 503)
        self.assertEqual(nested, [429])
        self.assertTrue(self.captures[0].closed)
        self.assertEqual(self.call().status_code, 429)
        self.now += 1
        self.assertEqual(self.call().status_code, 503)
        self.assertTrue(all(cap.closed for cap in self.captures))

    def test_geometry_and_confidence_fail_closed(self):
        self.runtime.predict_diagnostic.return_value[0][0]['confidence'] = float('nan')
        self.assertEqual(self.call().status_code, 400)
        self.now += 1
        roi = self.root / 'config/roi/bays-1-2.json'
        data = json.loads(roi.read_text())
        data['source_video'] = 'public/sample-CCTV/Bays 2-5.mp4'
        roi.write_text(json.dumps(data))
        self.assertEqual(self.call().status_code, 400)

    def test_shared_runtime_never_switches_or_loads_another_model(self):
        runtime = DetectionRuntime(config_path=self.root / 'never-written.json')
        runtime.adapter = Mock()
        runtime.adapter.predict.return_value = []
        runtime.device = 'amd'
        result, selection = runtime.predict_diagnostic('frame')
        self.assertEqual(selection, {'model': 'yolov8', 'device': 'amd'})
        runtime.adapter.predict.assert_called_once_with('frame', details=True)
        entered, release = threading.Event(), threading.Event()
        def hold():
            with runtime.lock:
                entered.set()
                release.wait(5)
        thread = threading.Thread(target=hold)
        thread.start(); entered.wait(5)
        try:
            with self.assertRaises(RuntimeError):
                runtime.predict_diagnostic('busy')
        finally:
            release.set(); thread.join()
        runtime.model = 'ssd300_vgg16'
        with self.assertRaises(RuntimeError):
            runtime.predict_diagnostic('wrong-model')
        self.assertFalse(runtime.config_path.exists())


if __name__ == '__main__':
    unittest.main()
