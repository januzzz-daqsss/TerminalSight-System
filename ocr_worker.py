"""Bounded local OCR worker. Detection only enqueues small sign crops, never waits."""
from collections import OrderedDict
from pathlib import Path
import logging
import threading
import time

LOGGER = logging.getLogger(__name__)


def create_engine():
    import rapidocr
    from rapidocr import RapidOCR
    root = Path(rapidocr.__file__).resolve().parent / 'models'
    paths = {'Det': root / 'PP-OCRv6_det_small.onnx',
             'Rec': root / 'PP-OCRv6_rec_small.onnx',
             'Cls': root / 'ch_ppocr_mobile_v2.0_cls_mobile.onnx'}
    for path in paths.values():
        if not path.is_file():
            raise FileNotFoundError(f'Local OCR model missing: {path.name}. Reinstall pinned OCR dependencies.')
    # Explicit local paths prevent automatic model downloads during terminal operation.
    return RapidOCR(params={**{f'{stage}.model_path': str(path) for stage, path in paths.items()},
                            'EngineConfig.onnxruntime.intra_op_num_threads': 1,
                            'EngineConfig.onnxruntime.inter_op_num_threads': 1,
                            'Global.log_level': 'error', 'Global.max_side_len': 960})


def sign_bounds(frame_shape, detection, config):
    """Shared source-image coordinates for both the OCR crop and its live overlay."""
    x1, y1, x2, y2 = detection['bbox']
    rx1, ry1, rx2, ry2 = config['sign_regions'][detection['vehicle_type']]
    height, width = frame_shape[:2]
    left = max(0, int(x1 + (x2 - x1) * rx1))
    right = min(width, int(x1 + (x2 - x1) * rx2))
    top = max(0, int(y1 + (y2 - y1) * ry1))
    bottom = min(height, int(y1 + (y2 - y1) * ry2))
    if right - left < 30 or bottom - top < 15:
        return None
    return left, top, right, bottom


def draw_sign_region(frame, detection, config, held=False):
    """Show the scan region; a held box is the last known position during occlusion."""
    import cv2
    bounds = sign_bounds(frame.shape, detection, config)
    if bounds is None:
        return
    left, top, right, bottom = bounds
    color = (0, 190, 255) if held else (255, 220, 0)
    label = 'OCR AREA - HOLD' if held else 'OCR SCAN AREA'
    cv2.rectangle(frame, (left, top), (right - 1, bottom - 1), color, 3)
    font, scale, thickness = cv2.FONT_HERSHEY_SIMPLEX, 0.65, 2
    (width, height), baseline = cv2.getTextSize(label, font, scale, thickness)
    label_x = max(0, min(left, frame.shape[1] - width - 12))
    label_y = max(height + baseline + 12, top)
    cv2.rectangle(frame, (label_x, label_y - height - baseline - 12),
                  (label_x + width + 12, label_y), color, -1)
    cv2.putText(frame, label, (label_x + 6, label_y - baseline - 6),
                font, scale, (20, 25, 30), thickness, cv2.LINE_AA)


def crop_sign(frame, detection, config):
    import cv2
    bounds = sign_bounds(frame.shape, detection, config)
    if bounds is None:
        return None
    left, top, right, bottom = bounds
    crop = frame[top:bottom, left:right]
    options = config.get('sign_preprocessing', {}).get(detection['vehicle_type'], {})
    stretch = options.get('vertical_stretch', 1)
    # Windshield signs are vertically compressed by the viewing angle. Calibrate per type;
    # this reshapes existing pixels, without guessing characters or changing route thresholds.
    scale = min(options.get('scale', 2), 960 / max(crop.shape[1], crop.shape[0] * stretch))
    return cv2.resize(crop, None, fx=scale, fy=scale * stretch, interpolation=cv2.INTER_CUBIC)


def read_sign(engine, image, minimum_score=0.65):
    result = engine(image)
    texts = result.txts if result.txts is not None else []
    scores = result.scores if result.scores is not None else []
    accepted = [(text, float(score)) for text, score in zip(texts, scores) if float(score) >= minimum_score]
    return (' '.join(text for text, _ in accepted), sum(score for _, score in accepted) / len(accepted)) if accepted else ('', 0.0)


class OCRWorker:
    def __init__(self, occupancy):
        self.occupancy = occupancy
        self.pending = OrderedDict()
        self.last_sample = {}
        self.condition = threading.Condition()
        self.state = 'Starting'
        self.error = None
        self.stopping = False
        self.thread = threading.Thread(target=self._run, name='route-ocr', daemon=True)

    def start(self):
        self.thread.start()

    def stop(self):
        with self.condition:
            self.stopping = True
            self.pending.clear()
            self.condition.notify_all()
        self.thread.join(timeout=2)

    def submit(self, bay, session_id, frame, detection):
        now = time.monotonic()
        with self.condition:
            if self.stopping or self.state == 'Failed':
                return
            previous_id, previous_time = self.last_sample.get(bay, (None, 0))
            if previous_id == session_id and now - previous_time < self.occupancy.config['sample_interval_seconds']:
                return
            self.last_sample[bay] = (session_id, now)
        image = crop_sign(frame, detection, self.occupancy.config)
        if image is None:
            return
        with self.condition:
            self.pending[bay] = (session_id, image)
            # One pending job per bay, maximum two: discard obsolete work instead of blocking YOLO.
            while len(self.pending) > 2:
                self.pending.popitem(last=False)
            self.condition.notify()

    def health(self):
        return {'state': self.state, 'message': self.error}

    def _run(self):
        try:
            if self.occupancy.config_error:
                raise ValueError(self.occupancy.config_error)
            engine = create_engine()
            self.state = 'Ready'
        except Exception as error:
            self.state, self.error = 'Failed', str(error)
            LOGGER.exception('Local OCR could not start; occupancy detection continues')
            return
        failures = 0
        while True:
            with self.condition:
                self.condition.wait_for(lambda: self.pending or self.stopping)
                if self.stopping:
                    return
                bay, (session_id, image) = self.pending.popitem(last=False)
            try:
                text, score = read_sign(engine, image, self.occupancy.config['minimum_ocr_score'])
                self.occupancy.apply_ocr(bay, session_id, text, score)
                failures = 0
            except Exception as error:
                failures += 1
                if failures >= 3:
                    self.state, self.error = 'Failed', str(error)
                    LOGGER.exception('Repeated OCR engine failure; occupancy detection continues')
                    return
