"""API tests use a temporary database; no cameras or production data required."""
from contextlib import closing
import csv
import importlib.util
import io
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]

class OccupancyExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        previous = os.getcwd()
        try:
            os.chdir(self.temp.name)
            spec = importlib.util.spec_from_file_location('terminal_api', ROOT / 'app.py')
            self.api = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.api)
            self.api.DB_FILE = str(Path(self.temp.name) / 'terminalsight.db')
        finally:
            os.chdir(previous)
        self.client = self.api.app.test_client()
        login = self.client.post('/api/login', json={'username': 'admin', 'password': 'password123'})
        self.headers = {'Authorization': 'Bearer ' + login.json['export_token']}

    def tearDown(self):
        self.temp.cleanup()

    def export(self, path='/api/export/occupancy-csv'):
        return self.client.get(path, headers=self.headers)

    def test_authentication_and_alias(self):
        for path in ['/api/export/occupancy-csv', '/api/export/csv']:
            self.assertEqual(self.client.get(path).status_code, 401)
            self.assertEqual(self.client.get(path, headers={'Authorization': 'Bearer fake'}).status_code, 401)
            self.assertEqual(self.export(path).status_code, 200)
        with patch('itsdangerous.timed.time.time', return_value=4102444800):
            self.assertEqual(self.export().status_code, 401)

    def test_detection_settings_require_current_admin_credentials(self):
        self.assertEqual(self.client.get('/api/detection').status_code, 401)
        self.assertEqual(self.client.post('/api/detection', json={'model': 'yolov8', 'device': 'cpu'}).status_code, 401)
        with patch('detection_runtime.runtime.status', return_value={'model': 'yolov8'}):
            self.assertEqual(self.client.get('/api/detection', headers=self.headers).json['model'], 'yolov8')
        with patch.dict(os.environ, {'TERMINALSIGHT_DISABLE_AI': '0'}):
            self.assertEqual(self.client.post('/api/detection', headers=self.headers, json=[]).status_code, 400)
            with patch('detection_runtime.runtime.switch', return_value={'model': 'ssd300_vgg16'}) as switch:
                result = self.client.post('/api/detection', headers=self.headers, json={'model': 'ssd300_vgg16', 'device': 'cpu'})
                self.assertEqual(result.status_code, 200)
                switch.assert_called_once_with('ssd300_vgg16', 'cpu')
        with closing(sqlite3.connect(self.api.DB_FILE)) as conn:
            conn.execute("UPDATE admin_users SET password_hash = 'changed'")
            conn.commit()
        self.assertEqual(self.client.get('/api/detection', headers=self.headers).status_code, 401)

    def test_header_only_export(self):
        response = self.export()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['Content-Disposition'], 'attachment; filename=occupancy_logs.csv')
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertIn('text/csv', response.content_type)
        self.assertEqual(response.data.count(b'\r\n'), 1)
        self.assertEqual(next(csv.reader(io.StringIO(response.text))), [
            'log_id', 'slot_id', 'vehicle_type_class', 'arrival_timestamp',
            'departure_timestamp', 'calculated_duration_minutes', 'slot_number'])

    def test_join_nulls_order_unicode_and_csv_escaping(self):
        with closing(sqlite3.connect(self.api.DB_FILE)) as conn, conn:
            conn.executemany('INSERT INTO Occupancy_Log VALUES (?, ?, ?, ?, ?, ?)', [
                (1, 'Bay_1', 'Bus', '2026-09-25 10:00:00', '2026-09-25 10:12:30', 12.5),
                (2, 'Bay_2', 'UV, "Express"\r\nPeña', '2026-09-26 10:00:00', None, None),
                (3, 'legacy', '=1+1', '2026-09-26 10:00:00', None, None),
            ])
        rows = list(csv.reader(io.StringIO(self.export().text, newline='')))
        self.assertEqual([row[0] for row in rows[1:]], ['3', '2', '1'])
        self.assertEqual(rows[1][2], "'=1+1")
        self.assertEqual(rows[1][-1], '')
        self.assertEqual(rows[2][2], 'UV, "Express"\r\nPeña')
        self.assertEqual(rows[2][4:], ['', '', '2'])
        self.assertEqual(rows[3][5:], ['12.5', '1'])

    def test_password_change_invalidates_token(self):
        with closing(sqlite3.connect(self.api.DB_FILE)) as conn, conn:
            conn.execute("UPDATE admin_users SET password_hash = 'changed'")
        self.assertEqual(self.export().status_code, 401)

    def test_database_failure_is_json(self):
        with patch.object(self.api.sqlite3, 'connect', side_effect=sqlite3.OperationalError('test unavailable')):
            response = self.export()
        self.assertEqual(response.status_code, 503)
        self.assertIn('Unable to export', response.json['message'])

    def test_public_bays_share_server_timer_and_hide_debug(self):
        session = self.api.occupancy.update('Bay_1', {'vehicle_type': 'UV Express'})
        response = self.client.get('/api/bays')
        self.assertEqual(response.status_code, 200)
        bay = response.json['bays'][0]
        self.assertEqual(bay['sessionId'], session['id'])
        self.assertEqual(bay['ocrState'], 'Detecting')
        self.assertNotIn('ocrDebug', bay)
        self.assertEqual(self.client.get('/api/timers').json['Bay_1'], bay['elapsedSeconds'])
        self.assertEqual(self.client.get('/api/status').json['Bay_1'], 'OCCUPIED')

    def test_ocr_debug_is_opt_in_and_authenticated(self):
        self.assertEqual(self.client.get('/api/ocr/debug').status_code, 404)
        with patch.dict(os.environ, {'TERMINALSIGHT_OCR_DEBUG': '1'}):
            self.assertEqual(self.client.get('/api/ocr/debug').status_code, 401)
            self.assertEqual(self.client.get('/api/ocr/debug', headers=self.headers).status_code, 200)

if __name__ == '__main__':
    unittest.main(verbosity=2)
