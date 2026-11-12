"""Isolated captures, detector doubles and temporary feed DB; no operational writes."""
import ast
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch
import cv2
import numpy as np
from flask import Flask, request
from backend.cameras.integrated_preview import IntegratedPreview, create_integrated_blueprint, freshness, render_overlay, PILOT
from backend.cameras.sample_ai import MAPPINGS
from backend.cameras.roi_catalog import describe_feed


class Capture:
    def __init__(self, path):
        self.next = 0
        self.closed = False
        self.count = 80
    def get(self, key):
        return {cv2.CAP_PROP_FPS: 20., cv2.CAP_PROP_FRAME_COUNT: self.count,
                cv2.CAP_PROP_POS_FRAMES: self.next}[key]
    def set(self, key, value):
        self.next = int(value)
        return True
    def grab(self):
        self.next += 1
        return self.next <= self.count
    def read(self):
        self.next += 1
        return self.next <= self.count, np.zeros((100, 100, 3), np.uint8)
    def release(self): self.closed = True


def wait_for(predicate, timeout=3):
    until = time.monotonic() + timeout
    while time.monotonic() < until:
        if predicate(): return
        time.sleep(.01)
    raise AssertionError('Timed out waiting for preview condition')


class IntegratedTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        video = self.root / 'public' / PILOT
        video.parent.mkdir(parents=True); video.write_bytes(b'fixture')
        self.roi_path = self.root / 'config/roi/bays-1-2.json'
        self.roi_path.parent.mkdir(parents=True)
        self.document = dict(schema_version=1, source_video='public/' + PILOT, source_width=100,
            source_height=100, frame_index=0, normalization='x/width, y/height', bays=[
                dict(id=f'Bay_{n}', direction='northbound', points=points) for n, points in [
                (1, [[0, 0], [.4, 0], [.4, 1], [0, 1]]), (2, [[.6, 0], [1, 0], [1, 1], [.6, 1]])]])
        self.roi_path.write_text(json.dumps(self.document))
        self.runtime = Mock()
        self.prediction = ([dict(bbox=[0, 0, 40, 95], vehicle_type='Bus', class_name='bus', confidence=.9)], {'model': 'yolov8', 'device': 'amd'})
        self.runtime.predict_diagnostic.return_value = self.prediction
        self.captures = []
        def capture(path):
            cap = Capture(path); self.captures.append(cap); return cap
        self.manager = IntegratedPreview(self.root, self.runtime, capture)
        self.addCleanup(self.manager.close)
        self.database = self.root / 'feeds.sqlite3'
        with closing(sqlite3.connect(self.database)) as conn, conn:
            conn.execute('CREATE TABLE feeds (id TEXT PRIMARY KEY, configuration TEXT)')
            conn.execute('INSERT INTO feeds VALUES (?, ?)', ('pilot', json.dumps(dict(kind='sample', videoId=PILOT, direction='northbound', bays=[1, 2], roiId='bays-1-2.json'))))
            self.records = {PILOT: 'pilot'}
            for index, (video_id, (relative, bays, direction)) in enumerate(MAPPINGS.items()):
                if video_id == PILOT:
                    continue
                (self.root / 'public' / video_id).write_bytes(b'fixture')
                document = {**self.document, 'source_video': 'public/' + video_id, 'bays': [
                    dict(id=bay, direction=direction, points=[[0, 0], [.4, 0], [.4, 1], [0, 1]])
                    for bay in reversed(bays)]}
                (self.root / relative).write_text(json.dumps(document))
                identifier = f'mapped-{index}'
                self.records[video_id] = identifier
                conn.execute('INSERT INTO feeds VALUES (?, ?)', (identifier, json.dumps(dict(kind='sample', videoId=video_id,
                    direction=direction, bays=[int(bay[4:]) for bay in bays], roiId=Path(relative).name))))
        app = Flask('integrated-test')
        app.register_blueprint(create_integrated_blueprint(
            lambda: None if request.headers.get('Authorization') in ('Bearer local', 'Bearer other') else ({'message': 'Denied'}, 401),
            self.root, lambda: self.database, self.manager))
        self.client, self.headers = app.test_client(), {'Authorization': 'Bearer local'}

    def start(self, feed_id='pilot'):
        response = self.client.post('/api/sample-preview', headers=self.headers, json={'feedId': feed_id})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json['id']

    def test_authenticated_stream_owner_controls_and_readonly_db(self):
        before = self.database.read_bytes()
        for method, url in [('POST', '/api/sample-preview'), ('GET', '/api/sample-preview/x'),
                            ('PATCH', '/api/sample-preview/x'), ('DELETE', '/api/sample-preview/x'),
                            ('GET', '/api/sample-preview/x/stream?token=local')]:
            self.assertEqual(self.client.open(url, method=method, json={}).status_code, 401)
        self.assertEqual(self.captures, [])
        identifier = self.start()
        self.assertEqual(self.client.get(f'/api/sample-preview/{identifier}', headers={'Authorization': 'Bearer other'}).status_code, 404)
        self.assertEqual(self.client.post('/api/sample-preview', headers={'Authorization': 'Bearer other'}, json={'feedId': 'pilot'}).status_code, 409)
        response = self.client.get(f'/api/sample-preview/{identifier}/stream', headers=self.headers, buffered=False)
        part = next(iter(response.response))
        self.assertIn(b'Content-Type: image/jpeg', part)
        self.assertIn(b'X-Generation: 0', part)
        self.assertNotIn(b'local', part)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(self.client.get(f'/api/sample-preview/{identifier}/stream', headers=self.headers).status_code, 409)
        response.close()
        wait_for(lambda: self.captures[0].closed)
        self.assertEqual(self.database.read_bytes(), before)
        self.runtime.close.assert_not_called()
        self.runtime.initialize.assert_not_called()

    def test_switch_cleanup_and_one_inference_across_sessions(self):
        entered, release = threading.Event(), threading.Event()
        self.addCleanup(release.set)
        def slow(frame):
            entered.set(); release.wait(3); return self.prediction
        self.runtime.predict_diagnostic.side_effect = slow
        first = self.start(); self.assertTrue(entered.wait(2))
        s = self.manager.session
        wait_for(lambda: s.position >= 3)
        self.assertIsNone(s.result)  # Playback advances while inference is blocked.
        second = self.start(self.records['sample-CCTV/Bays 6-10.mp4'])
        self.assertNotEqual(first, second)
        self.assertTrue(self.captures[0].closed)
        self.assertFalse(s.thread.is_alive())
        time.sleep(.15)
        self.assertEqual(self.runtime.predict_diagnostic.call_count, 1)
        release.set()
        wait_for(lambda: self.manager.session.result is not None)
        self.assertEqual(sum(not c.closed for c in self.captures), 1)
        self.assertEqual(self.client.delete(f'/api/sample-preview/{first}', headers=self.headers).status_code, 404)
        self.assertEqual(self.client.delete(f'/api/sample-preview/{second}', headers=self.headers).status_code, 200)
        self.assertTrue(all(c.closed for c in self.captures))

    def test_seek_generation_pause_resume_and_loop(self):
        identifier = self.start(); s = self.manager.session
        url = f'/api/sample-preview/{identifier}'
        wait_for(lambda: s.result is not None)
        paused = self.client.patch(url, headers=self.headers, json={'action': 'pause'}).json
        self.assertTrue(paused['paused']); self.assertGreater(paused['generation'], 0)
        self.client.patch(url, headers=self.headers, json={'action': 'seek', 'seconds': 2})
        wait_for(lambda: s.position == 40)
        generation = s.generation
        time.sleep(.15); self.assertEqual(s.position, 40)
        wait_for(lambda: s.result is not None and s.result['generation'] == generation)
        self.client.patch(url, headers=self.headers, json={'action': 'play'})
        wait_for(lambda: s.position > 40)
        self.client.patch(url, headers=self.headers, json={'action': 'seek', 'seconds': 3.9})
        generation = s.generation
        wait_for(lambda: s.generation > generation)
        wait_for(lambda: s.position < 20)
        self.client.patch(url, headers=self.headers, json={'action': 'restart'})
        self.assertGreater(s.generation, generation)
        self.assertEqual(self.client.patch(url, headers=self.headers, json={'action': 'seek', 'seconds': -1}).status_code, 400)

    def test_stale_inference_cannot_overwrite_seek(self):
        entered, release = threading.Event(), threading.Event()
        self.addCleanup(release.set)
        def old(frame):
            entered.set(); release.wait(3); return self.prediction
        self.runtime.predict_diagnostic.side_effect = old
        identifier = self.start(); self.assertTrue(entered.wait(2))
        self.client.patch(f'/api/sample-preview/{identifier}', headers=self.headers, json={'action': 'seek', 'seconds': 2})
        self.runtime.predict_diagnostic.side_effect = RuntimeError('busy')
        release.set()
        time.sleep(.3)
        self.assertIsNone(self.manager.session.result)
        self.assertFalse(self.manager.session.stop.is_set())

    def test_freshness_overlay_mapping_and_classification(self):
        self.start(); s = self.manager.session
        wait_for(lambda: s.result is not None)
        self.assertEqual(s.result['states'], {'Bay_1': 'OCCUPIED', 'Bay_2': 'AVAILABLE'})
        result = {**s.result, 'generation': 3, 'seconds': 5, 'submitted': 100}
        self.assertEqual(freshness(result, 3, 5.2, 100.5), (True, True))
        self.assertEqual(freshness(result, 3, 6, 101), (True, False))
        self.assertEqual(freshness(result, 3, 5, 103), (False, False))
        self.assertEqual(freshness(result, 4, 5, 100), (False, False))
        raw = np.zeros((100, 100, 3), np.uint8)
        rendered, valid = render_overlay(raw, s.roi, result, 3, 5, 100)
        self.assertTrue(valid); self.assertFalse(raw.any()); self.assertTrue(rendered.any())
        colors = {tuple(pixel) for row in rendered for pixel in row}
        self.assertIn((94, 197, 34), colors); self.assertIn((68, 68, 239), colors)
        result['detections'][0].pop('confidence')  # Missing confidence is allowed, never fabricated.
        render_overlay(raw, s.roi, result, 3, 5, 100)
        self.runtime.predict_diagnostic.return_value = ([dict(bbox=[0, 0, 40, 90], vehicle_type='UV Express', class_name='bus')], {})
        with self.assertRaises(ValueError): self.manager._infer(raw, s.roi, 3, 5, 100)

    def test_invalid_mapping_releases_capture_and_other_videos_denied(self):
        self.document['source_width'] = 200
        self.roi_path.write_text(json.dumps(self.document))
        response = self.client.post('/api/sample-preview', headers=self.headers, json={'feedId': 'pilot'})
        self.assertEqual(response.status_code, 400)
        self.assertTrue(self.captures[0].closed)
        self.assertIsNone(self.manager.session)
        with self.assertRaises(ValueError): self.manager.start('x', 'sample-CCTV/Bays 1-3.mp4', 'bays-1-2.json')

    def test_all_recordings_cpu_assignment_and_single_session_switching(self):
        self.runtime.predict_diagnostic.return_value = (self.prediction[0], {'model': 'yolov8', 'device': 'cpu'})
        before = self.database.read_bytes()
        previous = None
        for video_id, (relative, bays, direction) in MAPPINGS.items():
            with self.subTest(video=video_id):
                identifier = self.start(self.records[video_id])
                session = self.manager.session
                if previous:
                    self.assertTrue(previous.stop.is_set())
                    self.assertFalse(previous.thread.is_alive())
                    self.assertTrue(previous.cap.closed)
                wait_for(lambda: session.result is not None)
                self.assertEqual(set(session.result['states']), set(bays))
                self.assertEqual(list(session.roi.polygons), [bay['id'] for bay in json.loads((self.root / relative).read_text())['bays']])
                self.assertEqual(session.selection['device'], 'cpu')
                self.assertEqual(sum(not cap.closed for cap in self.captures), 1)
                feed = dict(kind='sample', videoId=video_id, roiId=Path(relative).name,
                            direction=direction, bays=[int(bay[4:]) for bay in bays])
                with patch('backend.cameras.roi_catalog._dimensions', return_value=(100, 100)):
                    self.assertTrue(describe_feed(self.root, feed)['integratedAiCompatible'])
                    self.assertFalse(describe_feed(self.root, {**feed, 'roiId': ''})['integratedAiCompatible'])
                previous = session
        self.manager.stop(previous.owner, identifier)
        self.assertEqual(self.database.read_bytes(), before)
        self.runtime.switch.assert_not_called()
        self.runtime.initialize.assert_not_called()

    def test_recording_associations_defaults_and_mismatches(self):
        for video_id, (relative, bays, direction) in MAPPINGS.items():
            identifier = self.records[video_id]
            original = dict(kind='sample', videoId=video_id, direction=direction, bays=[int(b[4:]) for b in bays])
            # Old saved feeds without roiId use their explicit recording-specific default.
            with closing(sqlite3.connect(self.database)) as conn, conn:
                conn.execute('UPDATE feeds SET configuration=? WHERE id=?', (json.dumps(original), identifier))
            session_id = self.start(identifier)
            self.assertEqual(set(self.manager.session.roi.polygons), set(bays))
            self.manager.stop(self.manager.session.owner, session_id)
            for change in ({'roiId': ''}, {'roiId': '../bays-1-2.json'},
                           {'roiId': Path(relative).name, 'direction': 'southbound' if direction == 'northbound' else 'northbound'},
                           {'roiId': Path(relative).name, 'bays': [10] if direction == 'northbound' else [1]}):
                with closing(sqlite3.connect(self.database)) as conn, conn:
                    conn.execute('UPDATE feeds SET configuration=? WHERE id=?', (json.dumps({**original, **change}), identifier))
                response = self.client.post('/api/sample-preview', headers=self.headers, json={'feedId': identifier})
                self.assertEqual(response.status_code, 400, response.text)
        with self.assertRaises(ValueError):
            self.manager.start('owner', 'sample-CCTV/Bays 2-5.mp4', 'bays-6-10.json')
        data = json.loads((self.root / 'config/roi/bays-2-5.json').read_text())
        data['bays'][0]['id'] = 'Bay_2'
        (self.root / 'config/roi/bays-2-5.json').write_text(json.dumps(data))
        with self.assertRaises(ValueError):
            self.manager.start('owner', 'sample-CCTV/Bays 2-5.mp4', 'bays-2-5.json')

    def test_missing_authenticated_heartbeat_expires_session(self):
        self.start()
        session = self.manager.session
        with session.condition:
            session.touched = time.monotonic() - 21
        wait_for(lambda: self.manager.session is None, timeout=3)
        self.assertTrue(self.captures[0].closed)
        self.assertFalse(session.thread.is_alive())

    def test_operational_imports_and_old_worker_endpoints_are_not_used(self):
        from backend.cameras import integrated_preview
        tree = ast.parse(Path(integrated_preview.__file__).read_text())
        imports = [node.module or '' for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)]
        self.assertFalse(any(name.startswith(('backend.state', 'backend.ocr', 'backend.server')) for name in imports))
        from backend.cameras.sample_ai import create_sample_ai_blueprint
        from backend.cameras.synchronized_preview import create_synchronized_blueprint
        app = Flask('retired')
        app.register_blueprint(create_sample_ai_blueprint(lambda: None, self.root, retired=True))
        app.register_blueprint(create_synchronized_blueprint(lambda: None, self.root, retired=True))
        for url in ('/api/sample-ai/sessions', '/api/sample-monitor/frame'):
            self.assertEqual(app.test_client().post(url, json={}).status_code, 409)


if __name__ == '__main__': unittest.main()
