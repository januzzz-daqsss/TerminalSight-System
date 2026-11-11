"""Read-only YOLO ROI diagnostic, independent of operational camera workers.

Default assignment matches detector.py: visit bays in JSON order, take the highest IoA
unused vehicle >= the operational threshold, ties favor detection order. Each
bay and vehicle has at most one assignment. This is order-dependent, not a global
optimal matching. All competing qualifying overlaps are reported before matching.
Opt-in ground/compare modes add conservative global matching and video-time
hysteresis. None of these states are operational occupancy sessions/timers.
"""
import argparse
import math
import os
from pathlib import Path
import sys
import time
import tempfile

sys.dont_write_bytecode = True

# Permit direct `python tools/roi_detection_test.py` without installation.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import cv2
import numpy as np
from shapely.geometry import Point, Polygon, box
from tools.roi_mapper import load_document, pixel_points, validate_document

WINDOW = 'TerminalSight ROI detection - diagnostic only'
SCRATCH = None


def scratch_path(value):
    if SCRATCH is None or not isinstance(value, (str, bytes, os.PathLike)):
        return False
    try:
        Path(os.fsdecode(value)).resolve().relative_to(SCRATCH)
        return True
    except (ValueError, OSError):
        return False


def read_only_audit(event, args):
    """CLI-only guard: refuse Python-level file writes and outbound connections.

This is a defense against accidental library output, not an OS security sandbox.
No hook is installed merely by importing this module.
"""
    if event == 'open':
        path, mode, flags = args
        if (mode and any(c in mode for c in 'wax+')) or (
                flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND)):
            if scratch_path(path) or isinstance(path, int):
                return  # fd wrappers follow an already checked file creation.
            raise PermissionError('Read-only tester blocked a file write.')
    if event == 'os.mkdir' and not Path(args[0]).is_dir():
        if scratch_path(args[0]):
            return
        raise PermissionError('Read-only tester blocked directory creation.')
    if event in {'os.remove', 'os.rmdir', 'os.rename', 'os.link', 'os.symlink',
                 'os.truncate', 'sqlite3.connect', 'socket.connect'}:
        paths = args[:2] if event in {'os.rename', 'os.link', 'os.symlink'} else args[:1]
        if event not in {'sqlite3.connect', 'socket.connect'} and all(scratch_path(p) for p in paths):
            return
        raise PermissionError(f'Read-only tester blocked {event}.')


def prepare_rois(data, video, width, height):
    warnings = validate_document(data)
    if (ROOT / data['source_video']).resolve() != Path(video).resolve():
        raise ValueError('ROI source_video does not match --video.')
    if not data['bays']:
        raise ValueError('ROI file contains no bays.')
    if (data['source_width'], data['source_height']) != (width, height):
        raise ValueError('Decoded video dimensions differ from ROI source dimensions; revalidate the mapping first.')
    return {b['id']: Polygon(pixel_points(b, width, height)) for b in data['bays']}, warnings


def assign_vehicles(polygons, detections, threshold):
    vehicles = []
    for detection in detections:
        coords = detection['bbox']
        if len(coords) != 4 or not all(math.isfinite(v) for v in coords):
            raise ValueError('Detector returned invalid box coordinates.')
        x1, y1, x2, y2 = map(int, coords)  # Same integer conversion as detector.py.
        if x2 <= x1 or y2 <= y1:
            vehicles.append(Polygon())
        else:
            vehicles.append(box(x1, y1, x2, y2))
    scores = {name: [v.intersection(p).area / p.area for v in vehicles]
              for name, p in polygons.items()}
    ambiguous = []
    for i in range(len(vehicles)):
        candidates = [name for name, row in scores.items() if row[i] >= threshold]
        if len(candidates) > 1:
            ambiguous.append(f'vehicle {i}: qualifies for {", ".join(candidates)}')
    used, assignments = set(), {}
    for name, row in scores.items():
        candidates = [i for i, score in enumerate(row) if score >= threshold and i not in used]
        if sum(score >= threshold for score in row) > 1:
            ambiguous.append(f'{name}: multiple qualifying vehicles')
        if candidates:
            chosen = max(candidates, key=lambda i: row[i])
            assignments[name] = chosen
            used.add(chosen)
    return assignments, scores, ambiguous


def vehicle_mapping(name):
    """Exactly the operational YOLO name mapping; never infer a van from 'car'."""
    return {'bus': 'Bus', 'uv': 'UV Express'}.get(name.lower())


def ground_point(detection):
    x1, _, x2, y2 = detection['bbox']
    return ((x1 + x2) / 2, y2)


def optimal_matching(names, edges, vehicle_count, forbidden=None):
    """Exact DP over <=10 bay bits: maximum cardinality, then total IoA.

    Sorted bay IDs and detection indices make ties deterministic. An unmatched
    option always exists. Called again with edges forbidden to measure ambiguity.
    """
    dp = {0: (0.0, {})}
    for vehicle in range(vehicle_count):
        nxt = dict(dp)
        for mask, (score, assignment) in dp.items():
            for j, name in enumerate(names):
                edge = (name, vehicle)
                if mask & (1 << j) or edge not in edges or edge == forbidden:
                    continue
                value = score + 11 + edges[edge]
                newmask = mask | (1 << j)
                if newmask not in nxt or value > nxt[newmask][0]:
                    nxt[newmask] = (value, {**assignment, name: vehicle})
        dp = nxt
    return max(dp.values(), key=lambda item: item[0])


def ground_assign(polygons, detections, threshold=.20, tolerance=4., margin=.05, frame_height=None):
    """Bottom-center containment is mandatory; IoA alone cannot occupy a bay.

    Tolerance is Euclidean distance in original source pixels. A cropped bottom
    is explicitly uncertain. Near-equivalent global solutions abstain rather
    than assigning a vehicle by bay ordering. No tracking IDs are claimed.
    """
    _, scores, _ = assign_vehicles(polygons, detections, threshold)
    edges, reasons, uncertain = {}, [], set()
    for name, polygon in polygons.items():
        for i, detection in enumerate(detections):
            p = Point(ground_point(detection))
            overlap = scores[name][i]
            distance = polygon.distance(p)
            if distance > tolerance:
                reason = f'REJECT ground point outside tolerance ({distance:.1f}px)'
            elif frame_height is not None and detection['bbox'][3] >= frame_height - 1:
                reason = 'UNCERTAIN bottom cropped at frame edge'
                uncertain.add(name)
            elif overlap < threshold:
                reason = 'UNCERTAIN ground point near bay but insufficient overlap'
                uncertain.add(name)
            else:
                edges[(name, i)] = overlap
                reason = 'CANDIDATE ground containment + overlap'
            reasons.append(f'{name} vehicle={i} IoA={overlap:.4f}: {reason}')
    names = sorted(polygons)
    best_score, assignments = optimal_matching(names, edges, len(detections))
    accepted = dict(assignments)
    for name, i in assignments.items():
        other_score, _ = optimal_matching(names, edges, len(detections), (name, i))
        if best_score - other_score <= margin + 1e-9:
            accepted.pop(name)
            uncertain.add(name)
            reasons.append(f'{name} vehicle={i}: AMBIGUOUS alternative global match within {margin:g}')
    for name, i in edges:
        if accepted.get(name) != i:
            if name not in accepted:
                uncertain.add(name)
            reasons.append(f'{name} vehicle={i}: NOT ASSIGNED (global competition or ambiguity)')
    states = {name: 'OCCUPIED' if name in accepted else 'AMBIGUOUS' if name in uncertain else 'AVAILABLE'
              for name in names}
    for i in range(len(detections)):
        if i not in accepted.values():
            reasons.append(f'vehicle={i}: UNASSIGNED; no unique supported bay')
    return accepted, states, reasons


class Stabilizer:
    """Consecutive evidence in video time, independent of playback/wall-clock speed.

    Starts UNKNOWN; every state (including AMBIGUOUS) requires the hold duration.
    Any non-consecutive index resets history, including backward seek/restart.
    """
    def __init__(self, seconds=.3):
        self.seconds = seconds
        self.reset()

    def reset(self):
        self.last = None
        self.stable, self.pending = {}, {}

    def update(self, states, index, fps):
        if self.last is not None and index != self.last + 1:
            self.reset()
        self.last = index
        for name, state in states.items():
            self.stable.setdefault(name, 'UNKNOWN')
            if self.pending.get(name, (None,))[0] != state:
                self.pending[name] = (state, index)
            if (index - self.pending[name][1]) / fps + 1e-9 >= self.seconds:
                self.stable[name] = state
        return dict(self.stable)


class YoloDetector:
    def __init__(self, device):
        # Explicit standalone adapter; never initialize/switch the shared runtime.
        from backend.detection.detection_runtime import Adapter
        from backend.detection.detector import OCCUPANCY_THRESHOLD
        import torch
        if device == 'cuda' and not (torch.cuda.is_available() and torch.version.hip is None):
            raise ValueError('CUDA is unavailable. Use --device cpu.')
        self.adapter = Adapter('yolov8', device)
        self.threshold = OCCUPANCY_THRESHOLD
        print('Loaded YOLO class map:', self.adapter.model.names)

    def predict(self, frame):
        # Adapter.predict intentionally drops confidence. Reuse its loaded YOLO
        # model and exact confidence/class filtering, retaining the raw score.
        result = self.adapter.model(frame, conf=.5, verbose=False, device=self.adapter.device,
                                    save=False, save_txt=False, save_crop=False, show=False)[0]
        detections = []
        for b in result.boxes:
            class_id = int(b.cls.item())
            name = str(result.names[class_id])
            mapped = vehicle_mapping(name)
            if mapped:
                detections.append(dict(bbox=b.xyxy[0].cpu().tolist(), confidence=float(b.conf.item()),
                                       class_id=class_id, class_name=name, vehicle_type=mapped))
        return detections

    def close(self):
        self.adapter.close()


def report(index, polygons, detections, threshold, previous):
    assignments, scores, ambiguous = assign_vehicles(polygons, detections, threshold)
    states = {}
    for name, row in scores.items():
        state = 'OCCUPIED' if name in assignments else 'AVAILABLE'
        states[name] = state
        assigned = assignments.get(name)
        assigned_score = row[assigned] if assigned is not None else 0
        print(f'frame={index} {name} max_IoA={max(row, default=0):.4f} '
              f'assigned_IoA={assigned_score:.4f} vehicle={assigned} {state}', flush=True)
        if previous.get(name) != state:
            print(f'  TRANSITION {name}: {previous.get(name, "INITIAL")} -> {state}', flush=True)
    for warning in ambiguous:
        print('  AMBIGUOUS: ' + warning, flush=True)
    return states, scores


def overlay(frame, polygons, detections, states, index, fps, paused, speed, stable=None, method='ioa'):
    image = frame.copy()
    for d in detections:
        x1, y1, x2, y2 = map(int, d['bbox'])
        cv2.rectangle(image, (x1, y1), (x2, y2), (255, 200, 0), 3)
        cv2.putText(image, f'raw {d.get("class_id", "?")}:{d.get("class_name", "?")} '
                    f'{d["confidence"]:.2f} -> {d["vehicle_type"]}',
                    (max(0, x1), max(25, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, .8, (255, 200, 0), 2)
        gp = tuple(round(v) for v in ground_point(d))
        cv2.drawMarker(image, gp, (0, 255, 255), cv2.MARKER_CROSS, 20, 3)
    for name, poly in polygons.items():
        pts = np.array(poly.exterior.coords[:-1], np.int32)
        color = ((0, 0, 255) if states[name] == 'OCCUPIED' else
                 (0, 200, 255) if states[name] == 'AMBIGUOUS' else (0, 230, 80))
        cv2.polylines(image, [pts], True, color, 3)
        label = f'{name}: I={states[name]}' + (f' S={stable[name]}' if stable else '')
        cv2.putText(image, label, tuple(pts.mean(axis=0).astype(int)),
                    cv2.FONT_HERSHEY_SIMPLEX, .7, color, 2)
    # Fit inside a resizable keep-aspect-ratio window; no mouse-coordinate input.
    scale = min(1200 / image.shape[1], 680 / image.shape[0], 1)
    image = cv2.resize(image, (round(image.shape[1] * scale), round(image.shape[0] * scale)))
    canvas = cv2.copyMakeBorder(image, 92, 0, 0, 0, cv2.BORDER_CONSTANT)
    cv2.putText(canvas, f'Frame {index} | processing {fps:.1f} FPS | target {speed:g}x | '
                + ('PAUSED' if paused else 'PLAYING'), (10, 23), cv2.FONT_HERSHEY_SIMPLEX, .55, (255, 255, 255), 1)
    cv2.putText(canvas, 'Space: pause | .: step | +/-: speed | [/]: seek 30 | R: restart | T: compare | Q: quit',
                (10, 49), cv2.FONT_HERSHEY_SIMPLEX, .48, (255, 255, 255), 1)
    cv2.putText(canvas, f'{method} | I=instantaneous S=stabilized | yellow cross: approximate ground point',
                (10, 75), cv2.FONT_HERSHEY_SIMPLEX, .48, (255, 255, 255), 1)
    return canvas


def main(argv=None):
    global SCRATCH
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video', type=Path, required=True)
    parser.add_argument('--roi', type=Path, required=True)
    parser.add_argument('--device', choices=['cpu', 'cuda'], default='cpu',
                        help='CPU default. CUDA requires compatible PyTorch/GPU; DirectML is not supported here.')
    parser.add_argument('--headless', action='store_true', help='Terminal diagnostics without a GUI.')
    parser.add_argument('--max-frames', type=int, help='Stop after this many processed frames (useful for smoke tests).')
    parser.add_argument('--assignment-mode', choices=['ioa', 'ground', 'compare'], default='ioa',
                        help='ioa preserves the original greedy baseline; compare computes both on identical detections.')
    parser.add_argument('--ground-tolerance', type=float, default=4., help='Boundary tolerance in source pixels (0-20).')
    parser.add_argument('--ambiguity-margin', type=float, default=.05, help='Near-tie global IoA score margin (0-1).')
    parser.add_argument('--hold-seconds', type=float, default=.3, help='Consecutive video-time evidence, experimental modes only.')
    args = parser.parse_args(argv)
    if args.max_frames is not None and args.max_frames < 1:
        parser.error('--max-frames must be positive')
    for value, limit, name in [(args.ground_tolerance, 20, 'ground-tolerance'),
                               (args.ambiguity_margin, 1, 'ambiguity-margin'), (args.hold_seconds, 5, 'hold-seconds')]:
        if not math.isfinite(value) or not 0 <= value <= limit:
            parser.error(f'--{name} must be finite and between 0 and {limit}')
    sys.dont_write_bytecode = True
    os.environ['YOLO_OFFLINE'] = 'true'
    os.environ['YOLO_AUTOINSTALL'] = 'false'
    # PyTorch/Ultralytics require scratch/settings files. Confine these to an
    # automatically removed OS temporary directory, never the project or user settings.
    scratch = tempfile.TemporaryDirectory(prefix='terminalsight-roi-test-')
    SCRATCH = Path(scratch.name).resolve()
    tempfile.tempdir = str(SCRATCH)
    os.environ['YOLO_CONFIG_DIR'] = str(SCRATCH)
    sys.addaudithook(read_only_audit)
    cap = detector = None
    gui = False
    try:
        data = load_document(args.roi)
        cap = cv2.VideoCapture(str(args.video.resolve()))
        if not cap.isOpened():
            raise ValueError('Cannot open video; check path and installed codecs.')
        ok, frame = cap.read()
        if not ok:
            raise ValueError('Cannot decode the first video frame.')
        height, width = frame.shape[:2]
        polygons, warnings = prepare_rois(data, args.video, width, height)
        for warning in warnings:
            print('ROI WARNING:', warning)
        print('Baseline: JSON bay order, best unused IoA >= 0.20. '
              'Experimental ground mode: global one-to-one, abstain on near ties; no operational effects.')
        detector = YoloDetector(args.device)
        source_fps = cap.get(cv2.CAP_PROP_FPS)
        if not math.isfinite(source_fps) or source_fps <= 0:
            source_fps = 25
            print('Unknown source FPS; using 25 FPS for pacing.')
        count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        index, processed, states, speed, paused = 0, 0, {}, 1.0, False
        stabilizers = {name: Stabilizer(args.hold_seconds) for name in ('ioa', 'ground')}
        shown = 'ioa' if args.assignment_mode == 'ioa' else 'ground'
        if not args.headless:
            cv2.namedWindow(WINDOW, cv2.WINDOW_NORMAL | cv2.WINDOW_KEEPRATIO)
            cv2.resizeWindow(WINDOW, 1200, 740)
            gui = True
        while True:
            started = time.perf_counter()
            if frame.shape[:2] != (height, width):
                raise ValueError('Video resolution changed during playback.')
            detections = detector.predict(frame)
            for i, d in enumerate(detections):
                print(f'vehicle={i} raw_id={d["class_id"]} raw_name={d["class_name"]} '
                      f'confidence={d["confidence"]:.3f} mapped={d["vehicle_type"]} ground_approx={ground_point(d)}')
            states, _ = report(index, polygons, detections, detector.threshold, states)
            views = {'ioa': states}
            stable_views = {}
            if args.assignment_mode != 'ioa':
                _, ground_states, reasons = ground_assign(polygons, detections, detector.threshold,
                    args.ground_tolerance, args.ambiguity_margin, height)
                views['ground'] = ground_states
                for reason in reasons:
                    print('GROUND:', reason)
                for method, instant in views.items():
                    stable_views[method] = stabilizers[method].update(instant, index, source_fps)
                    for name in instant:
                        print(f'{method} {name}: instant={instant[name]} stable={stable_views[method][name]}')
            processing_fps = 1 / max(time.perf_counter() - started, 1e-9)
            processed += 1
            if args.max_frames and processed >= args.max_frames:
                break
            if gui:
                seek_target = None
                while True:
                    cv2.imshow(WINDOW, overlay(frame, polygons, detections, views[shown], index,
                                               processing_fps, paused, speed, stable_views.get(shown), shown))
                    key = cv2.waitKey(15) & 255
                    if cv2.getWindowProperty(WINDOW, cv2.WND_PROP_VISIBLE) < 1 or key in (27, ord('q')):
                        return 0
                    if key == ord(' '):
                        paused = not paused
                        started = time.perf_counter()  # No catch-up burst after pause.
                    elif key in (ord('+'), ord('=')):
                        speed = min(4, speed * 2)
                    elif key == ord('-'):
                        speed = max(.25, speed / 2)
                    elif key == ord('t') and args.assignment_mode == 'compare':
                        shown = 'ioa' if shown == 'ground' else 'ground'
                    elif key in (ord('['), ord(']'), ord('r')):
                        seek_target = 0 if key == ord('r') else max(0, index + (30 if key == ord(']') else -30))
                        if count > 0:
                            seek_target = min(seek_target, count - 1)
                        break
                    if (paused and key == ord('.')) or (not paused and time.perf_counter() - started >= 1 / source_fps / speed):
                        break
                if seek_target is not None:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, seek_target)
                    ok, frame = cap.read()
                    if not ok:
                        raise ValueError(f'Cannot decode seek frame {seek_target}.')
                    index = max(0, int(cap.get(cv2.CAP_PROP_POS_FRAMES)) - 1)
                    for stabilizer in stabilizers.values():
                        stabilizer.reset()
                    states = {}
                    print('SEEK/RESTART: temporal history cleared')
                    continue
            ok, next_frame = cap.read()
            if not ok:
                if count > 0 and index + 1 < count:
                    raise ValueError(f'Decode failed before expected end at frame {index + 1}.')
                print('End of recording; no automatic loop or state persistence.')
                break
            frame, index = next_frame, index + 1
        return 0
    except Exception as exc:
        print(f'ROI tester failed: {exc}', file=sys.stderr)
        print('No operational configuration was changed. Check local weights, device, ROI and codec. '
              'Library writes outside disposable scratch storage are blocked.', file=sys.stderr)
        return 1
    finally:
        if cap is not None:
            cap.release()
        if detector is not None:
            detector.close()
        if gui:
            cv2.destroyAllWindows()
        try:
            scratch.cleanup()
        except OSError:
            print('Warning: the OS could not remove disposable library scratch files.', file=sys.stderr)


if __name__ == '__main__':
    raise SystemExit(main())
