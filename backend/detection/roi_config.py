"""Validated, cached camera geometry. No model, server or operational state imports."""
from dataclasses import dataclass
from functools import lru_cache
import json
from pathlib import Path
from types import MappingProxyType

import numpy as np
from shapely.geometry import Polygon
from tools.roi_mapper import validate_document, pixel_points


@dataclass(frozen=True)
class PreparedRoi:
    width: int
    height: int
    polygons: object
    arrays: object
    directions: object
    normalized: object
    warnings: tuple

    def overlay(self):
        return dict(width=self.width, height=self.height, normalization='x/width, y/height',
                    polygons=[dict(id=key, direction=self.directions[key], points=[list(p) for p in points])
                              for key, points in self.normalized.items()])


@lru_cache(maxsize=32)
def _prepare(text, video, root, width, height):
    try:
        data = json.loads(text)
        warnings = validate_document(data)
    except (ValueError, TypeError, KeyError) as exc:
        raise ValueError('Invalid saved ROI configuration.') from exc
    if type(data['schema_version']) is not int or not data['bays']:
        raise ValueError('Expected schema version 1 and at least one parking bay.')
    source = (Path(root) / data['source_video']).resolve()
    if not source.is_relative_to(Path(root)) or source != Path(video):
        raise ValueError('ROI belongs to a different recording.')
    if (data['source_width'], data['source_height']) != (width, height):
        raise ValueError('ROI dimensions do not match the decoded recording.')
    polygons, arrays, directions, normalized = {}, {}, {}, {}
    for bay in data['bays']:
        key = bay['id']
        expected = 'northbound' if int(key[4:]) <= 5 else 'southbound'
        if bay['direction'] != expected:
            raise ValueError('Bay number and terminal direction do not match.')
        points = pixel_points(bay, width, height)
        polygons[key] = Polygon(points)
        arrays[key] = np.array(points, np.int32)
        arrays[key].setflags(write=False)
        directions[key] = bay['direction']
        normalized[key] = tuple(tuple(p) for p in bay['points'])
    return PreparedRoi(width, height, MappingProxyType(polygons), MappingProxyType(arrays),
                       MappingProxyType(directions), MappingProxyType(normalized), tuple(warnings))


def load_roi(path, video, width, height, *, root):
    """Prepare a candidate without mutating an active configuration; preserve JSON order.

    Content keys invalidate cached geometry even if a file is replaced in place.
    Callers keep the returned snapshot for a session and explicitly load replacements.
    """
    path, video, root = Path(path).absolute(), Path(video).absolute(), Path(root).resolve()
    if any(p.resolve() != p or not p.is_file() for p in (path, video)):
        raise ValueError('ROI or recording is missing or redirected.')
    if not path.is_relative_to(root / 'config' / 'roi') or not video.is_relative_to(root / 'public'):
        raise ValueError('ROI or video is outside the allowed project directories.')
    if path.stat().st_size > 65536:
        raise ValueError('ROI JSON is too large.')
    if type(width) is not int or type(height) is not int or min(width, height) <= 0:
        raise ValueError('Decoded dimensions must be positive integers.')
    return _prepare(path.read_text(encoding='utf-8'), str(video), str(root), width, height)
