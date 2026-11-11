"""Isolated preview API/lifecycle tests; operational DB and recordings are read-only."""
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import Mock, patch

from flask import Flask
from backend.cameras.sample_ai import MAPPINGS, PreviewError, PreviewManager, create_sample_ai_blueprint, resolve_mapping


class SampleAiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for video_id, (roi, bays, direction) in MAPPINGS.items():
            video = self.root / 'public' / video_id
            video.parent.mkdir(parents=True, exist_ok=True)
            video.write_bytes(b'fixture only')
            path = self.root / roi
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(dict(schema_version=1, source_video='public/' + video_id,
                source_width=100, source_height=100, frame_index=0, normalization='x/width, y/height',
                bays=[dict(id=b, direction=direction, points=[[0, 0], [1, 0], [1, 1], [0, 1]]) for b in bays])))
        self.video = next(iter(MAPPINGS))

    def test_mapping_all_exports_and_unsafe_ids(self):
        for video in MAPPINGS:
            _, data = resolve_mapping(self.root, video)
            self.assertEqual({b['id'] for b in data['bays']}, set(MAPPINGS[video][1]))
        for video in ('../private.mp4', '/private.mp4', 'sample-CCTV/Bays 1-3.mp4', [], None):
            with self.assertRaises(ValueError):
                resolve_mapping(self.root, video)

    def test_invalid_or_mismatched_roi(self):
        path = self.root / MAPPINGS[self.video][0]
        good = path.read_text()
        for key, value in [('source_video', 'public/sample-CCTV/Bays 6-10.mp4'), ('schema_version', 2),
                           ('normalization', 'pixels')]:
            data = json.loads(good)
            data[key] = value
            path.write_text(json.dumps(data))
            with self.assertRaises(ValueError):
                resolve_mapping(self.root, self.video)
        data = json.loads(good)
        data['bays'][0]['direction'] = 'southbound'
        path.write_text(json.dumps(data))
        with self.assertRaises(ValueError):
            resolve_mapping(self.root, self.video)
        data = json.loads(good)
        data['bays'][0]['points'][0] = [2, 3]
        path.write_text(json.dumps(data))
        with self.assertRaises(ValueError):
            resolve_mapping(self.root, self.video)
        path.write_text('{broken')
        with self.assertRaises(ValueError):
            resolve_mapping(self.root, self.video)

    def manager(self):
        context = Mock()
        parent, child, process = Mock(), Mock(), Mock()
        context.Pipe.return_value = parent, child
        context.Process.return_value = process
        process.is_alive.return_value = False
        manager = PreviewManager(self.root, context, clock=lambda: 100)
        manager.reaper_started = True  # No real maintenance threads in unit tests.
        self.addCleanup(manager.close)
        return manager, parent, process

    def test_single_worker_owner_and_cleanup(self):
        manager, pipe, process = self.manager()
        identifier = manager.start('owner', self.video, 'ioa')
        with self.assertRaises(PreviewError):
            manager.start('other', self.video, 'ground')
        with self.assertRaises(PreviewError):
            manager.stop('other', identifier)
        with self.assertRaises(PreviewError):
            manager.frame('other', identifier, True)
        self.assertIsNotNone(manager.session)
        pipe.poll.return_value = True
        pipe.recv.return_value = {'image': b'jpeg', 'frame': 0}
        self.assertEqual(manager.frame('owner', identifier, True)['image'], 'anBlZw==')
        pipe.send.assert_called_with({'advance': True})
        manager.stop('owner', identifier)
        self.assertIsNone(manager.session)
        process.join.assert_called()
        pipe.close.assert_called()

    def test_expiry_timeout_error_and_concurrent_frame(self):
        manager, pipe, _ = self.manager()
        identifier = manager.start('owner', self.video, 'ioa')
        manager.frame_lock.acquire()
        with self.assertRaises(PreviewError):
            manager.frame('owner', identifier, True)
        manager.frame_lock.release()
        pipe.poll.return_value = False
        with self.assertRaises(PreviewError):
            manager.frame('owner', identifier, True)
        self.assertIsNone(manager.session)
        identifier = manager.start('owner', self.video, 'ground')
        pipe.poll.return_value = True
        pipe.recv.return_value = {'error': 'Fixture model failure'}
        with self.assertRaises(PreviewError):
            manager.frame('owner', identifier, True)
        self.assertIsNone(manager.session)
        manager.start('owner', self.video, 'ioa')
        manager.clock = lambda: 121
        manager.reap()
        self.assertIsNone(manager.session)
        identifier = manager.start('owner', self.video, 'ioa')
        pipe.recv.side_effect = ValueError('handle closed during stop')
        with self.assertRaises(PreviewError) as failure:
            manager.frame('owner', identifier, True)
        self.assertEqual(failure.exception.status, 503)
        self.assertIsNone(manager.session)

    def test_local_admin_required_on_every_route(self):
        from backend import server
        db = self.root / 'test-admin.sqlite3'
        with closing(sqlite3.connect(db)) as conn, conn:
            conn.execute('CREATE TABLE admin_users (username TEXT, password_hash TEXT)')
            conn.execute('INSERT INTO admin_users VALUES (?, ?)', ('fixture', 'fixture-hash'))
        manager = Mock()
        app = Flask('sample-ai-auth-test')
        app.register_blueprint(create_sample_ai_blueprint(server.authorize_feed_configuration, self.root, manager))
        client = app.test_client()
        routes = [('GET', '/api/sample-ai/mappings'), ('POST', '/api/sample-ai/sessions'),
                  ('POST', '/api/sample-ai/sessions/id/frame'), ('DELETE', '/api/sample-ai/sessions/id')]
        with patch.object(server, 'DB_FILE', db):
            for headers in ({}, {'Authorization': 'Bearer not-a-local-admin-token'}):
                for method, path in routes:
                    response = client.open(path, method=method, headers=headers, json={})
                    self.assertEqual(response.status_code, 401)
                    self.assertEqual(response.headers['Cache-Control'], 'no-store')
            token = server.export_tokens.dumps(dict(username='fixture', credential_version=hashlib.sha256(b'fixture-hash').hexdigest()))
            headers = {'Authorization': 'Bearer ' + token}
            mappings = client.get('/api/sample-ai/mappings', headers=headers).json['mappings']
            self.assertEqual(len(mappings), 3)
            for mapping in mappings:
                _, original = resolve_mapping(self.root, mapping['videoId'])
                self.assertEqual(mapping['roi'], dict(width=original['source_width'], height=original['source_height'],
                    normalization=original['normalization'], polygons=original['bays']))
                self.assertEqual(set(mapping['bays']), {p['id'] for p in mapping['roi']['polygons']})
            with patch('itsdangerous.timed.time.time', return_value=4102444800):
                self.assertEqual(client.get('/api/sample-ai/mappings', headers=headers).status_code, 401)
            with closing(sqlite3.connect(db)) as conn, conn:
                conn.execute("UPDATE admin_users SET password_hash='changed'")
            self.assertEqual(client.get('/api/sample-ai/mappings', headers=headers).status_code, 401)
        manager.start.assert_not_called()
        manager.frame.assert_not_called()

    def test_api_contract_and_no_client_paths(self):
        manager, pipe, _ = self.manager()
        app = Flask('sample-ai-contract')
        app.register_blueprint(create_sample_ai_blueprint(lambda: None, self.root, manager))
        client = app.test_client()
        for payload in ({'videoId': '../secret', 'method': 'ioa'}, {'videoId': self.video, 'method': 'unknown'},
                        {'videoId': self.video, 'method': 'ioa', 'roi': '/secret'}, []):
            self.assertEqual(client.post('/api/sample-ai/sessions', json=payload).status_code, 400)
        result = client.post('/api/sample-ai/sessions', json={'videoId': self.video, 'method': 'ground'})
        self.assertEqual(result.status_code, 201)
        identifier = result.json['id']
        self.assertEqual(client.post(f'/api/sample-ai/sessions/{identifier}/frame', json={'advance': 'yes'}).status_code, 400)
        self.assertEqual(client.delete(f'/api/sample-ai/sessions/{identifier}').status_code, 200)
        self.assertTrue((self.root / 'public' / self.video).is_file())


@unittest.skipUnless(os.environ.get('TERMINALSIGHT_SAMPLE_AI_SMOKE') == '1', 'Explicit local-model smoke check only')
class RealPreviewSmoke(unittest.TestCase):
    def test_spawned_worker_decodes_predicts_and_stops(self):
        from backend.paths import ROOT
        manager = PreviewManager(ROOT)
        try:
            for video_id in MAPPINGS:
                for method in ('ioa', 'ground'):
                    with self.subTest(video=video_id, method=method):
                        identifier = manager.start('test-owner', video_id, method)
                        scratch = Path(manager.session['scratch'].name)
                        frame = manager.frame('test-owner', identifier, True)
                        self.assertEqual(frame['method'], method)
                        self.assertEqual(set(frame['states']), set(MAPPINGS[video_id][1]))
                        self.assertGreater(len(frame['image']), 100)
                        paused = manager.frame('test-owner', identifier, False)
                        self.assertEqual(frame['frame'], paused['frame'])
                        resumed = manager.frame('test-owner', identifier, True)
                        self.assertGreater(resumed['frame'], frame['frame'])
                        manager.stop('test-owner', identifier)
                        self.assertIsNone(manager.session)
                        self.assertFalse(scratch.exists())
        finally:
            manager.close()


if __name__ == '__main__':
    unittest.main()
