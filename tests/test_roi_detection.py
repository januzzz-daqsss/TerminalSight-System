"""Pure geometry, adapter contract and read-only diagnostic isolation tests."""
import ast
import copy
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock

import numpy as np
from shapely.geometry import box
from tools.roi_detection_test import (ROOT, YoloDetector, assign_vehicles, overlay,
                                       prepare_rois, read_only_audit, ground_assign,
                                       ground_point, optimal_matching, Stabilizer, vehicle_mapping)
from tools.roi_mapper import load_document


class DetectionTests(unittest.TestCase):
    def test_foreground_box_does_not_occupy_background(self):
        p = {'Bay_1': box(10, 10, 50, 50)}
        ds = [{'bbox': [0, 0, 100, 200]}]
        self.assertEqual(assign_vehicles(p, ds, .2)[0], {'Bay_1': 0})
        assigned, states, reasons = ground_assign(p, ds)
        self.assertEqual(assigned, {})
        self.assertEqual(states['Bay_1'], 'AVAILABLE')
        self.assertTrue(any('outside' in r for r in reasons))
        self.assertEqual(ground_point(ds[0]), (50, 200))

    def test_ground_boundary_and_tolerance(self):
        p = {'Bay_1': box(0, 0, 100, 100)}
        ds = [{'bbox': [0, 0, 100, 100]}]
        self.assertEqual(ground_assign(p, ds, tolerance=0)[0], {'Bay_1': 0})
        ds[0]['bbox'][3] = 102
        self.assertEqual(ground_assign(p, ds, tolerance=2)[0], {'Bay_1': 0})
        self.assertEqual(ground_assign(p, ds, tolerance=1)[0], {})

    def test_cropped_and_weak_evidence_abstain(self):
        p = {'Bay_1': box(0, 0, 100, 100)}
        ds = [{'bbox': [0, 0, 100, 100]}]
        self.assertEqual(ground_assign(p, ds, frame_height=100)[1]['Bay_1'], 'AMBIGUOUS')
        ds[0]['bbox'] = [40, 90, 60, 100]
        self.assertEqual(ground_assign(p, ds)[1]['Bay_1'], 'AMBIGUOUS')

    def test_global_matching_not_greedy(self):
        edges = {('A', 0): .9, ('A', 1): .8, ('B', 0): .7}
        _, matched = optimal_matching(['A', 'B'], edges, 2)
        self.assertEqual(matched, {'A': 1, 'B': 0})
        self.assertEqual(len(set(matched.values())), len(matched))

    def test_near_tie_abstains_and_order_independent(self):
        p = {'Bay_2': box(0, 0, 100, 100), 'Bay_1': box(0, 0, 100, 100)}
        ds = [{'bbox': [0, 0, 100, 90]}]
        result = ground_assign(p, ds)
        self.assertEqual(result[0], {})
        self.assertEqual(set(result[1].values()), {'AMBIGUOUS'})
        self.assertEqual(result[:2], ground_assign(dict(reversed(list(p.items()))), ds)[:2])

    def test_temporal_flicker_and_seek_reset(self):
        s = Stabilizer(.2)
        state = {'Bay_1': 'OCCUPIED'}
        self.assertEqual(s.update(state, 0, 10)['Bay_1'], 'UNKNOWN')
        s.update(state, 1, 10)
        self.assertEqual(s.update(state, 2, 10)['Bay_1'], 'OCCUPIED')
        self.assertEqual(s.update({'Bay_1': 'AVAILABLE'}, 3, 10)['Bay_1'], 'OCCUPIED')
        self.assertEqual(s.update(state, 4, 10)['Bay_1'], 'OCCUPIED')
        self.assertEqual(s.update(state, 0, 10)['Bay_1'], 'UNKNOWN')
        self.assertEqual(s.update(state, 30, 10)['Bay_1'], 'UNKNOWN')
        s.reset()
        self.assertEqual(s.stable, {})

    def test_class_mapping_is_explicit_not_car_to_van(self):
        self.assertEqual(vehicle_mapping('bus'), 'Bus')
        self.assertEqual(vehicle_mapping('uv'), 'UV Express')
        self.assertIsNone(vehicle_mapping('car'))
        self.assertIsNone(vehicle_mapping('truck'))

    def test_all_exports_and_dimensions(self):
        paths = list((ROOT / 'config/roi').glob('*.json'))
        if not paths:
            self.skipTest('User ROI exports are not present in this checkout')
        for path in paths:
            data = load_document(path)
            polys, _ = prepare_rois(data, ROOT / data['source_video'],
                                   data['source_width'], data['source_height'])
            for bay in data['bays']:
                x, y = polys[bay['id']].exterior.coords[0]
                self.assertAlmostEqual(x, bay['points'][0][0] * data['source_width'])
                self.assertAlmostEqual(y, bay['points'][0][1] * data['source_height'])
            with self.assertRaises(ValueError):
                prepare_rois(data, ROOT / 'wrong.mp4', data['source_width'], data['source_height'])
            with self.assertRaises(ValueError):
                prepare_rois(data, ROOT / data['source_video'], 1, 1)

    def test_threshold_matches_operational_constant(self):
        tree = ast.parse((ROOT / 'backend/detection/detector.py').read_text())
        threshold = next(n.value.value for n in tree.body if isinstance(n, ast.Assign)
                         and any(isinstance(t, ast.Name) and t.id == 'OCCUPANCY_THRESHOLD' for t in n.targets))
        self.assertEqual(threshold, .20)
        p = {'Bay_1': box(0, 0, 100, 100)}
        self.assertEqual(assign_vehicles(p, [{'bbox': [0, 0, 20, 100]}], threshold)[0], {'Bay_1': 0})
        self.assertEqual(assign_vehicles(p, [{'bbox': [0, 0, 19, 100]}], threshold)[0], {})

    def test_one_vehicle_one_bay_and_order(self):
        p = {'Bay_2': box(0, 0, 10, 10), 'Bay_1': box(0, 0, 10, 10)}
        assignments, scores, warnings = assign_vehicles(p, [{'bbox': [0, 0, 10, 10]}], .2)
        self.assertEqual(assignments, {'Bay_2': 0})
        self.assertEqual(scores['Bay_1'], [1])
        self.assertTrue(warnings)

    def test_best_vehicle_tie_and_empty(self):
        p = {'Bay_1': box(0, 0, 10, 10), 'Bay_2': box(0, 0, 10, 10)}
        ds = [{'bbox': [0, 0, 3, 10]}, {'bbox': [0, 0, 9, 10]}]
        self.assertEqual(assign_vehicles(p, ds, .2)[0], {'Bay_1': 1, 'Bay_2': 0})
        self.assertEqual(assign_vehicles(p, [], .2)[0], {})
        ds[0] = copy.deepcopy(ds[1])
        self.assertEqual(assign_vehicles(p, ds, .2)[0], {'Bay_1': 0, 'Bay_2': 1})

    def test_confidence_adapter_contract(self):
        def tensor(value):
            t = Mock()
            t.item.return_value = value
            return t
        def detection(label, confidence):
            b = Mock()
            b.cls, b.conf = tensor(label), tensor(confidence)
            coords = Mock()
            coords.cpu.return_value.tolist.return_value = [1, 2, 20, 30]
            b.xyxy = [coords]
            return b
        result = Mock(names={0: 'bus', 1: 'uv', 2: 'person'},
                      boxes=[detection(0, .8), detection(1, .9), detection(2, .99)])
        detector = YoloDetector.__new__(YoloDetector)
        detector.adapter = Mock(device='cpu')
        detector.adapter.model.return_value = [result]
        frame = np.zeros((100, 100, 3), np.uint8)
        output = detector.predict(frame)
        self.assertEqual([d['vehicle_type'] for d in output], ['Bus', 'UV Express'])
        self.assertEqual([d['confidence'] for d in output], [.8, .9])
        self.assertEqual([d['class_id'] for d in output], [0, 1])
        self.assertEqual([d['class_name'] for d in output], ['bus', 'uv'])
        kwargs = detector.adapter.model.call_args.kwargs
        self.assertEqual(kwargs['conf'], .5)
        self.assertFalse(kwargs['save'])
        image = overlay(frame, {'Bay_1': box(1, 1, 50, 50)}, output,
                        {'Bay_1': 'OCCUPIED'}, 0, 10, True, 1)
        self.assertGreater(image.shape[0], frame.shape[0])

    def test_read_only_guard(self):
        read_only_audit('open', ('test', 'r', 0))
        for event, args in [('open', ('test', 'w', 0)), ('sqlite3.connect', ('db',)),
                            ('os.remove', ('file',)), ('socket.connect', ())]:
            with self.subTest(event=event), self.assertRaises(PermissionError):
                read_only_audit(event, args)

    def test_import_does_not_start_runtime_or_operations(self):
        before = set(sys.modules)
        spec = importlib.util.spec_from_file_location('isolated_roi_diagnostic', ROOT / 'tools/roi_detection_test.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        added = set(sys.modules) - before
        self.assertFalse(any(n.startswith(('backend.', 'flask', 'ultralytics')) for n in added))
        source = (ROOT / 'tools/roi_detection_test.py').read_text()
        self.assertNotIn('runtime.initialize(', source)
        self.assertNotIn('runtime.switch(', source)


if __name__ == '__main__':
    unittest.main()
