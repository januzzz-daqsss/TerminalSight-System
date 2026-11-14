import unittest
from unittest.mock import patch

from backend.cameras.overlay_state import OverlayState, route_labels
from backend.state.occupancy import OccupancyState


class OverlayTests(unittest.TestCase):
    def setUp(self):
        self.state = OccupancyState()
        self.cache = OverlayState(5, max_seconds=3)
        self.detection = dict(vehicle_type='Bus', bbox=[10, 20, 100, 120])
        self.session = self.state.update('Bay_1', self.detection, now=10)
        self.cache.observe({'Bay_1': self.detection}, {'Bay_1': self.session}, 10, 11, 0)

    def test_slow_inference_and_pending_update_retain_exact_observed_position(self):
        for now in (11, 11.5, 12):
            shown = self.cache.visible(self.state.snapshot(now), now, now - 10)
            self.assertEqual(shown['Bay_1'][0]['bbox'], self.detection['bbox'])
        self.assertEqual(self.cache.visible(self.state.snapshot(13), 13, 3), {})

    def test_missed_detection_does_not_refresh_or_erase_cached_box(self):
        session = self.state.update('Bay_1', None, now=11)
        self.cache.observe({}, {'Bay_1': session}, 11, 11.5, 1)
        self.assertIn('Bay_1', self.cache.visible(self.state.snapshot(12), 12, 2))
        self.assertEqual(self.cache.visible(self.state.snapshot(12.3), 12.3, 2.3), {})

    def test_departure_and_replacement_remove_previous_session_overlay(self):
        self.state.clear(['Bay_1'])
        self.state.update('Bay_1', self.detection, now=11)
        self.assertEqual(self.cache.visible(self.state.snapshot(11), 11, 1), {})
        self.state.update('Bay_1', None, now=16)
        self.assertEqual(route_labels(self.state.snapshot(16), ['Bay_1'], True, True), {})

    def test_confirmed_route_survives_blank_ocr_miss_and_box_expiry(self):
        for now in (10, 10.1, 10.2):
            self.state.apply_ocr('Bay_1', self.session['id'], 'DAVAO', .99, now=now)
        self.state.apply_ocr('Bay_1', self.session['id'], '', 0, now=11)
        session = self.state.update('Bay_1', None, now=11)
        self.cache.observe({}, {'Bay_1': session}, 11, 11.2, 1)
        rows = self.state.snapshot(14)
        self.assertEqual(self.cache.visible(rows, 14, 4), {})
        self.assertEqual(route_labels(rows, ['Bay_1'], True, True), {'Bay_1': 'Panabo - Davao'})
        self.assertEqual(route_labels(rows, ['Bay_1'], False, True), {})
        self.state.update('Bay_1', None, now=15)
        self.assertEqual(route_labels(self.state.snapshot(15), ['Bay_1'], True, True), {})

    def test_loop_disconnect_and_source_jump_discard_boxes(self):
        self.assertEqual(self.cache.visible(self.state.snapshot(11), 11, -1), {})
        self.cache.observe({'Bay_1': self.detection}, {'Bay_1': self.session}, 10, 11, 0)
        self.cache.clear()
        self.assertEqual(self.cache.visible(self.state.snapshot(11), 11, 1), {})

    def test_maximum_is_configurable_bounded_and_late_results_stay_hidden(self):
        with patch.dict('os.environ', {'TERMINALSIGHT_OVERLAY_MAX_SECONDS': '999'}):
            self.assertEqual(OverlayState(5).maximum, 5)
            self.assertEqual(OverlayState(2).maximum, 2)
        with patch.dict('os.environ', {'TERMINALSIGHT_OVERLAY_MAX_SECONDS': 'nan'}):
            self.assertEqual(OverlayState(5).maximum, 3)
        self.cache.observe({'Bay_1': self.detection}, {'Bay_1': self.session}, 10, 14, 0)
        self.assertEqual(self.cache.visible(self.state.snapshot(14), 14, 4), {})

    def test_replacement_candidate_cannot_move_incumbent_box(self):
        other = dict(vehicle_type='UV Express', bbox=[200, 20, 300, 100])
        pending = self.state.update('Bay_1', other, now=11)
        self.cache.observe({'Bay_1': other}, {'Bay_1': pending}, 11, 11.2, 1)
        shown = self.cache.visible(self.state.snapshot(11.3), 11.3, 1.3)
        self.assertEqual(shown['Bay_1'][0], self.detection)


if __name__ == '__main__':
    unittest.main()
