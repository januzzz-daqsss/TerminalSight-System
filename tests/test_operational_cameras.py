"""Temporary feed/history databases only. Camera/model doubles are explicit fixtures."""
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
from backend.cameras.operational import CameraManager, create_operational_blueprint
from backend.cameras.camera_inference import CameraInference, FairInferenceExecutor
from backend.cameras.sample_ai import MAPPINGS
from backend.ocr.ocr_worker import OCRWorker
from backend.state.occupancy import OccupancyState
from backend.state.occupancy_history import OccupancyHistory


def wait_for(test, timeout=4):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if test():
            return
        time.sleep(.01)
    raise AssertionError('Timed out waiting for camera fixture')


class Capture:
    count = 100
    def __init__(self, path):
        self.position, self.closed = 0, False
    def isOpened(self): return True
    def get(self, key):
        return {cv2.CAP_PROP_FPS: 20, cv2.CAP_PROP_FRAME_COUNT: self.count}.get(key, self.position)
    def grab(self):
        self.position += 1
        return self.position <= self.count
    def read(self):
        return self.grab(), np.zeros((100, 120, 3), np.uint8)
    def set(self, key, value):
        self.position = int(value)
        return True
    def release(self): self.closed = True


class OperationalTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        (self.root / 'public/sample-CCTV').mkdir(parents=True)
        (self.root / 'config/roi').mkdir(parents=True)
        self.database = self.root / 'feeds.sqlite3'
        with closing(sqlite3.connect(self.database)) as conn, conn:
            conn.execute('CREATE TABLE feeds (id TEXT PRIMARY KEY, configuration TEXT)')
            for index, (video, (roi, bays, direction)) in enumerate(MAPPINGS.items()):
                (self.root / 'public' / video).write_bytes(b'fixture')
                document = dict(schema_version=1, source_video='public/' + video, source_width=120, source_height=100,
                    frame_index=0, normalization='x/width, y/height', bays=[dict(id=bay, direction=direction,
                    points=[[i/len(bays), 0], [(i+1)/len(bays), 0], [(i+1)/len(bays), 1], [i/len(bays), 1]]) for i, bay in enumerate(bays)])
                (self.root / roi).write_text(json.dumps(document))
                feed = dict(kind='sample', name=f'Camera {index}', videoId=video, roiId=Path(roi).name,
                    direction=direction, bays=[int(b[4:]) for b in bays])
                conn.execute('INSERT INTO feeds VALUES (?,?)', (str(index), json.dumps(feed)))
        self.state = OccupancyState()
        self.ocr = Mock()
        self.calls = []
        def runner(video, camera, stop, **kwargs):
            self.calls.append(kwargs)
            stop.wait(5)
        self.manager = CameraManager(self.root, self.database, self.state, runner, self.ocr)
        self.addCleanup(self.manager.close)
        dims = patch('backend.cameras.roi_catalog._dimensions', return_value=(120, 100))
        dims.start(); self.addCleanup(dims.stop)

    def rewrite(self, identifier, **values):
        with closing(sqlite3.connect(self.database)) as conn, conn:
            feed = json.loads(conn.execute('SELECT configuration FROM feeds WHERE id=?', (identifier,)).fetchone()[0])
            conn.execute('UPDATE feeds SET configuration=? WHERE id=?', (json.dumps({**feed, **values}), identifier))

    def test_all_bays_exclusive_ownership_legacy_fallback_and_stop_restart(self):
        self.manager.reconcile()
        self.assertEqual(set(self.manager.records), {'0', '1', '2'})
        bays = [b for r in self.manager.records.values() for b in r.spec['bays']]
        self.assertEqual(len(bays), 10); self.assertEqual(len(set(bays)), 10)
        old = self.manager.records['0']
        self.manager.control('0', 'stop')
        self.assertFalse(old.thread.is_alive())
        self.assertNotIn('northbound', self.manager.records)
        self.assertEqual(self.manager.errors['0']['state'], 'Stopped')
        self.manager.control('0', 'restart')
        self.assertIsNot(old, self.manager.records['0'])
        with closing(sqlite3.connect(self.database)) as conn, conn:
            conn.execute("DELETE FROM feeds WHERE id='0'")
        self.manager.reconcile()
        self.assertIn('northbound', self.manager.records)
        self.assertFalse(self.manager.bay_snapshot()[1]['monitored'])

    def test_conflicts_invalid_roi_and_updates_cannot_create_second_owner(self):
        self.manager.reconcile()
        with closing(sqlite3.connect(self.database)) as conn, conn:
            conn.execute("INSERT INTO feeds SELECT 'duplicate', configuration FROM feeds WHERE id='0'")
        self.manager.reconcile()
        self.assertEqual(self.manager.errors['duplicate']['state'], 'Conflict')
        self.assertNotIn('duplicate', self.manager.records)
        old = self.manager.records['2']
        self.rewrite('2', roiId='bays-1-2.json')
        self.manager.reconcile()
        self.assertFalse(old.thread.is_alive())
        self.assertEqual(self.manager.errors['2']['state'], 'Invalid')
        self.assertNotIn('southbound', self.manager.records)
        self.rewrite('2', roiId='bays-6-10.json')
        self.manager.reconcile()
        self.assertIn('2', self.manager.records)

    def test_unobserved_stale_and_stopped_cameras_are_not_available(self):
        self.manager.reconcile()
        self.assertTrue(all(b['status'] == 'Unmonitored' for b in self.manager.bay_snapshot()))
        record = self.manager.records['1']
        with record.condition:
            record.state = 'Live'
            record.last_frame = record.last_result = time.monotonic()
        self.assertEqual([b['id'] for b in self.manager.bay_snapshot() if b['monitored']], [3, 4, 5])
        with record.condition:
            record.last_result -= 20
        self.assertTrue(all(not b['monitored'] for b in self.manager.bay_snapshot()))

    def test_rewind_cannot_split_health_and_occupancy_snapshot(self):
        self.manager.reconcile()
        record = self.manager.records['1']
        record.state = 'Live'
        record.last_frame = record.last_result = time.monotonic()
        self.state.update('Bay_3', dict(vehicle_type='Bus', bbox=[0,0,50,50]))
        entered, completed = threading.Event(), threading.Event()
        def rewind():
            entered.set()
            record.rewind(self.state, self.ocr)
            completed.set()
        thread = threading.Thread(target=rewind)
        original = self.state.snapshot
        def during_snapshot():
            thread.start()
            self.assertTrue(entered.wait(1))
            self.assertFalse(completed.wait(.05), 'Rewind must wait until this snapshot is complete')
            return original()
        with patch.object(self.state, 'snapshot', side_effect=during_snapshot):
            rows = self.manager.bay_snapshot()
        thread.join(timeout=1)
        self.assertTrue(completed.is_set())
        self.assertTrue(rows[2]['monitored'])
        self.assertEqual(rows[2]['status'], 'Occupied')
        self.assertEqual(self.manager.bay_snapshot()[2]['status'], 'Unmonitored')

    def test_authenticated_controls_and_streams_never_mutate_saved_configuration(self):
        self.manager.reconcile()
        app = Flask('operational-tests')
        app.register_blueprint(create_operational_blueprint(
            lambda: None if request.headers.get('Authorization') == 'Bearer fixture' else ({'message':'Denied'}, 401), lambda: self.manager))
        client = app.test_client(); headers = {'Authorization':'Bearer fixture'}
        before = self.database.read_bytes()
        for method, path in [('get','/api/operational-cameras'), ('get','/api/operational-cameras/0/stream'), ('post','/api/operational-cameras/0')]:
            self.assertEqual(getattr(client, method)(path).status_code, 401)
        self.assertEqual(client.get('/api/operational-cameras', headers=headers).status_code, 200)
        self.assertEqual(client.post('/api/operational-cameras/0', headers=headers, json={'action':'seek'}).status_code, 400)
        self.assertEqual(client.post('/api/operational-cameras/0', headers=headers, json={'action':'stop'}).status_code, 200)
        self.assertEqual(client.get('/api/operational-cameras/0/stream', headers=headers).status_code, 404)
        self.assertEqual(self.database.read_bytes(), before)

    def test_shared_fifo_one_model_call_and_roi_forwarding(self):
        entered, release = threading.Event(), threading.Event()
        observed = []
        def analyze(frame, camera, **kwargs):
            observed.append((camera, kwargs['roi']))
            entered.set(); release.wait(2)
            return {}, {}
        workers = [CameraInference(analyze, executor=self.manager.executor) for _ in range(3)]
        try:
            for i,w in enumerate(workers):
                self.assertTrue(w.submit(np.zeros((2,2,3)), str(i), roi=i))
                self.assertFalse(w.submit(np.zeros((2,2,3)), str(i), roi=i))
            self.assertTrue(entered.wait(1)); self.assertEqual(len(observed),1)
            release.set()
            for w in workers: w.future.result(timeout=2)
            self.assertEqual(observed, [('0',0),('1',1),('2',2)])
        finally:
            release.set()
            for w in workers: w.close()

    def test_actual_worker_path_all_ten_bays_ocr_and_loop_session_rejection(self):
        from backend import server
        captures = []
        def capture(path):
            c=Capture(path); captures.append(c); return c
        predictions = [dict(bbox=[i*24, 0, (i+1)*24, 100], vehicle_type='Bus') for i in range(5)]
        self.manager.runner = server.run_ai_background
        with patch.object(server, 'occupancy', self.state), patch.object(server, 'ocr_worker', self.ocr), \
             patch('cv2.VideoCapture', side_effect=capture), patch('backend.detection.detector.runtime.predict', return_value=predictions), \
             patch.object(server, 'draw_sign_region'):
            try:
                self.manager.reconcile()
                wait_for(lambda: all(b['monitored'] and b['status']=='Occupied' for b in self.manager.bay_snapshot()))
                self.assertEqual({c.args[0] for c in self.ocr.submit.call_args_list}, {f'Bay_{n}' for n in range(1,11)})
                before = self.state.snapshot()[0]['sessionId']
                record = self.manager.records['0']
                with record.condition:
                    record.rewind(self.state, self.ocr)
                    self.assertIsNone(record.jpeg, 'A rewind must discard the previous cycle preview')
                self.assertFalse(self.state.apply_ocr('Bay_1', before, 'DAVAO', .99))
                wait_for(lambda: all(c.jpeg for c in self.manager.records.values()))
            finally:
                self.manager.close()
        self.assertTrue(all(c.closed for c in captures))

    def test_recording_rewinds_rotate_sessions_without_synthetic_visit_events(self):
        from backend import server
        history = Mock(); self.state.history = history
        predictions = [dict(bbox=[i*24, 0, (i+1)*24, 100], vehicle_type='Bus') for i in range(5)]
        self.manager.runner = server.run_ai_background
        with patch.object(server, 'occupancy', self.state), patch.object(server, 'ocr_worker', self.ocr), \
             patch('cv2.VideoCapture', side_effect=Capture), patch.object(Capture, 'count', 20), \
             patch('backend.detection.detector.runtime.predict', return_value=predictions), patch.object(server, 'draw_sign_region'):
            try:
                self.manager.reconcile()
                wait_for(lambda: all(b['monitored'] for b in self.manager.bay_snapshot()))
                first = self.state.snapshot()[0]['sessionId']
                wait_for(lambda: all(r.generation >= 2 and r.last_result for r in self.manager.records.values()), timeout=5)
                self.assertNotEqual(first, self.state.snapshot()[0]['sessionId'])
                self.assertFalse(self.state.apply_ocr('Bay_1', first, 'DAVAO', .99))
                events = [call.args[0] for call in history.call_args_list]
                self.assertEqual(events.count('arrival'), 10)
                self.assertEqual(events.count('departure'), 0)
            finally:
                self.manager.close()


class HistoryAndOCRTests(unittest.TestCase):
    def test_scheduler_is_bounded_and_canceled_work_never_runs(self):
        executor = FairInferenceExecutor(capacity=2)
        entered, release = threading.Event(), threading.Event()
        calls = []
        def blocked():
            entered.set(); release.wait(3)
        try:
            active = executor.submit(blocked)
            self.assertTrue(entered.wait(1))
            one = executor.submit(calls.append, 'one')
            two = executor.submit(calls.append, 'two')
            with self.assertRaises(RuntimeError): executor.submit(calls.append, 'overflow')
            self.assertTrue(one.cancel())
            three = executor.submit(calls.append, 'three')
            self.assertEqual(len(executor.pending), 2)
            release.set()
            active.result(2); two.result(2); three.result(2)
            self.assertEqual(calls, ['two', 'three'])
        finally:
            release.set(); executor.shutdown(wait=True)

    def test_history_confirmed_departures_replacement_and_loop_baselines(self):
        with tempfile.TemporaryDirectory() as directory:
            db=Path(directory)/'history.sqlite3'
            with closing(sqlite3.connect(db)) as conn, conn:
                conn.execute('CREATE TABLE Occupancy_Log (log_id INTEGER PRIMARY KEY, slot_id TEXT, vehicle_type_class TEXT, arrival_timestamp TEXT, departure_timestamp TEXT, calculated_duration_minutes REAL)')
            state=OccupancyState(history=OccupancyHistory(db))
            detection=dict(vehicle_type='Bus', bbox=[0,0,100,100])
            state.update('Bay_3', detection, now=0)
            state.update('Bay_3', detection, now=10)
            state.update('Bay_3', None, now=16)
            first=state.update('Bay_3', detection, now=20)
            state.rebase(['Bay_3'], {'Bay_3':detection}, now=30)
            self.assertFalse(state.apply_ocr('Bay_3',first['id'],'DAVAO',.99,now=31))
            state.update('Bay_3', None, now=40)  # baseline visit has no fabricated arrival row
            with closing(sqlite3.connect(db)) as conn:
                rows=conn.execute('SELECT departure_timestamp, calculated_duration_minutes FROM Occupancy_Log ORDER BY log_id').fetchall()
            self.assertEqual(len(rows),2)
            self.assertIsNotNone(rows[0][0]); self.assertAlmostEqual(rows[0][1],10/60)
            self.assertEqual(rows[1],(None,None))

    def test_ten_bay_ocr_fifo_preserves_positions_and_rejects_invalid_keys(self):
        state=OccupancyState(); state.config['sample_interval_seconds']=0
        worker=OCRWorker(state)
        with patch('backend.ocr.ocr_worker.crop_sign', return_value=object()):
            for n in range(1,11): worker.submit(f'Bay_{n}','one',None,{})
            worker.submit('Bay_1','two',None,{})
            worker.submit('Bay_11','invalid',None,{})
            self.assertEqual(list(worker.pending),[f'Bay_{n}' for n in range(1,11)])
            self.assertEqual(worker.pending['Bay_1'][0],'two')
            worker.discard(['Bay_1','Bay_10'])
            self.assertEqual(len(worker.pending),8)
