"""Presentation-only retention of observed boxes; never predicts vehicle motion."""
import math
import os


class OverlayState:
    def __init__(self, departure_seconds, max_seconds=None):
        if max_seconds is None:
            try:
                max_seconds = float(os.environ.get('TERMINALSIGHT_OVERLAY_MAX_SECONDS', '3'))
            except ValueError:
                max_seconds = 3
        if not math.isfinite(max_seconds) or max_seconds <= 0:
            max_seconds = 3
        self.maximum = min(float(departure_seconds), max_seconds, 5.0)
        self.entries = {}

    def clear(self):
        self.entries.clear()

    def observe(self, assignments, sessions, submitted, completed, position):
        # Budget includes queue/inference latency and time for the next update.
        lifetime = min(self.maximum, max(1.0, 2 * max(0, completed - submitted) + .25))
        for bay in list(self.entries):
            session = sessions.get(bay)
            if not session or session['id'] != self.entries[bay]['session']:
                del self.entries[bay]
        for bay, detection in assignments.items():
            session = sessions.get(bay)
            # Replacement candidates must not acquire the incumbent's OCR label.
            if session and session.get('ocr_eligible'):
                self.entries[bay] = dict(session=session['id'], detection={
                    **detection, 'bbox': list(detection['bbox'])}, submitted=submitted,
                    position=position, lifetime=lifetime)

    def visible(self, rows, now, position):
        active = {f"Bay_{row['id']}": row['sessionId'] for row in rows}
        result = {}
        for bay, entry in list(self.entries.items()):
            source_age = position - entry['position']
            age = max(now - entry['submitted'], source_age)
            if (active.get(bay) != entry['session'] or source_age < 0
                    or age < 0 or age >= entry['lifetime']):
                del self.entries[bay]
            else:
                result[bay] = (entry['detection'], age)
        return result


def route_labels(rows, bays, healthy, ocr_ready):
    """Session labels are bay-anchored, independent of box visibility."""
    if not healthy:
        return {}
    return {f"Bay_{row['id']}": row['route'] or (
        'OCR unavailable' if not ocr_ready else
        'Route unknown' if row['ocrState'] == 'Unknown' else 'Route detecting')
        for row in rows if f"Bay_{row['id']}" in bays and row['sessionId']}
