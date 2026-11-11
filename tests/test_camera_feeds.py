"""Isolated feed configuration tests; never touch operational databases/videos."""
import hashlib
import json
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from flask import Flask
from backend import server
from backend.cameras.feed_config import create_feed_blueprint


class CameraFeedTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.database = self.root / 'admin.sqlite3'
        self.feeds_db = self.root / 'config' / 'feeds.sqlite3'
        self.public = self.root / 'public'
        for directory in ('sample-CCTV', 'sample-videos', 'unrelated'):
            (self.public / directory).mkdir(parents=True)
        self.video = self.public / 'sample-CCTV' / 'Bays 1-2.mp4'
        self.video.write_bytes(b'test recording, not a real video')
        (self.public / 'sample-videos' / 'older.webm').write_bytes(b'older')
        (self.public / 'sample-CCTV' / 'legacy.avi').write_bytes(b'legacy')
        (self.public / 'sample-CCTV' / 'not-video.txt').write_text('excluded')
        (self.public / 'unrelated' / 'private.mp4').write_bytes(b'excluded')
        with closing(sqlite3.connect(self.database)) as conn, conn:
            conn.execute('CREATE TABLE admin_users (username TEXT, password_hash TEXT)')
            conn.execute('INSERT INTO admin_users VALUES (?, ?)', ('fixture-admin', 'fixture-hash'))
        self.addCleanup(patch.stopall)
        patch.object(server, 'DB_FILE', self.database).start()
        patch.dict(server.app.config, CAMERA_FEEDS_DATABASE=self.feeds_db, CAMERA_SAMPLE_ROOT=self.public).start()
        self.client = server.app.test_client()
        self.headers = {'Authorization': 'Bearer ' + server.export_tokens.dumps({
            'username': 'fixture-admin', 'credential_version': hashlib.sha256(b'fixture-hash').hexdigest()})}
        self.sample = dict(kind='sample', name='North recording', direction='northbound', bays=[1, 2],
                           videoId='sample-CCTV/Bays 1-2.mp4', address='', transport='tcp')
        self.live = dict(kind='live', name='South camera', direction='southbound', bays=[6, 7],
                         address='camera.example.test:554/stream', transport='tcp', videoId='')

    def test_all_routes_require_local_admin_before_reading_or_writing(self):
        for headers in ({}, {'Authorization': 'Bearer invalid-supabase-or-local-token'}):
            for method, path in [('GET', '/api/camera-feeds'), ('POST', '/api/camera-feeds'),
                                 ('GET', '/api/camera-feeds/videos'), ('PATCH', '/api/camera-feeds/id'), ('DELETE', '/api/camera-feeds/id'),
                                 ('GET', '/api/camera-feeds/roi?videoId=sample-CCTV/Bays%201-2.mp4'),
                                 ('PATCH', '/api/camera-feeds/display/1'), ('POST', '/api/sample-monitor/frame')]:
                response = self.client.open(path, method=method, headers=headers, json=self.live)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertFalse(self.feeds_db.exists())
        with patch('itsdangerous.timed.time.time', return_value=4102444800):
            self.assertEqual(self.client.get('/api/camera-feeds', headers=self.headers).status_code, 401)
        with closing(sqlite3.connect(self.database)) as conn, conn:
            conn.execute("UPDATE admin_users SET password_hash = 'changed'")
        self.assertEqual(self.client.get('/api/camera-feeds', headers=self.headers).status_code, 401)

    def test_catalog_is_limited_and_encodes_filenames(self):
        response = self.client.get('/api/camera-feeds/videos', headers=self.headers)
        videos = response.json['videos']
        self.assertEqual(len(videos), 3)
        chosen = next(v for v in videos if v['filename'] == self.video.name)
        self.assertEqual(chosen['url'], '/sample-CCTV/Bays%201-2.mp4')
        self.assertTrue(chosen['preview'])
        self.assertFalse(next(v for v in videos if v['filename'] == 'legacy.avi')['preview'])
        self.assertNotIn(str(self.root), response.text)

    def test_crud_persists_and_never_deletes_original_video(self):
        before = self.video.read_bytes()
        identifiers = []
        for draft in (self.sample, self.live):
            response = self.client.post('/api/camera-feeds', headers=self.headers, json=draft)
            self.assertEqual(response.status_code, 201, response.text)
            feed = response.json['feed']
            identifiers.append(feed['id'])
            response = self.client.patch('/api/camera-feeds/' + feed['id'], headers=self.headers, json={**draft, 'name': 'Edited feed'})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json['feed']['name'], 'Edited feed')
        restarted = Flask('restarted-test')
        restarted.register_blueprint(create_feed_blueprint(lambda: None, lambda: self.feeds_db, lambda: self.public))
        saved = restarted.test_client().get('/api/camera-feeds').json['feeds']
        self.assertEqual(len(saved), 2)
        self.assertEqual(saved[1]['address'], 'rtsp://camera.example.test:554/stream')
        for identifier in identifiers:
            self.assertEqual(self.client.delete('/api/camera-feeds/' + identifier, headers=self.headers).status_code, 200)
        self.assertEqual(self.client.get('/api/camera-feeds', headers=self.headers).json['feeds'], [])
        self.assertEqual(self.video.read_bytes(), before)

    def test_invalid_configuration_and_credentials_are_not_saved(self):
        cases = [[], {**self.live, 'kind': []}, {**self.live, 'direction': []},
                 {**self.live, 'bays': [1]}, {**self.live, 'bays': []}, {**self.live, 'bays': [True]},
                 {**self.live, 'name': ''}, {**self.live, 'transport': []}, {**self.live, 'password': 'fixture-secret'},
                 {**self.sample, 'videoId': '../private.mp4'}, {**self.sample, 'videoId': 'missing.mp4'},
                 {**self.sample, 'address': 'rtsp://example.test/stream'}]
        for address in ('rtsp://user:fixture-secret@example.test/stream', 'rtsp://example.test/stream?password=fixture-secret',
                        'rtsp://example.test/stream#fixture-secret', 'file:///private', 'http://example.test',
                        'rtsp://example.test:99999/stream', 'rtsp://example.test:0/stream', 'rtsp://user%40example.test/stream'):
            cases.append({**self.live, 'address': address})
        for data in cases:
            response = self.client.post('/api/camera-feeds', headers=self.headers, json=data)
            self.assertEqual(response.status_code, 400, response.text)
            self.assertNotIn('fixture-secret', response.text)
        self.assertFalse(self.feeds_db.exists())

    def test_missing_feeds_and_mode_changes_fail_without_changing_existing(self):
        feed = self.client.post('/api/camera-feeds', headers=self.headers, json=self.sample).json['feed']
        response = self.client.patch('/api/camera-feeds/' + feed['id'], headers=self.headers, json=self.live)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.patch('/api/camera-feeds/missing', headers=self.headers, json=self.live).status_code, 404)
        self.assertEqual(self.client.delete('/api/camera-feeds/missing', headers=self.headers).status_code, 404)
        self.video.unlink()  # Only the temporary fixture.
        self.assertEqual(len(self.client.get('/api/camera-feeds', headers=self.headers).json['feeds']), 1)
        self.assertEqual(self.client.delete('/api/camera-feeds/' + feed['id'], headers=self.headers).status_code, 200)

    def test_body_limit_is_enforced(self):
        response = self.client.post('/api/camera-feeds', headers=self.headers, json={**self.live, 'name': 'x' * 17000})
        self.assertEqual(response.status_code, 413)

    def test_legacy_display_edit_hide_restore_persist_without_operational_changes(self):
        admin_before = self.database.read_bytes()
        video_before = self.video.read_bytes()
        saved_feed = self.client.post('/api/camera-feeds', headers=self.headers, json=self.sample).json['feed']
        settings = dict(name='Renamed camera', direction='southbound', bays=[8, 10], hidden=False)
        # North worker may have south display labels, but no worker/source field is accepted.
        for hidden in (False, True, False):
            settings['hidden'] = hidden
            result = self.client.patch('/api/camera-feeds/display/1', headers=self.headers, json=settings)
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json['display'], {'id': 1, **settings})
            restarted = Flask('display-restart')
            restarted.register_blueprint(create_feed_blueprint(lambda: None, lambda: self.feeds_db, lambda: self.public))
            snapshot = restarted.test_client().get('/api/camera-feeds').json
            self.assertEqual(snapshot['legacyDisplays'], [{'id': 1, **settings}])
            self.assertEqual(snapshot['feeds'], [saved_feed])
        self.assertEqual(self.database.read_bytes(), admin_before)
        self.assertEqual(self.video.read_bytes(), video_before)
        # The module has no operational worker, database, runtime or state imports.
        import ast
        import backend.cameras.feed_config as module
        imports = [node.module or '' for node in ast.walk(ast.parse(Path(module.__file__).read_text()))
                   if isinstance(node, ast.ImportFrom)]
        self.assertFalse(any(name.startswith(('backend', 'app')) and name != 'backend.cameras.roi_catalog' for name in imports))

    def test_explicit_roi_registration_validation_and_missing_mapping(self):
        folder = self.root / 'config/roi'
        folder.mkdir(parents=True)
        data = dict(schema_version=1, source_video='public/' + self.sample['videoId'],
                    source_width=2304, source_height=1296, frame_index=10,
                    normalization='x/width, y/height', bays=[dict(id='Bay_2', direction='northbound',
                    points=[[0, 0], [.5, 0], [.5, .5], [0, .5]])])
        path = folder / 'new-view.json'
        path.write_text(json.dumps(data), encoding='utf-8')
        admin_before = self.database.read_bytes()
        video_before = self.video.read_bytes()
        with patch('backend.cameras.roi_catalog._dimensions', return_value=(2304, 1296)):
            url = '/api/camera-feeds/roi?videoId=sample-CCTV/Bays%201-2.mp4'
            choices = self.client.get(url, headers=self.headers)
            self.assertEqual(choices.status_code, 200)
            self.assertEqual([item['id'] for item in choices.json['mappings']], ['new-view.json'])
            self.assertNotIn(str(self.root), choices.text)
            draft = {**self.sample, 'roiId': 'new-view.json', 'bays': [2]}
            saved = self.client.post('/api/camera-feeds', headers=self.headers, json=draft)
            self.assertEqual(saved.status_code, 201, saved.text)
            feed = saved.json['feed']
            self.assertEqual(feed['roiStatus'], 'valid')
            self.assertFalse(feed['legacyAiCompatible'])
            self.assertEqual(feed['roiMapping']['roi']['width'], 2304)
            for change in ({'bays': [1]}, {'roiId': '../new-view.json'}, {'roiId': 'missing.json'},
                           {'direction': 'southbound', 'bays': [6]}):
                bad = self.client.patch('/api/camera-feeds/' + feed['id'], headers=self.headers, json={**draft, **change})
                self.assertEqual(bad.status_code, 400, bad.text)
            self.assertEqual(self.client.get('/api/camera-feeds', headers=self.headers).json['feeds'][0], feed)
            data['source_width'] = 1920
            path.write_text(json.dumps(data), encoding='utf-8')
            self.assertEqual(self.client.get(url, headers=self.headers).json['mappings'], [])
            self.assertEqual(self.client.get('/api/camera-feeds', headers=self.headers).json['feeds'][0]['roiStatus'], 'invalid')
            path.unlink()  # Temporary fixture only; a removed JSON does not delete its feed/video.
            self.assertEqual(self.client.get('/api/camera-feeds', headers=self.headers).json['feeds'][0]['roiStatus'], 'invalid')
            cleared = self.client.patch('/api/camera-feeds/' + feed['id'], headers=self.headers, json={**draft, 'roiId': ''})
            self.assertEqual(cleared.status_code, 200)
            self.assertEqual(cleared.json['feed']['roiStatus'], 'none')
        self.assertEqual(self.database.read_bytes(), admin_before)
        self.assertEqual(self.video.read_bytes(), video_before)

    def test_roi_catalog_rejects_other_video_and_unsafe_video_id(self):
        folder = self.root / 'config/roi'
        folder.mkdir(parents=True)
        data = dict(schema_version=1, source_video='public/sample-CCTV/another.mp4',
                    source_width=100, source_height=100, frame_index=0,
                    normalization='x/width, y/height', bays=[dict(id='Bay_1', direction='northbound',
                    points=[[0, 0], [1, 0], [1, 1], [0, 1]])])
        (folder / 'wrong.json').write_text(json.dumps(data), encoding='utf-8')
        with patch('backend.cameras.roi_catalog._dimensions', return_value=(100, 100)):
            response = self.client.get('/api/camera-feeds/roi?videoId=' + self.sample['videoId'], headers=self.headers)
            self.assertEqual(response.json['mappings'], [])
            self.assertEqual(response.json['excluded'], 1)
            response = self.client.post('/api/camera-feeds', headers=self.headers, json={**self.sample, 'roiId': 'wrong.json'})
            self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.get('/api/camera-feeds/roi?videoId=../private.mp4', headers=self.headers).status_code, 400)

    def test_legacy_display_rejects_worker_configuration_and_invalid_metadata(self):
        settings = dict(name='Card', direction='northbound', bays=[1], hidden=False)
        for data in ([], {**settings, 'hidden': 'false'}, {**settings, 'bays': [6]},
                     {**settings, 'videoId': self.sample['videoId']}, {**settings, 'worker': 'stop'},
                     {**settings, 'address': 'rtsp://example.test'}, {**settings, 'name': ''}):
            result = self.client.patch('/api/camera-feeds/display/1', headers=self.headers, json=data)
            self.assertEqual(result.status_code, 400, result.text)
        self.assertFalse(self.feeds_db.exists())
        self.assertEqual(self.client.patch('/api/camera-feeds/display/3', headers=self.headers, json=settings).status_code, 404)
        self.assertEqual(self.client.patch('/api/camera-feeds/display/1', headers=self.headers, json={**settings, 'name': 'a' * 3000}).status_code, 413)

    def test_all_ten_bays_and_saved_direction_labels_remain_compatible(self):
        for direction, bays in [('northbound', [1, 2, 3, 4, 5]), ('southbound', [6, 7, 8, 9, 10])]:
            draft = {**self.sample, 'direction': direction, 'bays': bays}
            result = self.client.post('/api/camera-feeds', headers=self.headers, json=draft)
            self.assertEqual(result.status_code, 201)
            feed = result.json['feed']
            self.assertEqual(feed['bays'], bays)
            updated = self.client.patch('/api/camera-feeds/' + feed['id'], headers=self.headers,
                                        json={**draft, 'name': 'Renamed only'})
            self.assertEqual(updated.json['feed']['bays'], bays)
            self.assertEqual(updated.json['feed']['direction'], direction)
        saved = self.client.get('/api/camera-feeds', headers=self.headers).json['feeds']
        self.assertEqual([f['bays'] for f in saved], [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]])


if __name__ == '__main__':
    unittest.main()
