"""Local health and the status contract for a future cloud sync worker.

Cloud workers must update this state from actual upload acknowledgements. No network
probe or simulated upload is used, and local processing never waits for cloud.
"""
import threading
import time

_lock = threading.Lock()
_cameras = {
    'northbound': {'id': 1, 'name': 'Northbound Cam 1', 'state': 'Disabled', 'last_frame': None},
    'southbound': {'id': 2, 'name': 'Southbound Cam 1', 'state': 'Disabled', 'last_frame': None},
}
_cloud = {'configured': False, 'connection': 'Not configured', 'state': 'Not configured',
          'last_successful_sync': None, 'pending_records': None,
          'last_result': 'No cloud sync service is configured.', 'completed_records': 0,
          'completion_id': None}


def camera_state(name, state, frame=False):
    with _lock:
        _cameras[name]['state'] = state
        if frame:
            _cameras[name]['last_frame'] = time.time()


def update_cloud_status(**values):
    """Internal integration point, called by a future authenticated sync worker."""
    allowed = {'Synced', 'Syncing', 'Pending', 'Offline', 'Sync Error', 'Not configured'}
    if values.get('state', _cloud['state']) not in allowed:
        raise ValueError('Invalid cloud sync state')
    with _lock:
        _cloud.update({key: value for key, value in values.items() if key in _cloud})


def snapshot():
    with _lock:
        cameras = []
        for camera in _cameras.values():
            item = camera.copy()
            if item['state'] in ('Live', 'Starting', 'Unstable') and item['last_frame'] is not None:
                age = time.time() - item['last_frame']
                if age > 30:
                    item['state'] = 'Disconnected'
                elif age > 10:
                    item['state'] = 'Unstable'
            cameras.append(item)
        return {'local': 'Online', 'cameras': cameras, 'cloud': _cloud.copy()}
