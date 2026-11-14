"""Shared fixed-512 YOLO letterboxing and class-wise NMS; no inference backend."""
import cv2
import numpy as np


def predict_details(frame, infer, names):
    height, width = frame.shape[:2]
    scale = min(512 / width, 512 / height)
    resized = cv2.resize(frame, (round(width * scale), round(height * scale)))
    dh, dw = 512 - resized.shape[0], 512 - resized.shape[1]
    top, left = round(dh / 2 - .1), round(dw / 2 - .1)
    padded = cv2.copyMakeBorder(resized, top, dh - top, left, dw - left,
                                cv2.BORDER_CONSTANT, value=(114, 114, 114))
    tensor = np.ascontiguousarray(padded[:, :, ::-1].transpose(2, 0, 1)[None], dtype=np.float32) / 255
    raw = infer(tensor)
    if raw.shape != (1, 6, 5376):
        raise ValueError(f'Unexpected YOLO output: {raw.shape}')
    rows = raw[0].T
    labels = rows[:, 4:].argmax(axis=1)
    scores = rows[:, 4:].max(axis=1)
    detections = []
    for label in names:
        selected = rows[(labels == label) & (scores >= .5)]
        if not len(selected):
            continue
        confidence = selected[:, 4 + label]
        boxes = selected[:, :4].copy()
        boxes[:, :2] -= boxes[:, 2:] / 2
        indices = cv2.dnn.NMSBoxes(boxes.tolist(), confidence.tolist(), .5, .45)
        for index in np.asarray(indices).reshape(-1):
            x, y, w, h = boxes[index]
            bbox = [int(np.clip((x - left) / scale, 0, width)),
                    int(np.clip((y - top) / scale, 0, height)),
                    int(np.clip((x + w - left) / scale, 0, width)),
                    int(np.clip((y + h - top) / scale, 0, height))]
            score = float(confidence[index])
            detections.append(dict(label=names[label], confidence=score, bbox=bbox))
    return [dict(bbox=item['bbox'], vehicle_type='Bus' if item['label'] == 'bus' else 'UV Express',
                 class_name=item['label'], class_id=0 if item['label'] == 'bus' else 1,
                 confidence=item['confidence']) for item in detections]
