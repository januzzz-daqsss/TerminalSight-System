import unittest
import numpy as np
from backend.detection.detection_directml import DirectMLAdapter


class DirectMLPostprocessingTests(unittest.TestCase):
    def test_letterbox_classwise_nms_and_original_coordinates(self):
        adapter = DirectMLAdapter.__new__(DirectMLAdapter)
        adapter.input_name, adapter.names = 'images', {0: 'bus', 1: 'uv'}
        class Session:
            def run(self, outputs, inputs):
                image = inputs['images']
                assert image.shape == (1, 3, 512, 512)
                assert image[0, 0, 256, 256] == 1.0
                raw = np.zeros((1, 6, 5376), dtype=np.float32)
                # Same-class duplicate suppressed; other class remains.
                raw[0, :, 0] = [256, 256, 256, 128, .9, .1]
                raw[0, :, 1] = [256, 256, 256, 128, .8, .1]
                raw[0, :, 2] = [256, 256, 256, 128, .1, .95]
                return [raw]
        adapter.session = Session()
        frame = np.zeros((100, 200, 3), dtype=np.uint8)
        frame[:, :, 2] = 255
        detections = adapter.predict(frame)
        self.assertEqual(len(detections), 2)
        self.assertEqual([d['vehicle_type'] for d in detections], ['Bus', 'UV Express'])
        for detection in detections:
            self.assertEqual(detection['bbox'], [50, 25, 150, 75])
            self.assertEqual(set(detection), {'bbox', 'vehicle_type'})
        details = adapter.predict_details(frame)
        self.assertEqual([item['class_name'] for item in details], ['bus', 'uv'])
        self.assertEqual([item['class_id'] for item in details], [0, 1])
        self.assertAlmostEqual(details[0]['confidence'], .9, places=5)
        self.assertAlmostEqual(details[1]['confidence'], .95, places=5)
