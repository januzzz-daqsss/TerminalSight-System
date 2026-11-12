"""Local recording-to-geometry selection. No inference or operational state writes."""
from functools import lru_cache
from pathlib import Path
import cv2

from backend.detection.roi_config import load_roi
from backend.cameras.sample_ai import MAPPINGS


@lru_cache(maxsize=32)
def _dimensions(path, size, modified):
    cap = cv2.VideoCapture(path)
    try:
        ok, frame = cap.read()
        if not ok or frame is None:
            raise ValueError('Cannot decode the recording to validate its ROI dimensions.')
        return int(frame.shape[1]), int(frame.shape[0])
    finally:
        cap.release()


def mapping(root, video_id, roi_id):
    root = Path(root).resolve()
    if (not isinstance(roi_id, str) or not roi_id or Path(roi_id).name != roi_id
            or '/' in roi_id or '\\' in roi_id or Path(roi_id).suffix.lower() != '.json'):
        raise ValueError('Choose an ROI JSON from the mapping list.')
    video = root / 'public' / video_id
    roi = root / 'config' / 'roi' / roi_id
    if (not video.is_file() or video.resolve() != video.absolute()
            or not video.resolve().is_relative_to(root / 'public')
            or not roi.is_file() or roi.resolve() != roi.absolute()):
        raise ValueError('Recording or ROI mapping is missing or redirected.')
    stat = video.stat()
    width, height = _dimensions(str(video), stat.st_size, stat.st_mtime_ns)
    prepared = load_roi(roi, video, width, height, root=root)
    directions = set(prepared.directions.values())
    if len(directions) != 1:
        raise ValueError('A feed mapping must use one terminal direction.')
    return dict(id=roi_id, bays=sorted(int(key[4:]) for key in prepared.polygons),
                direction=next(iter(directions)), roi=prepared.overlay(), warnings=list(prepared.warnings))


def compatible_mappings(root, video_id):
    result, rejected = [], 0
    for path in sorted((Path(root) / 'config' / 'roi').glob('*.json')):
        try:
            result.append(mapping(root, video_id, path.name))
        except (ValueError, OSError, TypeError, KeyError, cv2.error):
            rejected += 1
    return result, rejected


def describe_feed(root, feed):
    """Missing/changed JSON never prevents ordinary playback or rewrites saved rows."""
    if feed['kind'] != 'sample':
        return feed
    original = MAPPINGS.get(feed['videoId'])
    roi_id = feed.get('roiId', Path(original[0]).name if original else '')
    if not roi_id:
        return {**feed, 'roiStatus': 'none', 'roiMapping': None, 'legacyAiCompatible': False, 'integratedAiCompatible': False}
    try:
        selected = mapping(root, feed['videoId'], roi_id)
        if 'roiId' in feed:
            validate_labels(feed, selected)
        compatible = bool(original and {bay['id'] for bay in selected['roi']['polygons']} == set(original[1])
                      and selected['direction'] == original[2])
        legacy = bool(compatible and roi_id == Path(original[0]).name)
        return {**feed, 'roiStatus': 'valid', 'roiMapping': selected, 'legacyAiCompatible': legacy, 'integratedAiCompatible': compatible}
    except (ValueError, OSError, TypeError, KeyError, cv2.error):
        return {**feed, 'roiStatus': 'invalid', 'roiMapping': None, 'legacyAiCompatible': False, 'integratedAiCompatible': False}


def validate_labels(feed, selected):
    if feed['direction'] != selected['direction'] or sorted(feed['bays']) != selected['bays']:
        raise ValueError('Feed direction and bay labels must match the selected ROI mapping.')
