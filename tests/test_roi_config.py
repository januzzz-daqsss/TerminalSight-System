"""Reusable geometry only: no model initialization or operational database access."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
from shapely.geometry import Polygon

from backend.detection import detector
from backend.detection.roi_config import load_roi


def document():
    return dict(schema_version=1, source_video='public/sample-CCTV/example.mp4',
                source_width=100, source_height=100, frame_index=0,
                normalization='x/width, y/height', bays=[dict(id='Bay_1', direction='northbound',
                points=[[0, 0], [1, 0], [1, 1], [0, 1]])])


class RoiConfigTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.video = self.root / 'public/sample-CCTV/example.mp4'
        self.roi = self.root / 'config/roi/test.json'
        self.video.parent.mkdir(parents=True)
        self.roi.parent.mkdir(parents=True)
        self.video.write_bytes(b'fixture')
        self.data = document()
        self.write()

    def write(self):
        self.roi.write_text(json.dumps(self.data), encoding='utf-8')

    def load(self):
        return load_roi(self.roi, self.video, 100, 100, root=self.root)

    def test_cache_normalization_readonly_and_replacement_failure(self):
        prepared = self.load()
        self.assertIs(prepared, self.load())
        self.assertEqual(prepared.polygons['Bay_1'].area, 10000)
        np.testing.assert_array_equal(prepared.arrays['Bay_1'], [[0, 0], [100, 0], [100, 100], [0, 100]])
        with self.assertRaises(ValueError):
            prepared.arrays['Bay_1'][0] = [1, 2]
        self.data['source_width'] = 200
        self.write()
        with self.assertRaises(ValueError):
            self.load()
        self.assertEqual(prepared.width, 100)
        self.assertEqual(prepared.polygons['Bay_1'].area, 10000)

    def test_invalid_candidates(self):
        for key, value in [('source_video', 'public/other.mp4'), ('normalization', 'pixels'),
                           ('schema_version', True), ('bays', []), ('source_height', 99)]:
            self.data = {**document(), key: value}; self.write()
            with self.subTest(key=key), self.assertRaises(ValueError): self.load()
        for points in ([[0, 0]] * 4, [[0, 0], [1, 1], [0, 1], [1, 0]],
                       [[-1, 0], [1, 0], [1, 1], [0, 1]]):
            self.data = document(); self.data['bays'][0]['points'] = points; self.write()
            with self.assertRaises(ValueError): self.load()
        self.data = document(); self.data['bays'][0]['direction'] = 'southbound'; self.write()
        with self.assertRaises(ValueError): self.load()

    def test_legacy_defaults_and_optional_geometry_are_isolated(self):
        self.assertEqual(detector.SLOTS_NORTHBOUND['Bay_1'], [(1615, 794), (786, 844), (656, 598), (1074, 586)])
        self.assertEqual(detector.SLOTS_SOUTHBOUND['Bay_6'], [(1457, 825), (821, 882), (565, 678), (898, 651)])
        frame = np.zeros((1080, 1920, 3), np.uint8)
        results = [dict(bbox=[0, 0, 1920, 1080], vehicle_type='Bus')]
        with patch.object(detector.runtime, 'predict', return_value=results) as predict:
            self.assertEqual(detector.analyze_frame(frame.copy(), annotate=False), {'Bay_6': 'OCCUPIED'})
            self.assertEqual(detector.analyze_frame(frame.copy(), 'northbound', annotate=False), {'Bay_1': 'OCCUPIED'})
            prepared = self.load()
            with self.assertRaises(ValueError): detector.analyze_frame(frame, roi=prepared)
            self.assertEqual(predict.call_count, 2)  # Reject size before inference.
            statuses, assignments = detector.analyze_frame(np.zeros((100, 100, 3), np.uint8), roi=prepared, include_detections=True)
            self.assertEqual(statuses, {'Bay_1': 'OCCUPIED'})
            self.assertEqual(assignments['Bay_1']['vehicle_type'], 'Bus')
        self.assertFalse(frame.any())

    def test_threshold_order_ties_and_one_to_one(self):
        polygon = Polygon([(0, 0), (100, 0), (100, 100), (0, 100)])
        boxes = [dict(bbox=[0, 0, 20, 100], vehicle_type='Bus')]
        states, assigned = detector.assign_detections(boxes, {'Bay_2': polygon, 'Bay_1': polygon})
        self.assertEqual(states, {'Bay_2': 'OCCUPIED', 'Bay_1': 'AVAILABLE'})
        self.assertEqual(list(assigned), ['Bay_2'])
        boxes[0]['bbox'][2] = 19
        self.assertEqual(detector.assign_detections(boxes, {'Bay_1': polygon})[0], {'Bay_1': 'AVAILABLE'})
        boxes = [dict(bbox=[0, 0, 50, 100], vehicle_type=name) for name in ('Bus', 'UV Express')]
        self.assertEqual(detector.assign_detections(boxes, {'Bay_1': polygon})[1]['Bay_1']['vehicle_type'], 'Bus')

    def test_json_bay_order_and_overlap_warning(self):
        second = copy.deepcopy(self.data['bays'][0]); second['id'] = 'Bay_2'
        self.data['bays'].insert(0, second); self.write()
        roi = self.load()
        self.assertEqual(list(roi.polygons), ['Bay_2', 'Bay_1'])
        self.assertEqual(roi.warnings, ('Bay_2 overlaps Bay_1',))


if __name__ == '__main__': unittest.main()
