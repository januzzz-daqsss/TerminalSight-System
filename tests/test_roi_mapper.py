"""Standalone mapper checks; synthetic frames and temporary JSON only."""
import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import cv2
import numpy as np

from tools.roi_mapper import (CONVENTION, Mapper, Transform, load_document,
                              pixel_points, save_document, validate_document,
                              validate_points)


def document():
    return dict(schema_version=1, source_video='public/sample-CCTV/example.mp4',
                source_width=1920, source_height=1080, frame_index=42,
                normalization=CONVENTION,
                bays=[dict(id='Bay_1', direction='northbound',
                           points=[[.1, .1], [.4, .1], [.4, .4], [.1, .4]])])


class Capture:
    def __init__(self):
        self.position = 0

    def get(self, prop):
        return 100 if prop == cv2.CAP_PROP_FRAME_COUNT else self.position

    def set(self, prop, value):
        self.position = value

    def read(self):
        self.position += 1
        return True, np.zeros((108, 192, 3), dtype=np.uint8)


class RoiMapperTests(unittest.TestCase):
    def test_timeline_decodes_on_release_and_retains_polygons(self):
        mapper = Mapper(Capture(), Path('test.mp4').resolve(), Path('unused.json'))
        mapper.data['bays'] = copy.deepcopy(document()['bays'])
        before = copy.deepcopy(mapper.data['bays'])
        mapper.render(1000, 700)
        left, right, y = mapper.timeline
        with patch.object(mapper.cap, 'read', wraps=mapper.cap.read) as read:
            mapper.mouse(cv2.EVENT_LBUTTONDOWN, left, y, 0, None)
            for x in range(left, right, 10):
                mapper.mouse(cv2.EVENT_MOUSEMOVE, x, y, 0, None)
            read.assert_not_called()
            mapper.mouse(cv2.EVENT_LBUTTONUP, right, y, 0, None)
            self.assertEqual(read.call_count, 1)
        self.assertEqual(mapper.index, 99)
        self.assertEqual(mapper.data['frame_index'], 99)
        self.assertEqual(mapper.data['bays'], before)
        mapper.key(ord('['))
        self.assertEqual(mapper.index, 69)
        self.assertEqual(mapper.data['bays'], before)
        with patch.object(mapper.cap, 'read', return_value=(False, None)):
            mapper.mouse(cv2.EVENT_LBUTTONDOWN, left, y, 0, None)
            mapper.mouse(cv2.EVENT_LBUTTONUP, left, y, 0, None)
        self.assertEqual(mapper.index, 69)
        self.assertEqual(mapper.data['bays'], before)
        self.assertIn('Cannot decode', mapper.message)

    def test_unknown_frame_count_and_failed_seek(self):
        cap = Capture()
        original = cap.get
        with patch.object(cap, 'get', side_effect=lambda prop: float('nan') if prop == cv2.CAP_PROP_FRAME_COUNT else original(prop)):
            mapper = Mapper(cap, Path('test.mp4').resolve(), Path('unused.json'))
        self.assertEqual(mapper.count, 0)
        mapper.key(ord(']'))
        self.assertEqual(mapper.index, 30)
        with patch.object(cap, 'set', return_value=False), self.assertRaises(ValueError):
            mapper.seek(80)
        self.assertEqual(mapper.index, 30)

    def test_letterboxing_and_roundtrip(self):
        for cw, ch in [(1200, 800), (600, 1000), (1600, 500)]:
            t = Transform.fit(2304, 1296, cw, ch)
            self.assertIsNone(t.to_source(0, 0))
            for point in ([0, 0], [1152, 648], [2304, 1296], [1500, 700]):
                result = t.to_source(*t.to_display(point))
                self.assertIsNotNone(result)
                self.assertAlmostEqual(result[0], point[0], delta=2304 / t.display_width)
                self.assertAlmostEqual(result[1], point[1], delta=1296 / t.display_height)
            self.assertLessEqual(t.top + t.display_height, ch)
            self.assertLessEqual(t.left + t.display_width, cw)

    def test_resolution_scaling(self):
        bay = document()['bays'][0]
        old = pixel_points(bay, 1920, 1080)
        new = pixel_points(bay, 2304, 1296)
        for a, b in zip(old, new):
            np.testing.assert_allclose(np.array(a) * 1.2, b)
        self.assertEqual(bay['points'][0], [.1, .1])

    def test_invalid_polygons(self):
        bad = [[], [[0, 0]] * 4,
               [[0, 0], [1, 1], [0, 1], [1, 0]],
               [[0, 0], [.2, 0], [.4, 0], [.6, 0]],
               [[-1, 0], [1, 0], [1, 1], [0, 1]],
               [[float('nan'), 0], [1, 0], [1, 1], [0, 1]],
               [[float('inf'), 0], [1, 0], [1, 1], [0, 1]],
               [[True, 0], [1, 0], [1, 1], [0, 1]]]
        for points in bad:
            with self.subTest(points=points), self.assertRaises(ValueError):
                validate_points(points)

    def test_order_preserved(self):
        points = document()['bays'][0]['points']
        before = copy.deepcopy(points)
        self.assertGreater(validate_points(points).area, 0)
        self.assertGreater(validate_points(list(reversed(points))).area, 0)
        self.assertEqual(points, before)

    def test_duplicate_ids_and_overlap(self):
        data = document()
        data['bays'].append(copy.deepcopy(data['bays'][0]))
        with self.assertRaises(ValueError):
            validate_document(data)
        data['bays'][1]['id'] = 'Bay_2'
        self.assertEqual(validate_document(data), ['Bay_1 overlaps Bay_2'])
        data['bays'][1]['id'] = 'Bay_11'
        with self.assertRaises(ValueError):
            validate_document(data)

    def test_schema_errors(self):
        for key, value in [('schema_version', 2), ('normalization', 'pixels'),
                           ('source_width', 0), ('frame_index', -1), ('bays', None)]:
            data = document()
            data[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_document(data)
        data = document()
        data['bays'][0]['direction'] = 'east'
        with self.assertRaises(ValueError):
            validate_document(data)

    def test_atomic_roundtrip_and_overwrite_guard(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'roi.json'
            data = document()
            save_document(path, data)
            self.assertEqual(load_document(path), data)
            changed = copy.deepcopy(data)
            changed['frame_index'] = 50
            with self.assertRaises(FileExistsError):
                save_document(path, changed)
            self.assertEqual(load_document(path), data)
            save_document(path, changed, overwrite=True)
            self.assertEqual(load_document(path), changed)
            self.assertEqual(list(Path(folder).iterdir()), [path])

    def test_failed_replace_preserves_original(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'roi.json'
            save_document(path, document())
            original = path.read_bytes()
            with patch('tools.roi_mapper.os.replace', side_effect=OSError('test failure')):
                with self.assertRaises(OSError):
                    save_document(path, document(), overwrite=True)
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(list(Path(folder).iterdir()), [path])

    def test_mouse_creation_drag_and_duplicate_prevention(self):
        mapper = Mapper(Capture(), Path('test.mp4').resolve(), Path('unused.json'))
        mapper.render(1000, 700)
        mapper.key(ord('n'))
        for point in ([20, 20], [80, 20], [80, 70], [20, 70]):
            x, y = mapper.transform.to_display(point)
            mapper.mouse(cv2.EVENT_LBUTTONDOWN, x, y, 0, None)
        self.assertEqual(len(mapper.data['bays']), 1)
        mapper.key(ord('n'))
        self.assertFalse(mapper.drawing)
        bay = mapper.selected
        old = bay['points'][0][:]
        x, y = mapper.transform.to_display(pixel_points(bay, 192, 108)[0])
        mapper.mouse(cv2.EVENT_LBUTTONDOWN, x, y, 0, None)
        target = mapper.transform.to_display([25, 25])
        mapper.mouse(cv2.EVENT_MOUSEMOVE, *target, 0, None)
        mapper.mouse(cv2.EVENT_LBUTTONUP, *target, 0, None)
        self.assertNotEqual(bay['points'][0], old)
        validate_document(mapper.data)
        mapper.key(ord('b'))
        self.assertEqual(bay['direction'], 'southbound')
        mapper.key(ord('d'))
        self.assertEqual(mapper.data['bays'], [])

    def test_incomplete_drawing_cannot_save(self):
        mapper = Mapper(Capture(), Path('test.mp4').resolve(), Path('unused.json'))
        mapper.draft = [[10, 10]]
        with patch('tools.roi_mapper.save_document') as save:
            mapper.key(ord('s'))
            save.assert_not_called()
        mapper.key(ord('u'))
        self.assertEqual(mapper.draft, [])
        mapper.key(ord(']'))
        self.assertEqual(mapper.index, 30)


if __name__ == '__main__':
    unittest.main()
