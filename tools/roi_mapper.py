"""Standalone ROI editor. No detector imports or automatic configuration activation.

JSON v1: source_video is relative to the repository root; source_width/height
describe the decoded image, frame_index is zero-based, and bays contain id,
direction and points. Points use x/width, y/height in perimeter order.
Run with --help for CLI options. All exports require an explicit S keypress.
"""
import argparse
import json
import math
import os
from pathlib import Path
import tempfile
from dataclasses import dataclass

import cv2
import numpy as np
from shapely.geometry import Point, Polygon

ROOT = Path(__file__).resolve().parents[1]
CONVENTION = 'x/width, y/height'
WINDOW = 'TerminalSight - standalone ROI mapper'
HEADER = 190


@dataclass(frozen=True)
class Transform:
    """Letterboxed image placement; mouse coordinates are canvas coordinates."""
    width: int
    height: int
    left: int
    top: int
    display_width: int
    display_height: int

    @classmethod
    def fit(cls, width, height, canvas_width, canvas_height, header=HEADER):
        available = max(1, canvas_height - header)
        scale = min(canvas_width / width, available / height)
        dw, dh = max(1, round(width * scale)), max(1, round(height * scale))
        return cls(width, height, (canvas_width - dw) // 2,
                   header + (available - dh) // 2, dw, dh)

    def to_source(self, x, y):
        if not (self.left <= x <= self.left + self.display_width and
                self.top <= y <= self.top + self.display_height):
            return None
        return [(x - self.left) * self.width / self.display_width,
                (y - self.top) * self.height / self.display_height]

    def to_display(self, point):
        return (round(self.left + point[0] * self.display_width / self.width),
                round(self.top + point[1] * self.display_height / self.height))


def validate_points(points):
    if not isinstance(points, list) or len(points) != 4:
        raise ValueError('A bay needs exactly four corners.')
    for point in points:
        if not isinstance(point, (list, tuple)) or len(point) != 2:
            raise ValueError('Each corner needs x and y.')
        if any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1 for v in point):
            raise ValueError('Normalized coordinates must be finite and within [0,1].')
    if len({tuple(p) for p in points}) != 4:
        raise ValueError('Corners must be distinct.')
    polygon = Polygon(points)
    if not polygon.is_valid or polygon.area <= 0:
        raise ValueError('Invalid polygon: check crossing edges or zero area.')
    return polygon


def validate_document(data):
    if not isinstance(data, dict) or data.get('schema_version') != 1:
        raise ValueError('Unsupported ROI schema.')
    if data.get('normalization') != CONVENTION:
        raise ValueError('Unsupported normalization convention.')
    for key in ('source_width', 'source_height'):
        if type(data.get(key)) is not int or data[key] <= 0:
            raise ValueError('Source dimensions must be positive integers.')
    if type(data.get('frame_index')) is not int or data['frame_index'] < 0:
        raise ValueError('Frame index must be a nonnegative integer.')
    if not isinstance(data.get('source_video'), str) or not data['source_video'] or Path(data['source_video']).is_absolute():
        raise ValueError('Source video must be a relative path.')
    bays = data.get('bays')
    if not isinstance(bays, list) or len(bays) > 10:
        raise ValueError('Expected at most ten bays.')
    seen = set()
    polygons = []
    for bay in bays:
        if not isinstance(bay, dict) or bay.get('id') not in {f'Bay_{n}' for n in range(1, 11)}:
            raise ValueError('Bay IDs must be Bay_1 through Bay_10.')
        if bay['id'] in seen:
            raise ValueError('Duplicate bay ID.')
        seen.add(bay['id'])
        if bay.get('direction') not in ('northbound', 'southbound'):
            raise ValueError('Invalid bay direction.')
        polygons.append((bay['id'], validate_points(bay.get('points'))))
    return [f'{a} overlaps {b}' for i, (a, p) in enumerate(polygons)
            for b, q in polygons[i + 1:] if p.intersection(q).area > 1e-10]


def pixel_points(bay, width, height):
    return [[x * width, y * height] for x, y in bay['points']]


def load_document(path):
    data = json.loads(Path(path).read_text(encoding='utf-8'))
    validate_document(data)
    return data


def save_document(path, data, overwrite=False):
    """Validate first; stage beside destination and atomically publish complete JSON."""
    validate_document(data)
    path = Path(path)
    if path.exists() and not overwrite:
        raise FileExistsError('Output exists; confirmation required.')
    path.parent.mkdir(parents=True, exist_ok=True)
    staged = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                         prefix='.roi-', suffix='.tmp', delete=False) as out:
            staged = Path(out.name)
            json.dump(data, out, indent=2, allow_nan=False)
            out.write('\n')
            out.flush()
            os.fsync(out.fileno())
        if overwrite:
            os.replace(staged, path)
        else:
            # Atomic no-clobber publication, including a competing new output file.
            os.link(staged, path)
    finally:
        if staged is not None:
            staged.unlink(missing_ok=True)


class Mapper:
    def __init__(self, cap, video, output, loaded=None):
        self.cap, self.output = cap, output
        count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        self.count = int(count) if math.isfinite(count) and count > 0 else 0
        self.timeline = None
        self.timeline_target = None
        self.frame = None
        self.index = 0
        self.seek(loaded['frame_index'] if loaded else 0)
        height, width = self.frame.shape[:2]
        self.data = dict(schema_version=1, source_video=Path(os.path.relpath(video, ROOT)).as_posix(),
                         source_width=width, source_height=height, frame_index=self.index,
                         normalization=CONVENTION, bays=loaded['bays'] if loaded else [])
        self.selected = None
        self.bay_id = 'Bay_1'
        self.direction = 'northbound'
        self.drawing = False
        self.draft = []
        self.drag = None
        self.transform = None
        self.dirty = False
        self.pending = None
        self.message = 'Choose a bay number, press N, then click four corners. S exports only.'

    def seek(self, index):
        index = max(0, min(index, self.count - 1)) if self.count > 0 else max(0, index)
        if self.cap.set(cv2.CAP_PROP_POS_FRAMES, index) is False:
            raise ValueError('This video cannot seek to that frame.')
        ok, frame = self.cap.read()
        if not ok:
            raise ValueError('Cannot decode requested frame. Try an earlier frame.')
        if self.frame is not None and frame.shape != self.frame.shape:
            raise ValueError('Video dimensions changed; use a fixed-resolution recording.')
        position = self.cap.get(cv2.CAP_PROP_POS_FRAMES)
        if not math.isfinite(position) or position < 1:
            raise ValueError('Decoder cannot report a reliable frame position.')
        self.frame = frame
        self.index = max(0, int(round(position)) - 1)
        if hasattr(self, 'data'):
            self.data['frame_index'] = self.index
            self.dirty = True

    def normalized(self, points):
        return [[x / self.data['source_width'], y / self.data['source_height']] for x, y in points]

    def mouse(self, event, x, y, flags, _):
        if self.pending or self.transform is None:
            return
        if self.timeline and not self.drag:
            left, right, top = self.timeline
            target = round(min(1, max(0, (x - left) / (right - left))) * max(0, self.count - 1))
            if event == cv2.EVENT_LBUTTONDOWN and abs(y - top) <= 12 and left <= x <= right and self.count > 1:
                self.timeline_target = target
                return
            if self.timeline_target is not None:
                self.timeline_target = target
                if event == cv2.EVENT_LBUTTONUP:
                    self.timeline_target = None
                    try:
                        self.seek(target)  # Decode once on release, never for drag motion.
                        self.message = 'Paused frame loaded. All bay polygons are retained.'
                    except (ValueError, cv2.error) as exc:
                        self.message = str(exc)
                return
        point = self.transform.to_source(x, y)
        if event == cv2.EVENT_LBUTTONUP and self.drag:
            bay, corner, original = self.drag
            try:
                validate_points(bay['points'])
                self.dirty = True
                self.message = 'Corner updated. S to save.'
            except ValueError as exc:
                bay['points'][corner] = original
                self.message = str(exc) + ' Edit reverted.'
            self.drag = None
        elif event == cv2.EVENT_MOUSEMOVE and self.drag and point is not None:
            bay, corner, _ = self.drag
            bay['points'][corner] = self.normalized([point])[0]
        elif event == cv2.EVENT_LBUTTONDOWN and point is not None:
            if self.drawing:
                candidate = self.draft + [point]
                if len(candidate) == 4:
                    try:
                        normalized = self.normalized(candidate)
                        validate_points(normalized)
                        bay = dict(id=self.bay_id, direction=self.direction, points=normalized)
                        self.data['bays'].append(bay)
                        self.selected = bay
                        self.draft, self.drawing, self.dirty = [], False, True
                        self.message = 'Bay added. Choose another number then N, or S to save.'
                    except ValueError as exc:
                        self.message = str(exc) + ' Undo with U or choose another fourth corner.'
                else:
                    self.draft = candidate
            else:
                # Handles take priority over polygon interiors; selected bay first.
                ordered = sorted(self.data['bays'], key=lambda b: b is not self.selected)
                for bay in ordered:
                    for i, p in enumerate(pixel_points(bay, self.data['source_width'], self.data['source_height'])):
                        px, py = self.transform.to_display(p)
                        if math.hypot(px - x, py - y) <= 12:
                            self.selected = bay
                            self.drag = (bay, i, bay['points'][i][:])
                            return
                self.selected = next((b for b in reversed(self.data['bays'])
                                      if Polygon(b['points']).covers(Point(self.normalized([point])[0]))), None)

    def save(self, overwrite=False):
        if self.draft or self.drag:
            self.message = 'Finish or cancel the current drawing/edit before saving.'
            return
        if self.output.exists() and not overwrite:
            self.pending = 'save'
            self.message = 'Overwrite existing JSON? Y confirms; any other key cancels.'
            return
        save_document(self.output, self.data, overwrite)
        self.dirty = False
        self.message = 'Saved JSON. Existing detection is unchanged.'

    def key(self, key):
        if key < 0:
            return True
        if self.drag or self.timeline_target is not None:
            return True  # Finish the mouse edit before changing selection or exporting.
        char = chr(key & 255).lower()
        if self.pending:
            action, self.pending = self.pending, None
            if char == 'y':
                if action == 'quit':
                    return False
                self.save(overwrite=True)
            else:
                self.message = 'Cancelled.'
            return True
        if char == 'q' or key == 27:
            if self.dirty or self.draft:
                self.pending = 'quit'
                self.message = 'Discard unsaved work and quit? Y confirms; any other key cancels.'
            else:
                return False
        elif char in '1234567890':
            self.bay_id = f'Bay_{10 if char == "0" else int(char)}'
            self.direction = 'northbound' if self.bay_id in {f'Bay_{n}' for n in range(1, 6)} else 'southbound'
            self.selected = next((b for b in self.data['bays'] if b['id'] == self.bay_id), None)
            self.draft, self.drawing = [], False
        elif char == 'n':
            if any(b['id'] == self.bay_id for b in self.data['bays']):
                self.message = 'Bay ID already exists. Drag its corners or choose an unused ID.'
            else:
                self.draft, self.drawing, self.selected = [], True, None
        elif char == 'b':
            if self.selected is not None:
                self.selected['direction'] = 'southbound' if self.selected['direction'] == 'northbound' else 'northbound'
                self.dirty = True
            else:
                self.direction = 'southbound' if self.direction == 'northbound' else 'northbound'
        elif char == 'u':
            self.draft = self.draft[:-1]
        elif char == 'c':
            self.draft, self.drawing = [], False
        elif char == 'd' and self.selected is not None:
            self.data['bays'].remove(self.selected)
            self.selected, self.dirty = None, True
        elif char == 's':
            self.save()
        elif char in ',.[]':
            if self.drag:
                return True
            self.seek(self.index + {',': -1, '.': 1, '[': -30, ']': 30}[char])
            self.data['frame_index'] = self.index
            self.dirty = True
        return True

    def render(self, width, height):
        canvas = np.full((height, width, 3), (30, 35, 30), dtype=np.uint8)
        t = Transform.fit(self.data['source_width'], self.data['source_height'], width, height)
        self.transform = t
        canvas[t.top:t.top + t.display_height, t.left:t.left + t.display_width] = cv2.resize(
            self.frame, (t.display_width, t.display_height))
        for bay in self.data['bays']:
            points = [t.to_display(p) for p in pixel_points(bay, t.width, t.height)]
            color = (0, 220, 255) if bay is self.selected else (90, 230, 110)
            cv2.polylines(canvas, [np.array(points, np.int32)], True, color, 2)
            for i, p in enumerate(points):
                cv2.circle(canvas, p, 6, color, -1)
                cv2.putText(canvas, str(i + 1), (p[0] + 8, p[1] + 14), cv2.FONT_HERSHEY_SIMPLEX, .5, color, 2)
            cv2.putText(canvas, bay['id'] + ' ' + bay['direction'], points[0], cv2.FONT_HERSHEY_SIMPLEX, .5, color, 2)
        for i, p in enumerate(self.draft):
            cv2.circle(canvas, t.to_display(p), 6, (255, 220, 0), -1)
            cv2.putText(canvas, str(i + 1), t.to_display(p), cv2.FONT_HERSHEY_SIMPLEX, .6, (255, 255, 255), 2)
        if len(self.draft) > 1:
            cv2.polylines(canvas, [np.array([t.to_display(p) for p in self.draft], np.int32)], False, (255, 220, 0), 2)
        warnings = [] if self.drag else validate_document(self.data)
        lines = [f'Frame {self.index} / {max(0, self.count - 1)} | {self.bay_id} {self.direction} | '
                 + ('DRAWING' if self.drawing else 'SELECT / EDIT') + (' | UNSAVED' if self.dirty or self.draft else ''),
                 '1-9 / 0: bay ID (0=10) | N: new | B: direction | Click: select | Drag: corner',
                 ', / .: -/+1 frame | [ / ]: -/+30 | U: undo drawing | C: cancel drawing | D: delete',
                 'S: save JSON | Q / Esc: quit | No changes to detection or video files',
                 self.message, 'WARNING: ' + '; '.join(warnings) if warnings else '']
        for i, line in enumerate(lines):
            cv2.putText(canvas, line, (10, 21 + i * 24), cv2.FONT_HERSHEY_SIMPLEX, .48,
                        (80, 200, 255) if i >= 4 else (240, 240, 240), 1, cv2.LINE_AA)
        self.timeline = (16, max(17, width - 16), 174)
        left, right, top = self.timeline
        cv2.line(canvas, (left, top), (right, top), (110, 120, 110), 3)
        target = self.index if self.timeline_target is None else self.timeline_target
        thumb = round(left + (right - left) * target / max(1, self.count - 1))
        cv2.circle(canvas, (min(right, thumb), top), 7, (100, 220, 140), -1)
        label = f'Paused | Drag timeline, release to seek: {target}' if self.count > 1 else 'Frame count unavailable: use , . [ ] to seek'
        cv2.putText(canvas, label, (10, 158), cv2.FONT_HERSHEY_SIMPLEX, .43, (240, 240, 240), 1)
        return canvas


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--load', type=Path)
    parser.add_argument('--allow-source-change', action='store_true',
                        help='Explicitly reuse normalized ROIs on another video/resolution; verify alignment.')
    args = parser.parse_args()
    cap = None
    try:
        video, output = args.video.resolve(), args.output.resolve()
        if output.suffix.lower() != '.json' or output == video:
            raise ValueError('Output must be a separate .json file.')
        loaded = load_document(args.load) if args.load else None
        if loaded and (ROOT / loaded['source_video']).resolve() != video and not args.allow_source_change:
            raise ValueError('Different source video. Use --allow-source-change only after checking viewpoint.')
        cap = cv2.VideoCapture(str(video))
        if not cap.isOpened():
            raise ValueError('Cannot open video. Check the path and codec.')
        mapper = Mapper(cap, video, output, loaded)
        if loaded and (loaded['source_width'], loaded['source_height']) != (
                mapper.data['source_width'], mapper.data['source_height']) and not args.allow_source_change:
            raise ValueError('Source dimensions changed. Explicit --allow-source-change is required.')
        if loaded and args.allow_source_change:
            mapper.dirty = True
            mapper.message = 'Reused normalized ROIs: verify viewpoint, crop and all corners before saving.'
        screen_width, screen_height = 1366, 768
        if os.name == 'nt':
            import ctypes
            ctypes.windll.user32.SetProcessDPIAware()
            screen_width = ctypes.windll.user32.GetSystemMetrics(0)
            screen_height = ctypes.windll.user32.GetSystemMetrics(1)
        width, height = min(1400, screen_width - 80), min(900, screen_height - 140)
        cv2.namedWindow(WINDOW, cv2.WINDOW_NORMAL | cv2.WINDOW_FREERATIO)
        cv2.resizeWindow(WINDOW, width, height)
        cv2.setMouseCallback(WINDOW, mapper.mouse)
        cv2.imshow(WINDOW, mapper.render(width, height))
        while cv2.getWindowProperty(WINDOW, cv2.WND_PROP_VISIBLE) >= 1:
            try:
                _, _, w, h = cv2.getWindowImageRect(WINDOW)
                if w >= 320 and h > HEADER + 20:
                    width, height = w, h
                else:
                    cv2.resizeWindow(WINDOW, width, height)
                cv2.imshow(WINDOW, mapper.render(width, height))
                if not mapper.key(cv2.waitKeyEx(30)):
                    break
            except (ValueError, OSError) as exc:
                mapper.message = str(exc)
        return 0
    except (ValueError, OSError, cv2.error) as exc:
        print(f'ROI mapper: {exc}')
        return 1
    finally:
        if cap is not None:
            cap.release()
        cv2.destroyAllWindows()


if __name__ == '__main__':
    raise SystemExit(main())
