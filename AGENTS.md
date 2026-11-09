# TerminalSight Agent Instructions

## Project context

TerminalSight monitors bus and UV Express loading bays at Panabo City Bus Terminal.
It combines vehicle detection, parking occupancy, route OCR, loading timers and
public information screens. Keep core operations local and offline over the LAN.

The backend uses Python, Flask, SQLite, OpenCV and Shapely. The frontend uses
React, TypeScript, Vite and Tailwind CSS. Detection supports YOLOv8, Faster R-CNN
and SSD300-VGG16. RapidOCR reads destination signs locally.

## Working rules

- Check `git status` and the current branch before editing. Work on the active
  task branch and preserve unrelated changes. Commit, push or merge only when
  requested; do not change branches as part of an unrelated task.
- Inspect the relevant implementation and tests before making changes. Extend
  working code rather than replacing it with a duplicate implementation.
- Keep changes limited to the requested feature. Preserve existing behavior and
  the neutral interface theme, including green, amber and red occupancy states.
- Do not add cloud services, remote databases or runtime model downloads to core
  detection, OCR or occupancy features. Email OTP is an existing WAN-dependent
  exception; do not describe it as offline functionality.
- Keep credentials out of source code, screenshots and logs. The email password
  belongs in `TERMINALSIGHT_SMTP_PASSWORD`. Preserve authentication on protected
  endpoints, including detection settings and occupancy CSV export.
- Preserve `terminalsight.db`, sample videos, trained weights and local settings.
  Use temporary databases for tests. Do not reset or overwrite operational data.
- Keep large ignored assets and machine-specific configuration out of commits.
  Do not install both `onnxruntime` and `onnxruntime-directml` in the same environment.

## Where to work

Paths below are relative to the repository root, which contains both `app.py`
and `package.json`. The frontend is in `src`, not a second nested `app` folder.

| Area | Main files |
| --- | --- |
| Guarded launcher | `app.py` |
| API, database initialization and video streams | `backend/server.py` |
| Repository resource paths | `backend/paths.py` |
| Vehicle-to-bay assignment and polygon overlays | `backend/detection/detector.py` |
| Model loading, selection and adapters | `backend/detection/detection_runtime.py`, `backend/detection/detection_models.py`, `backend/detection/detection_directml.py` |
| Isolated AMD execution and asynchronous inference | `backend/detection/detection_process.py`, `backend/cameras/camera_inference.py` |
| Occupancy sessions and shared timers | `backend/state/occupancy.py` |
| OCR crops, aggregation and extra destinations | `backend/ocr/ocr_worker.py`, `backend/ocr/route_recognition.py`, `backend/ocr/route_details.py`, `config/routes.json` |
| Frontend screens and reusable components | `src/components/views`, `src/components/ui`, `src/components/layout` |
| Shared frontend state and public display formatting | `src/App.tsx`, `src/types.ts`, `src/utils/publicDisplay.ts` |
| Health and notifications | `backend/state/system_status.py`, `src/notifications` |
| Training, validation and automated checks | `scripts`, `notebooks`, `tests` |

## Behavior to preserve

- Bay occupancy uses intersection area divided by bay polygon area, with a
  threshold of 0.20. Preserve this definition when changing detection adapters.
- Use the server's shared occupancy session and timer for all displays. The
  current loading limit is 900 seconds; departure confirmation defaults to five
  seconds. Brief occlusion must not immediately reset an active session.
- OCR uses clean source-frame crops and repeated observations. Keep confirmed
  routes stable during unreadable frames and reject results from old sessions.
  Clear session-bound route information after confirmed departure or video rewind.
- Keep pending inference/OCR work bounded and sample playback independent of
  slow inference. Preserve isolated DirectML workers and CPU crash recovery.
- Preserve the existing SQLite schema and CSV field names: `log_id`, `slot_id`,
  `vehicle_type_class`, `arrival_timestamp`, `departure_timestamp`, and
  `calculated_duration_minutes`. Inspect `init_db()` before schema changes.
- Preserve both public screens: `/public-view` for passengers and `/signage`
  for drivers, including their shared timers and stale-data indicators.

## Run locally

Run from the repository root using the existing virtual environment. Start the
backend and frontend in separate PowerShell terminals:

```powershell
.\.venv\Scripts\python.exe -B app.py
```

```powershell
npm.cmd run dev
```

Open the URL printed by Vite. Flask listens on port 5000. Check for an existing
server before starting another instance. `-B` prevents Python bytecode writes;
it does not enable detection or GPU acceleration.

## Verification

Choose checks relevant to the change. Documentation-only edits need path and
content review; do not rerun model inference for a prose change.

```powershell
# Backend regression suite
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p "test_*.py" -v

# Focused OCR, route aggregation and occupancy-session checks
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p test_ocr.py -v

# Public screens and notifications
node --experimental-strip-types --test tests/notifications.test.mjs tests/public-display.test.mjs

# TypeScript and production frontend build
npm.cmd run build
git diff --check
```

For runtime changes, also check both sample feeds, bay states, route overlays,
public screens and timer continuity. Test GPU changes on compatible hardware;
passing unit tests alone does not prove a device works. Report what changed,
which checks actually ran, their outcomes and any remaining limitations.

## Current limits and supporting records

The current sample-camera polygons cover Bay 1 and Bay 6. Do not claim all ten
bays have live detector coverage. Scrolling LED fragment aggregation has controlled
tests; real scrolling LED footage still needs validation. Intel GPU selection is
not implemented. Automatic visit persistence is incomplete, Analytics charts use
demo data, and cloud synchronization is not configured.

Read `docs/ocr-public-view.md`, `docs/detection-models.md`,
`docs/occupancy-csv.md` and `docs/notifications.md` for feature-specific details.
Use `docs/colab-training.md` and `docs/manuscript-results-2026-10-04.md` for training
and recorded metrics. Distinguish historical results from checks rerun today.
The legacy YOLO model uses a different dataset from the v18 Faster R-CNN/SSD
models; do not present their metrics as a controlled three-model comparison.
When implementation changes, update the affected guidance to match verified behavior.
