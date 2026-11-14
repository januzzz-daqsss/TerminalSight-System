import threading
import unittest
from pathlib import Path
from unittest.mock import patch
import cv2
import numpy as np
from backend.ocr.led import LEDReader, led_crop, join_fragments
from backend.ocr.route_recognition import TemporalRoute, load_config
from backend.ocr.ocr_worker import OCRWorker
from backend.state.occupancy import OccupancyState
from unittest.mock import Mock


class LEDTests(unittest.TestCase):
    def image(self):
        image = np.zeros((100,300,3),np.uint8)
        cv2.putText(image,'DAVAO',(20,60),cv2.FONT_HERSHEY_SIMPLEX,1,(0,0,255),2)
        return image

    def test_crop_is_bounded_and_rejects_blank_or_solid_red(self):
        candidate = led_crop(self.image())
        self.assertIsNotNone(candidate)
        image,bounds = candidate
        self.assertLessEqual(image.shape[1],640)
        self.assertLessEqual(image.shape[0],128)
        self.assertLess(bounds[2]-bounds[0],300)
        self.assertIsNone(led_crop(np.zeros((100,300,3),np.uint8)))
        self.assertIsNone(led_crop(np.full((100,300,3),(0,0,255),np.uint8)))

    def test_overlapping_fragments_work_in_both_orders_without_vocabulary(self):
        self.assertEqual(join_fragments('DAVA','AVAO'),'DAVAO')
        self.assertEqual(join_fragments('AVAO','DAVA'),'DAVAO')
        self.assertIsNone(join_fragments('DAV','XYZ'))
        self.assertIsNone(join_fragments('ABCA','CAB'))

    def test_route_uses_raw_independent_evidence_not_joined_replays(self):
        for fragments in (['DAVA','AVAO','DAVA','AVAO'], ['AVAO','DAVA','AVAO','DAVA']):
            route = TemporalRoute(load_config(),0)
            for index,text in enumerate(fragments):
                route.observe(text,.99,index*3)
                if index < 2: self.assertIsNone(route.public(index*3)['route'])
            self.assertEqual(route.public(10)['route'],'Panabo - Davao')
        route = TemporalRoute(load_config(),0)
        for i in range(8): route.observe('XYZ',.99,i*3)
        self.assertEqual(route.public(25)['ocr_state'],'Unknown')

    def test_memory_rate_and_session_boundaries(self):
        reader=LEDReader(); calls=[]
        def read(image): calls.append(1); return 'DAVA',.99
        for t in range(31): reader.read('Bay_3','one',self.image(),read,now=t)
        self.assertEqual(len(calls),11)
        self.assertEqual(len(reader.sessions['Bay_3']['images']),4)
        self.assertEqual(len(reader.diagnostics()['Bay_3']['reads']),8)
        reader.read('Bay_3','two',self.image(),read,now=31)
        self.assertEqual(len(reader.diagnostics()['Bay_3']['reads']),1)
        reader.discard(['Bay_3']); self.assertEqual(reader.diagnostics(),{})
        reader.read('Bay_11','bad',self.image(),read,now=32)
        self.assertEqual(reader.diagnostics(),{})

    def test_discard_does_not_wait_for_ocr_or_keep_its_late_result(self):
        reader=LEDReader(); entered=threading.Event(); release=threading.Event(); result=[]
        def read(image): entered.set(); release.wait(2); return 'DAVAO',.99
        thread=threading.Thread(target=lambda: result.append(reader.read('Bay_3','old',self.image(),read,now=1)))
        thread.start()
        try:
            self.assertTrue(entered.wait(1))
            reader.discard(['Bay_3'])
            self.assertEqual(reader.diagnostics(),{})
        finally: release.set(); thread.join(2)
        self.assertEqual(result,[('',0)])

    def test_representative_cctv_frames_candidate_geometry(self):
        video=Path(__file__).resolve().parents[1]/'public/sample-CCTV/Bays 2-5.mp4'
        if not video.exists(): self.skipTest('Local CCTV recording not installed')
        cap=cv2.VideoCapture(str(video))
        try:
            for seconds in (0,5,10):
                cap.set(cv2.CAP_PROP_POS_MSEC,seconds*1000)
                ok,frame=cap.read(); self.assertTrue(ok)
                # Visually inspected rear/right bus; geometry test, not OCR ground truth.
                crop=frame[390:670,1600:1880]
                candidate=led_crop(crop)
                if candidate is not None:
                    image,(x1,y1,x2,y2)=candidate
                    self.assertTrue(0 <= x1 < x2 <= crop.shape[1])
                    self.assertTrue(0 <= y1 < y2 <= crop.shape[0])
                    self.assertLessEqual(image.shape[1],640)
        finally: cap.release()

    def test_worker_static_fallback_and_single_observation_per_frame(self):
        for failed in (False, True):
            state = OccupancyState()
            session = state.update('Bay_3',dict(vehicle_type='Bus',bbox=[0,0,200,100]))
            worker = OCRWorker(state)
            worker.led_enabled = True
            worker.pending['Bay_3'] = (session['id'], self.image())
            worker.vehicle_types['Bay_3'] = (session['id'],'Bus')
            def applied(*args, **kwargs): worker.stopping = True
            with patch('backend.ocr.ocr_worker.create_engine',return_value=object()), \
                 patch('backend.ocr.ocr_worker.read_sign',return_value=('DAVAO',.99,[])), \
                 patch.object(worker.led,'read',side_effect=RuntimeError('fixture') if failed else None,
                              return_value=('AVAO',.98)), \
                 patch.object(state,'apply_ocr',side_effect=applied) as apply:
                worker._run()
                self.assertEqual(apply.call_count,1)
                self.assertEqual(apply.call_args.args[2], 'DAVAO' if failed else 'DAVAO AVAO')

    def test_led_is_opt_in(self):
        with patch.dict('os.environ', {'TERMINALSIGHT_LED_OCR': '0'}):
            self.assertFalse(OCRWorker(OccupancyState()).led_enabled)
        with patch.dict('os.environ', {'TERMINALSIGHT_LED_OCR': '1'}):
            self.assertTrue(OCRWorker(OccupancyState()).led_enabled)
