import copy
import time
import unittest
from unittest.mock import patch

import numpy as np

from route_recognition import TemporalRoute, load_config, normalize
from occupancy import OccupancyState
from ocr_worker import OCRWorker, crop_sign, read_sign
from types import SimpleNamespace


def sign_lines(*extras, destination='DAVAO'):
    return [{'text': destination, 'score': .99, 'box': [.35, .50, .65, .60]},
            *[{'text': text, 'score': .96, 'box': [.10, .62, .30, .69]} for text in extras]]


class TemporalOCRTests(unittest.TestCase):
    def setUp(self):
        self.config = load_config()

    def test_normalizes_common_digit_and_punctuation_noise(self):
        self.assertEqual(normalize('  Panab0 -> Tagum! '), 'PANABO TAGUM')

    def test_requires_repeated_evidence_and_retains_recognized_route(self):
        route = TemporalRoute(self.config, 0)
        route.observe('DAVAO', .96, 0)
        route.observe('DAVAO', .96, 1.5)
        self.assertIsNone(route.public(2)['route'])
        route.observe('DAVAO', .96, 3)
        self.assertEqual(route.public(3)['route'], 'Panabo - Davao')
        route.observe('TAGUM', .99, 4.5)
        route.observe('', 0, 50)
        self.assertEqual(route.public(50)['route'], 'Panabo - Davao')

    def test_repeated_partial_led_text_without_any_complete_alias(self):
        config = copy.deepcopy(self.config)
        config['routes'][0]['aliases'] = ['PANABO TAGUM']
        route = TemporalRoute(config, 0)
        for index, text in enumerate(['PANAB', 'NABO TAG', 'TAGUM'] * 2):
            route.observe(text, .97, index * 1.5)
        self.assertEqual(route.public(9)['route'], 'Panabo - Tagum')

    def test_weak_ambiguous_low_quality_and_expired_evidence_stay_unknown(self):
        for text, quality in [('PANABO', .99), ('TAGU', .99), ('RAYAO', .99), ('DAVAO TAGUM', .99), ('DAVAO', .3)]:
            route = TemporalRoute(self.config, 0)
            for now in (0, 1.5, 3, 4.5):
                route.observe(text, quality, now)
            self.assertEqual(route.public(21)['ocr_state'], 'Unknown', text)
        route = TemporalRoute(self.config, 0)
        for now in (0, 40, 80):
            route.observe('DAVAO', .99, now)
        self.assertIsNone(route.public(81)['route'])

    def test_correction_needs_six_strong_new_observations(self):
        route = TemporalRoute(self.config, 0)
        for now in (0, 1.5, 3):
            route.observe('DAVAO', .95, now)
        for index in range(5):
            route.observe('TAGUM', .99, 40 + index * 1.5)
        self.assertEqual(route.public(48)['route'], 'Panabo - Davao')
        route.observe('TAGUM', .99, 49)
        self.assertEqual(route.public(49)['route'], 'Panabo - Tagum')

    def test_secondary_destination_requires_three_reads_and_survives_misses(self):
        route = TemporalRoute(self.config, 0)
        for now, text in enumerate(['MA-A', 'MA·A']):
            route.observe('DAVAO ' + text, .95, now, lines=sign_lines(text))
        self.assertEqual(route.public(2)['route_details'], [])
        route.observe('DAVAO MAA', .95, 3, lines=sign_lines('MAA'))
        self.assertEqual(route.public(3)['route_details'], ['MA-A'])
        route.observe('', 0, 50)
        self.assertEqual(route.public(50)['route_details'], ['MA-A'])
        for index in range(6):
            route.observe('TAGUM', .99, 51 + index * 1.5)
        self.assertEqual(route.public(60)['route'], 'Panabo - Tagum')
        self.assertEqual(route.public(60)['route_details'], [])

    def test_unlisted_names_acronyms_and_multiple_places_are_dynamic(self):
        for destination in ('DAVAO', 'TAGUM'):
            route = TemporalRoute(self.config, 0)
            for now in (0, 1.5, 3):
                route.observe(destination, .99, now,
                              lines=sign_lines('MA-A', 'NCCC', 'SM CITY', 'BUHANGIN', destination=destination))
            self.assertEqual(route.public(3)['route_details'], ['MA-A', 'NCCC', 'SM CITY', 'BUHANGIN'])

    def test_secondary_names_need_positions_quality_and_a_main_sign_anchor(self):
        cases = [[], sign_lines('NCCC')[1:],
                 [sign_lines()[0], {'text': 'NCCC', 'score': .5, 'box': [.1, .62, .3, .69]}],
                 [sign_lines()[0], {'text': 'BRANDING', 'score': .99, 'box': [.1, .05, .3, .15]}],
                 sign_lines('AIRCONDITIONED', 'GOD IS GOOD', 'WI', '5903', 'ABC 1234')]
        for lines in cases:
            route = TemporalRoute(self.config, 0)
            for now in (0, 1.5, 3):
                route.observe('DAVAO', .99, now, lines=lines)
            self.assertEqual(route.public(3)['route_details'], [], lines)

    def test_duplicates_and_expired_reads_do_not_confirm_extra_names(self):
        route = TemporalRoute(self.config, 0)
        route.observe('DAVAO', .99, 0, lines=sign_lines('NCCC', 'NCCC', 'NCCC'))
        route.observe('DAVAO', .99, 0, lines=sign_lines('NCCC'))
        for now in (1.5, 3):
            route.observe('DAVAO', .99, now)
        self.assertEqual(route.public(3)['route_details'], [])
        for now in (40, 80, 120):
            route.observe('DAVAO', .99, now, lines=sign_lines('NCCC'))
        self.assertEqual(route.public(120)['route_details'], [])

    def test_main_route_text_is_removed_from_combined_destination_line(self):
        route = TemporalRoute(self.config, 0)
        for now in (0, 1.5, 3):
            route.observe('DAVAO NCCC', .99, now, lines=sign_lines(destination='DAVAO / NCCC'))
        self.assertEqual(route.public(3)['route_details'], ['NCCC'])

    def test_another_known_place_can_be_an_extra_without_duplicating_main_route(self):
        route = TemporalRoute(self.config, 0)
        for now in (0, 1.5, 3):
            route.observe('DAVAO', .99, now)
        for now in (4.5, 6, 7.5):
            route.observe('DAVAO TAGUM', .99, now, lines=sign_lines('TAGUM', 'PANABO', 'DAVAO'))
        self.assertEqual(route.public(8)['route_details'], ['TAGUM'])


class OccupancySessionTests(unittest.TestCase):
    detection = {'vehicle_type': 'Bus', 'bbox': [0, 0, 100, 100]}

    def test_departure_resets_route_and_rejects_old_worker_results(self):
        state = OccupancyState()
        first = state.update('Bay_6', self.detection, now=0)
        for now in (0, 1.5, 3):
            state.apply_ocr('Bay_6', first['id'], 'DAVAO', .99, now=now)
        state.update('Bay_6', None, now=4.9)
        row = state.snapshot(now=4.9)[5]
        self.assertEqual(row['sessionId'], first['id'])
        self.assertEqual(row['route'], 'Panabo - Davao')
        self.assertEqual(row['timeRemaining'], 896)
        state.update('Bay_6', None, now=5)
        self.assertIsNone(state.snapshot(now=5)[5]['route'])
        second = state.update('Bay_6', self.detection, now=6)
        self.assertNotEqual(first['id'], second['id'])
        self.assertFalse(state.apply_ocr('Bay_6', first['id'], 'DAVAO', .99, now=7))
        self.assertEqual(state.snapshot(now=7)[5]['ocrState'], 'Detecting')

    def test_short_obstruction_and_reacquisition_preserve_session(self):
        state = OccupancyState()
        first = state.update('Bay_1', self.detection, now=0)
        for now in (0, 1.5, 3):
            state.apply_ocr('Bay_1', first['id'], 'DAVAO', .99, now=now)
        held = state.update('Bay_1', None, now=4)
        self.assertFalse(held['ocr_eligible'])
        restored = state.update('Bay_1', self.detection, now=4.9)
        self.assertTrue(restored['ocr_eligible'])
        self.assertEqual(restored['id'], first['id'])
        row = state.snapshot(now=6)[0]
        self.assertEqual(row['route'], 'Panabo - Davao')
        self.assertEqual(row['timeRemaining'], 894)

    def test_late_reacquisition_after_gap_and_configurable_delay(self):
        config = load_config()
        config['departure_confirm_seconds'] = 3
        state = OccupancyState(config=config)
        first = state.update('Bay_1', self.detection, now=0)
        state.update('Bay_1', None, now=1)
        second = state.update('Bay_1', self.detection, now=3)
        self.assertNotEqual(first['id'], second['id'])

    def test_shared_clock_boundaries_and_sample_loop_reset(self):
        state = OccupancyState()
        state.update('Bay_1', self.detection, now=100)
        self.assertEqual(state.snapshot(now=999)[0]['timeRemaining'], 1)
        self.assertEqual(state.snapshot(now=1000)[0]['status'], 'Occupied')
        self.assertEqual(state.snapshot(now=1000)[0]['timeRemaining'], 0)
        self.assertEqual(state.snapshot(now=1001)[0]['status'], 'Overstaying')
        self.assertEqual(state.snapshot(now=1001)[0]['timeRemaining'], -1)
        state.clear(['Bay_1'])
        self.assertIsNone(state.snapshot(now=1002)[0]['sessionId'])

    def test_secondary_destination_is_bound_to_occupancy_session(self):
        state = OccupancyState()
        session = state.update('Bay_6', self.detection, now=0)
        for now in (0, 1.5, 3):
            state.apply_ocr('Bay_6', session['id'], 'DAVAO MA-A', .95, now=now, lines=sign_lines('MA-A'))
        state.update('Bay_6', None, now=4)
        self.assertEqual(state.snapshot(now=4)[5]['routeDetails'], ['MA-A'])
        state.update('Bay_6', None, now=5)
        self.assertEqual(state.snapshot(now=5)[5]['routeDetails'], [])
        state.update('Bay_6', self.detection, now=6)
        self.assertFalse(state.apply_ocr('Bay_6', session['id'], 'DAVAO MA-A', .99, now=7, lines=sign_lines('MA-A')))
        self.assertEqual(state.snapshot(now=7)[5]['routeDetails'], [])

    def test_different_vehicle_box_starts_new_session(self):
        state = OccupancyState()
        first = state.update('Bay_6', self.detection, now=0)
        other = {'vehicle_type': 'Bus', 'bbox': [200, 200, 300, 300]}
        state.update('Bay_6', other, now=1)
        held = state.update('Bay_6', other, now=5.9)
        self.assertEqual(held['id'], first['id'])
        self.assertFalse(held['ocr_eligible'])
        second = state.update('Bay_6', other, now=6)
        self.assertNotEqual(first['id'], second['id'])

    def test_class_change_requires_consistent_evidence_and_resets_session(self):
        state = OccupancyState()
        first = state.update('Bay_6', self.detection, now=0)
        replacement = {**self.detection, 'vehicle_type': 'UV Express'}
        state.update('Bay_6', replacement, now=1)
        self.assertEqual(state.snapshot(now=1)[5]['vehicleType'], 'Bus')
        second = state.update('Bay_6', replacement, now=6)
        self.assertNotEqual(first['id'], second['id'])
        self.assertEqual(state.snapshot(now=6)[5]['vehicleType'], 'UV Express')

    def test_transient_class_change_recovers_without_route_or_timer_reset(self):
        state = OccupancyState()
        first = state.update('Bay_6', self.detection, now=0)
        replacement = {**self.detection, 'vehicle_type': 'UV Express'}
        held = state.update('Bay_6', replacement, now=1)
        self.assertFalse(held['ocr_eligible'])
        restored = state.update('Bay_6', self.detection, now=4)
        self.assertEqual(restored['id'], first['id'])
        self.assertTrue(restored['ocr_eligible'])
        state.update('Bay_6', replacement, now=5)
        held_again = state.update('Bay_6', replacement, now=6)
        self.assertEqual(held_again['id'], first['id'])
        self.assertEqual(state.snapshot(now=6)[5]['timeRemaining'], 894)

    def test_unrelated_candidates_do_not_count_as_consistent_replacement(self):
        state = OccupancyState()
        first = state.update('Bay_6', self.detection, now=0)
        state.update('Bay_6', {'vehicle_type': 'Bus', 'bbox': [200, 200, 300, 300]}, now=1)
        held = state.update('Bay_6', {'vehicle_type': 'Bus', 'bbox': [400, 400, 500, 500]}, now=6)
        self.assertEqual(held['id'], first['id'])

    def test_configuration_failure_does_not_disable_occupancy(self):
        with patch('occupancy.load_config', side_effect=ValueError('Invalid OCR config')):
            state = OccupancyState()
        state.update('Bay_1', self.detection, now=0)
        self.assertEqual(state.snapshot(now=21)[0]['ocrState'], 'Unknown')
        self.assertEqual(state.snapshot(now=21)[0]['status'], 'Occupied')

    def test_worker_initialization_failure_is_isolated(self):
        state = OccupancyState()
        with patch('ocr_worker.create_engine', side_effect=RuntimeError('Test missing model')):
            worker = OCRWorker(state)
            worker.start()
            worker.thread.join(timeout=3)
        self.assertEqual(worker.health()['state'], 'Failed')
        state.update('Bay_6', self.detection, now=0)
        self.assertEqual(state.snapshot(now=1)[5]['timeRemaining'], 899)

    def test_bounded_queue_and_sampling_cooldown(self):
        state = OccupancyState()
        worker = OCRWorker(state)
        with patch('ocr_worker.crop_sign', return_value=object()) as crop:
            for index in range(1, 5):
                worker.submit(f'Bay_{index}', 'session', None, self.detection)
            self.assertEqual(len(worker.pending), 2)
            worker.submit('Bay_4', 'session', None, self.detection)
            self.assertEqual(crop.call_count, 4)


class SignCropTests(unittest.TestCase):
    def test_read_sign_preserves_per_line_quality_and_normalized_locations(self):
        image = np.zeros((100, 200, 3), dtype=np.uint8)
        result = SimpleNamespace(txts=['DAVAO', 'NCCC', 'noise'], scores=[.99, .88, .2],
                                 boxes=[[[20, 50], [80, 50], [80, 60], [20, 60]],
                                        [[90, 60], [140, 60], [140, 70], [90, 70]],
                                        [[1, 1], [5, 1], [5, 5], [1, 5]]])
        with patch('ocr_worker.create_engine') as factory:
            engine = factory.return_value
            engine.return_value = result
            text, _, lines = read_sign(engine, image, include_lines=True)
            self.assertEqual(text, 'DAVAO NCCC')
            self.assertEqual(lines[1], {'text': 'NCCC', 'score': .88, 'box': [.45, .6, .7, .7]})
            self.assertEqual(len(lines), 2)
            engine.assert_called_once_with(image)
            result.boxes = None
            self.assertEqual(read_sign(engine, image, include_lines=True)[2], [])

    def test_uv_focus_stretches_vertical_lettering_and_bounds_image_size(self):
        config = load_config()
        frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
        detection = {'vehicle_type': 'UV Express', 'bbox': [100, 100, 500, 500]}
        crop = crop_sign(frame, detection, config)
        self.assertEqual(crop.shape[:2], (528, 912))
        detection['bbox'] = [0, 0, 1920, 1080]
        self.assertLessEqual(max(crop_sign(frame, detection, config).shape[:2]), 960)

    def test_clips_to_frame_and_rejects_empty_or_tiny_crops(self):
        config = load_config()
        config['sign_regions']['Bus'] = [0, 0, 1, 1]
        frame = np.zeros((100, 100, 3), dtype=np.uint8)
        detection = {'vehicle_type': 'Bus', 'bbox': [-10, -10, 60, 60]}
        self.assertEqual(crop_sign(frame, detection, config).shape[:2], (120, 120))
        for bbox in ([110, 110, 200, 200], [0, 0, 20, 10]):
            detection['bbox'] = bbox
            self.assertIsNone(crop_sign(frame, detection, config))
