"""Repeated destination-sign text, without a secondary-place allowlist.

These are OCR labels, not verified geographic routes. Position, confidence and
repetition reduce windshield branding/noise but cannot establish place semantics.
"""
from collections import Counter, deque
import re
import unicodedata


def clean_text(text):
    text = unicodedata.normalize('NFKD', str(text).replace('·', '-'))
    text = text.encode('ascii', 'ignore').decode().upper()
    text = re.sub(r'[^A-Z0-9\s/-]', ' ', text)
    return re.sub(r'\s*-\s*', '-', ' '.join(text.split())).strip(' -/')


def alias_pattern(alias):
    words = re.findall(r'[A-Z0-9]+', clean_text(alias))
    return re.compile(r'(?<![A-Z0-9])' + r'[\s/-]+'.join(words) + r'(?![A-Z0-9])')


def frame_candidates(lines, route, config):
    minimum = max(0.85, config['minimum_ocr_score'])
    lines = [line for line in lines if line['score'] >= minimum]
    anchors = [line for line in lines if any(alias_pattern(alias).search(clean_text(line['text']))
               for alias in route['aliases'])]
    # Remove main destinations/origin rather than duplicating them as extra labels.
    main_aliases = set(route['aliases'])
    main_aliases.update(part.strip() for part in route['label'].split(' - '))
    patterns = [alias_pattern(alias) for alias in sorted(main_aliases, key=len, reverse=True)]
    candidates = {}
    for line in lines:
        _, top, _, bottom = line['box']
        center = (top + bottom) / 2
        # Adjacent cards at the main sign's height or just beneath it. Upper-window
        # branding is excluded; the bounds scale with the observed sign lettering.
        if not any(anchor['box'][1] + .15 * (anchor['box'][3] - anchor['box'][1]) <= center
                   <= anchor['box'][3] + 1.5 * (anchor['box'][3] - anchor['box'][1]) for anchor in anchors):
            continue
        text = clean_text(line['text'])
        for pattern in patterns:
            text = pattern.sub(' ', text)
        for part in re.split(r'\s*/\s*', text):
            label = ' '.join(part.split()).strip(' -')
            key = re.sub(r'[^A-Z0-9]', '', label)
            if not 3 <= len(re.sub('[^A-Z]', '', key)) <= 40 or len(label) > 60:
                continue
            if re.fullmatch(r'[A-Z]{2,4}[ -]*\d{3,5}', label):
                continue  # Fleet/plate numbers are not passenger destinations.
            if any(word in key for word in ('AIRCON', 'VIDEO', 'GOD', 'ALLTHETIME', 'WIFI')):
                continue
            # Punctuation-only variants (MA-A / MA A / MAA) share one evidence key.
            candidates.setdefault(key, label)
    return candidates


class DynamicRouteDetails:
    def __init__(self, config):
        self.config = config
        self.frames = deque(maxlen=24)
        self.route_id = None
        self.confirmed = {}

    def observe(self, lines, now, route):
        if route and self.route_id is not None and route['id'] != self.route_id:
            self.frames.clear()
            self.confirmed.clear()
        if route:
            self.route_id = route['id']
        # One vote per sampled frame; duplicate labels in a single image never add votes.
        if not self.frames or now > self.frames[-1][0]:
            self.frames.append((now, lines))
        while self.frames and now - self.frames[0][0] > self.config['evidence_window_seconds']:
            self.frames.popleft()
        if not route:
            return
        evidence = {}
        for _, frame in self.frames:
            for key, label in frame_candidates(frame, route, self.config).items():
                evidence.setdefault(key, Counter())[label] += 1
        for key, labels in evidence.items():
            if sum(labels.values()) >= self.config['minimum_observations']:
                # Prefer the spelling repeatedly read; no dictionary supplies new names.
                self.confirmed[key] = max(labels, key=lambda label: (labels[label], '-' in label))

    def public(self):
        return list(self.confirmed.values())
