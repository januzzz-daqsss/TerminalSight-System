import threading
import unittest
import numpy as np
from camera_inference import CameraInference


class CameraInferenceTests(unittest.TestCase):
    def test_busy_worker_drops_submissions_and_discards_old_loop_result(self):
        entered, release = threading.Event(), threading.Event()
        def slow(frame, camera, **kwargs):
            entered.set()
            release.wait(2)
            return {'Bay_1': 'OCCUPIED'}, {}
        worker = CameraInference(slow)
        try:
            frame = np.zeros((2, 2, 3), dtype=np.uint8)
            self.assertTrue(worker.submit(frame, 'northbound'))
            self.assertTrue(entered.wait(1))
            self.assertIsNone(worker.poll())
            self.assertFalse(worker.submit(frame, 'northbound'))
            worker.reset()
            release.set()
            worker.future.result(timeout=2)
            self.assertIsNone(worker.poll())
            self.assertTrue(worker.submit(frame, 'northbound'))
            worker.future.result(timeout=2)
            result = worker.poll()
            self.assertEqual(result[1][0]['Bay_1'], 'OCCUPIED')
        finally:
            release.set()
            worker.close()
