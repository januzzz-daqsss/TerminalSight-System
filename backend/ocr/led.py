"""Complementary red LED candidates and observed-fragment diagnostics, not sign detection ground truth."""
from collections import deque
import time
import threading
import cv2
import numpy as np
from backend.ocr.route_recognition import normalize


def led_crop(image):
    if image is None or image.ndim != 3:
        return None
    b, g, r = [channel.astype(np.int16) for channel in cv2.split(image)]
    dominance = np.clip(r - np.maximum(b, g), 0, 255).astype(np.uint8)
    mask = ((dominance > 30) & (r > 70)).astype(np.uint8) * 255
    grouped = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 13), np.uint8))
    candidates = []
    for contour in cv2.findContours(grouped, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]:
        x,y,w,h = cv2.boundingRect(contour)
        count = cv2.countNonZero(mask[y:y+h, x:x+w])
        if w >= 24 and h >= 5 and 2 <= w/h <= 18 and .04 <= count/(w*h) <= .65:
            candidates.append((count, x,y,w,h))
    if not candidates:
        return None
    _, x,y,w,h = max(candidates)
    pad = max(3, h//3)
    x1,y1,x2,y2 = max(0,x-pad),max(0,y-pad),min(image.shape[1],x+w+pad),min(image.shape[0],y+h+pad)
    crop = dominance[y1:y2, x1:x2]
    scale = min(3, 640/crop.shape[1], 128/crop.shape[0])
    crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    crop = cv2.GaussianBlur(crop, (3,3), .5)
    crop = cv2.createCLAHE(clipLimit=2, tileGridSize=(4,4)).apply(crop)
    # Dark glyphs on a light field; no synthesized/motion-composited characters.
    return cv2.cvtColor(255-crop, cv2.COLOR_GRAY2BGR), [x1,y1,x2,y2]


def join_fragments(first, second):
    """Diagnostic only: overlap either ordering; never inserts unseen characters."""
    a,b = normalize(first).replace(' ', ''), normalize(second).replace(' ', '')
    if not a or not b or a == b:
        return a or b
    merged = set()
    for left,right in ((a,b),(b,a)):
        for length in range(min(len(left),len(right)), 2, -1):
            if left.endswith(right[:length]):
                merged.add(left + right[length:]); break
    return next(iter(merged)) if len(merged) == 1 else None


class LEDReader:
    def __init__(self):
        self.lock = threading.RLock()
        self.sessions = {}  # At most ten bays, four images/eight diagnostic reads each.

    def discard(self, bays):
        with self.lock:
            for bay in bays:
                self.sessions.pop(bay, None)

    def read(self, bay, session, image, read, now=None):
        now = time.monotonic() if now is None else now
        if bay not in {f'Bay_{i}' for i in range(1,11)}:
            return '', 0
        with self.lock:
            state = self.sessions.get(bay)
            if state is None or state['session'] != session:
                state = dict(session=session, last=-float('inf'), images=deque(maxlen=4), records=deque(maxlen=8))
                self.sessions[bay] = state
            if now - state['last'] < 3:
                return '', 0
            state['last'] = now
        candidate = led_crop(image)
        if candidate is None:
            return '', 0
        crop, bounds = candidate
        state['images'].append((now,crop))
        while state['images'] and now-state['images'][0][0] > 30:
            state['images'].popleft()
        start = time.perf_counter()
        text, score = read(crop)
        with self.lock:
            if self.sessions.get(bay) is not state:
                return "", 0
            prior = [r['text'] for r in state['records'] if now-r['sample_time'] <= 30 and r['text']]
            combined = join_fragments(prior[-1], text) if prior and text else None
            state['records'].append(dict(text=text, confidence=score, sample_time=now,
                recognition_ms=round((time.perf_counter()-start)*1000,2), bounds=bounds,
                overlapping_text=combined))
        # Never replay stored images or merged text as independent route evidence.
        return text, score

    def diagnostics(self):
        with self.lock:
            return {bay: dict(session_id=s['session'], reads=list(s['records'])) for bay,s in self.sessions.items()}
