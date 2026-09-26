"""Session identity and the shared monotonic loading clock for all three displays."""
import threading
import time
import uuid
from route_recognition import TemporalRoute, load_config


class OccupancyState:
    def __init__(self, config=None, loading_seconds=900, departure_confirm_seconds=None):
        self.config_error = None
        try:
            self.config = config if config is not None else load_config()
        except (OSError, ValueError, KeyError, TypeError) as error:
            # A broken OCR configuration must never prevent bay/timer operation.
            self.config_error = str(error)
            self.config = {'routes': [], 'unknown_after_seconds': 20, 'evidence_window_seconds': 30,
                           'minimum_ocr_score': 0.65, 'minimum_observations': 3,
                           'minimum_route_score': 0.9, 'ambiguity_margin': 0.1}
        self.loading_seconds = loading_seconds
        self.departure_confirm_seconds = (self.config.get('departure_confirm_seconds', 5)
                                          if departure_confirm_seconds is None else departure_confirm_seconds)
        self.sessions = {}
        self.lock = threading.RLock()

    def update(self, bay, detection, now=None):
        now = time.monotonic() if now is None else now
        with self.lock:
            current = self.sessions.get(bay)
            if detection is None:
                if current:
                    current.update(missing=True, ocr_eligible=False, replacement=None)
                    if now - current['last_seen'] >= self.departure_confirm_seconds:
                        del self.sessions[bay]
                        return None
                return current.copy() if current else None
            # A late reacquisition after a confirmed-length gap starts a new session.
            if current and current.get('missing') and now - current['last_seen'] >= self.departure_confirm_seconds:
                current = None
            if current and not self._same_vehicle(current, detection):
                candidate = current.get('replacement')
                if candidate is None or not self._same_vehicle(candidate, detection):
                    candidate = {**detection, 'since': now}
                current.update(replacement=candidate, ocr_eligible=False, missing=False)
                # Do not let transient class/box errors reset the clock or feed another vehicle's OCR.
                if now - candidate['since'] >= self.departure_confirm_seconds:
                    current = None
                else:
                    return current.copy()
            if current is None:
                current = {'id': uuid.uuid4().hex, 'started': now, 'route_state': TemporalRoute(self.config, now)}
                self.sessions[bay] = current
            current.update(last_seen=now, missing=False, replacement=None, ocr_eligible=True,
                           vehicle_type=detection['vehicle_type'], bbox=detection.get('bbox'))
            return current.copy()

    @staticmethod
    def _same_vehicle(first, second):
        if first['vehicle_type'] != second['vehicle_type']:
            return False
        a, b = first.get('bbox'), second.get('bbox')
        if not a or not b:
            return True
        intersection = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))
        union = max(1, (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - intersection)
        return intersection / union >= 0.1

    def clear(self, bays):
        with self.lock:
            for bay in bays:
                self.sessions.pop(bay, None)

    def apply_ocr(self, bay, session_id, text, score, now=None):
        now = time.monotonic() if now is None else now
        with self.lock:
            current = self.sessions.get(bay)
            if not current or current['id'] != session_id:
                return False  # Discard late results belonging to a departed vehicle.
            current['route_state'].observe(text, score, now)
            return True

    def snapshot(self, now=None, debug=False):
        now = time.monotonic() if now is None else now
        with self.lock:
            result = []
            for number in range(1, 11):
                bay = f'Bay_{number}'
                current = self.sessions.get(bay)
                row = {'id': number, 'type': 'Northbound' if number <= 5 else 'Southbound',
                       'status': 'Available', 'sessionId': None, 'vehicleType': None, 'timeRemaining': None,
                       'elapsedSeconds': 0, 'route': None, 'routeDetails': [], 'ocrState': None, 'ocrConfidence': None}
                if current:
                    elapsed = max(0, int(now - current['started']))
                    route = current['route_state'].public(now)
                    row.update(status='Overstaying' if elapsed > self.loading_seconds else 'Occupied',
                               sessionId=current['id'], vehicleType=current['vehicle_type'],
                               timeRemaining=self.loading_seconds - elapsed, elapsedSeconds=elapsed,
                               route=route['route'], routeDetails=route['route_details'],
                               ocrState=route['ocr_state'], ocrConfidence=route['ocr_confidence'])
                    if debug:
                        row['ocrDebug'] = current['route_state'].debug.copy()
                result.append(row)
            return result
