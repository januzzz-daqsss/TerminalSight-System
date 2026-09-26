"""Conservative, temporal known-route matching. No image/OCR dependencies here."""
from collections import deque
from difflib import SequenceMatcher
import json
from pathlib import Path
import re
import unicodedata

CONFIG_PATH = Path(__file__).resolve().parent / 'config' / 'routes.json'


def load_config(path=CONFIG_PATH):
    config = json.loads(Path(path).read_text(encoding='utf-8-sig'))
    ids = [route['id'] for route in config['routes']]
    if len(ids) != len(set(ids)):
        raise ValueError('Route IDs must be unique')
    for route in config['routes']:
        if not route['aliases'] or any(len(normalize(alias).replace(' ', '')) < 4 for alias in route['aliases']):
            raise ValueError('Route aliases require at least four letters')
        details = route.get('secondary_destinations', [])
        if len({detail['id'] for detail in details}) != len(details):
            raise ValueError('Secondary destination IDs must be unique within a route')
        aliases_seen = set()
        for detail in details:
            if not isinstance(detail['label'], str) or not detail['label'].strip() or not detail['aliases']:
                raise ValueError('Secondary destinations require a label and aliases')
            aliases = {normalize(alias) for alias in detail['aliases']}
            if any(len(alias.replace(' ', '')) < 3 for alias in aliases) or aliases & aliases_seen:
                raise ValueError('Secondary aliases require at least three letters and must be unambiguous')
            aliases_seen.update(aliases)
    config.setdefault('departure_confirm_seconds', 5)
    for name in ('sample_interval_seconds', 'evidence_window_seconds', 'unknown_after_seconds', 'departure_confirm_seconds'):
        if not isinstance(config[name], (int, float)) or config[name] <= 0:
            raise ValueError(f'{name} must be positive')
    if config['minimum_observations'] < 3:
        raise ValueError('At least three independent observations are required')
    for name in ('minimum_ocr_score', 'minimum_route_score', 'ambiguity_margin'):
        if not 0 < config[name] <= 1:
            raise ValueError(f'{name} must be between zero and one')
    for vehicle_type in ('Bus', 'UV Express'):
        region = config['sign_regions'][vehicle_type]
        if len(region) != 4 or not (0 <= region[0] < region[2] <= 1 and 0 <= region[1] < region[3] <= 1):
            raise ValueError('Invalid normalized sign region')
        options = config.get('sign_preprocessing', {}).get(vehicle_type, {})
        if not 1 <= options.get('scale', 2) <= 6 or not 0.5 <= options.get('vertical_stretch', 1) <= 3:
            raise ValueError('Sign scale must be 1–6 and vertical stretch 0.5–3')
    return config


def normalize(text):
    text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode().upper()
    text = text.translate(str.maketrans({'0': 'O', '1': 'I', '5': 'S', '8': 'B'}))
    return ' '.join(re.sub('[^A-Z ]', ' ', text).split())


class TemporalRoute:
    def __init__(self, config, started):
        self.config = config
        self.started = started
        self.observations = deque(maxlen=24)
        self.route = None
        self.confidence = 0.0
        self.support = 0
        self.confirmed_secondary = set()
        self.debug = {'raw': '', 'normalized': '', 'candidate': None, 'confidence': 0, 'support': 0}

    def observe(self, text, score, now):
        normalized = normalize(text)
        if score >= self.config['minimum_ocr_score'] and normalized:
            self.observations.append((now, normalized, score))
        while self.observations and now - self.observations[0][0] > self.config['evidence_window_seconds']:
            self.observations.popleft()
        ranked = []
        for route in self.config['routes']:
            best = (0.0, 0)
            for alias in route['aliases']:
                target = normalize(alias).replace(' ', '')
                coverage = [0] * len(target)
                supporting = []
                for _, observed, quality in self.observations:
                    source = observed.replace(' ', '')
                    blocks = SequenceMatcher(None, target, source, autojunk=False).get_matching_blocks()
                    indices = {i for block in blocks if block.size >= 3 for i in range(block.a, block.a + block.size)}
                    # Full near-match handles small substitutions; partial blocks handle LED fragments.
                    tokens = observed.split()
                    near = max([SequenceMatcher(None, target, token, autojunk=False).ratio() for token in [source, *tokens] if abs(len(token) - len(target)) <= len(target) // 10], default=0)
                    if near >= 0.88 and len(target) >= 5:
                        indices = set(range(len(target)))
                    if len(indices) >= 3:
                        for i in indices:
                            coverage[i] += 1
                        supporting.append(quality)
                # Each character must be seen at least twice in independent sampled frames.
                covered = sum(count >= 2 for count in coverage) / len(target)
                support = len(supporting)
                if support >= self.config['minimum_observations']:
                    score = covered * (0.85 + 0.15 * sum(supporting) / support)
                    best = max(best, (score, support))
            ranked.append((best[0], best[1], route))
        ranked.sort(key=lambda item: item[0], reverse=True)
        top = ranked[0] if ranked else (0, 0, None)
        runner = ranked[1][0] if len(ranked) > 1 else 0
        self.debug = {'raw': text, 'normalized': normalized, 'candidate': top[2]['label'] if top[0] else None,
                      'confidence': round(top[0], 3), 'support': top[1]}
        if top[0] >= self.config['minimum_route_score'] and top[0] - runner >= self.config['ambiguity_margin']:
            if self.route is None or self.route['id'] == top[2]['id']:
                self.route, self.confidence, self.support = top[2], top[0], top[1]
            else:
                # Correction needs sustained stronger current evidence, not one noisy frame.
                incumbent = next((item[0] for item in ranked if item[2]['id'] == self.route['id']), 0)
                if top[1] >= 6 and top[0] >= 0.95 and top[0] - incumbent >= 0.2:
                    self.route, self.confidence, self.support = top[2], top[0], top[1]
                    self.confirmed_secondary.clear()
        if self.route:
            for detail in self.route.get('secondary_destinations', []):
                # Short place names such as MAA need exact whole words, never fuzzy fragments.
                aliases = {' ' + normalize(alias) + ' ' for alias in detail['aliases']}
                support = sum(any(alias in ' ' + observed + ' ' for alias in aliases)
                              for _, observed, _ in self.observations)
                if support >= self.config['minimum_observations']:
                    self.confirmed_secondary.add(detail['id'])

    def public(self, now):
        return {'route': self.route['label'] if self.route else None,
                'route_details': [detail['label'] for detail in self.route.get('secondary_destinations', [])
                                  if detail['id'] in self.confirmed_secondary] if self.route else [],
                'ocr_state': 'Recognized' if self.route else ('Unknown' if now - self.started >= self.config['unknown_after_seconds'] else 'Detecting'),
                'ocr_confidence': round(self.confidence, 3) if self.route else None}
