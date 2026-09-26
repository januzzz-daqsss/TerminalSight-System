import importlib
import unittest
from unittest.mock import patch
import system_status

class SystemStatusTests(unittest.TestCase):
    def setUp(self):
        importlib.reload(system_status)

    def test_api_only_mode_reports_disabled_cameras_and_no_cloud(self):
        state = system_status.snapshot()
        self.assertEqual(state['local'], 'Online')
        self.assertEqual(state['cloud']['state'], 'Not configured')
        self.assertIsNone(state['cloud']['pending_records'])
        self.assertTrue(all(camera['state'] == 'Disabled' for camera in state['cameras']))

    def test_stale_feed_degrades_then_recovers(self):
        with patch('system_status.time.time', return_value=100):
            system_status.camera_state('northbound', 'Live', frame=True)
        for now, expected in [(105, 'Live'), (115, 'Unstable'), (135, 'Disconnected')]:
            with patch('system_status.time.time', return_value=now):
                self.assertEqual(system_status.snapshot()['cameras'][0]['state'], expected)
        with patch('system_status.time.time', return_value=140):
            system_status.camera_state('northbound', 'Live', frame=True)
            self.assertEqual(system_status.snapshot()['cameras'][0]['state'], 'Live')

    def test_cloud_outage_does_not_change_local_health(self):
        system_status.update_cloud_status(configured=True, connection='Offline', state='Offline', pending_records=42)
        state = system_status.snapshot()
        self.assertEqual(state['local'], 'Online')
        self.assertEqual(state['cloud']['pending_records'], 42)
        state['cloud']['state'] = 'Synced'
        self.assertEqual(system_status.snapshot()['cloud']['state'], 'Offline')
        with self.assertRaises(ValueError):
            system_status.update_cloud_status(state='invented')
