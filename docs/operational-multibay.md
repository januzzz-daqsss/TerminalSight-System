# Operational monitoring of recorded CCTV

Local saved sample feeds with valid ROI mappings now start automatically when
Flask starts with AI enabled. They use the shared selected detector, occupancy
sessions and RapidOCR engine. Recorded footage is a demonstration source, not a
live connection to the terminal. RTSP remains configuration-only.

## Setup for all ten bays

Keep the existing local environment, trained weights, RapidOCR ONNX models and
recordings. No new dependencies are required. Start from the repository root in
two PowerShell terminals (stop an existing backend before restarting it):

```powershell
.\.venv\Scripts\python.exe -B app.py
```

```powershell
npm.cmd run dev
```

`TERMINALSIGHT_DISABLE_AI=1` disables operational monitoring; remove that
process environment override if you previously used API-only testing. Sign in
with the existing local account. Select YOLOv8 / CPU in AI Detection for the
ThinkPad rehearsal. SSD and Faster R-CNN continue to use the same selected
runtime and can be slower. No extra model is loaded per camera.

In Camera Zones > Sample Demonstration, use Add Sample Feed / Edit Feed:

| Video under `public/sample-CCTV/` | ROI under `config/roi/` | Direction | Bays |
| --- | --- | --- | --- |
| `Bays 1-2.mp4` | `bays-1-2.json` | Northbound | 1, 2 |
| `Bays 2-5.mp4` | `bays-2-5.json` | Northbound | 3, 4, 5 |
| `Bays 6-10.mp4` | `bays-6-10.json` | Southbound | 6, 7, 8, 9, 10 |

Choose each saved JSON explicitly; do not remap the recordings. The geometry,
source association, dimensions and direction are validated. The name of a feed
is only a label. A recording with no selected mapping stays playback-only.
The current desktop feed database may not contain all three entries; configurations
are not created or overwritten by this implementation.

## Ownership and lifecycle

The manager reconciles the local feed database every two seconds. Oldest saved
valid configurations take priority; overlapping bay IDs are rejected as a whole,
not silently split between feeds. Invalid configured mappings reserve their
declared bays so an unrelated legacy recording cannot masquerade as coverage.
Edit or remove conflicts to resolve them.

Original Northbound/Southbound workers remain fallback owners of Bay 1/Bay 6
only when no configured mapping claims those bays. Their original source files
and hardcoded geometry are unchanged. Their saved display names/hide settings
remain presentation-only.

Stop camera stops that worker without deleting its configuration. Restart camera
reopens and revalidates it. Stops last for the current backend process; restarting
Flask automatically starts valid configured feeds again. Removing a saved feed
stops its worker; legacy fallback may resume where appropriate. A replacement
never starts until its previous capture thread exits. A decoder that cannot stop
keeps its ownership reserved and reports an update error.

One bounded FIFO inference consumer services all operational cameras. Each camera
has at most one pending job, and the queue holds at most ten jobs. Canceled queued
jobs release their frame buffers. Playback follows each recording's source clock
and may skip frames under load. The displayed AI rate measures completed detection
updates, not video delivery or accuracy. Detection/scan boxes retain their last
observed coordinates for an adaptive interval: twice the measured queue/inference
latency plus 0.25 seconds, with a one-second floor and three-second default cap.
Set `TERMINALSIGHT_OVERLAY_MAX_SECONDS` before starting Flask to change the cap;
it cannot exceed five seconds or the configured departure grace period. Age is
measured from the analyzed source frame, not result arrival. Late results outside
the cap stay hidden. Boxes show their observation age; held OCR areas retain cyan
styling with a HOLD label. This is retained evidence, not motion tracking.
Misses do not refresh the box age. Confirmed routes remain at the bay's fixed
polygon label independently of box visibility, until the session ends or changes,
or monitoring becomes stale. Loop/session resets still invalidate route evidence.
A frame outage over ten seconds or an inference result
older than fifteen seconds removes healthy coverage from the dashboard/public views.

The processed cards have fullscreen and explicit camera Stop/Restart controls,
without video pause/seek controls. Closing a browser card stops only its HTTP
stream, not its operational worker. Local authenticated endpoints are under
`/api/operational-cameras`; stream credentials are sent in headers, never URLs.
Hosted demo/Supabase users cannot use local camera controls.

## OCR and history

OCR uses the existing vehicle-relative Bus/UV Express sign regions in
`config/routes.json`, not a fabricated sign detector. Clean source-frame crops go
to one RapidOCR engine, with at most one pending crop per bay. Replacing a crop
retains its FIFO position. The existing sampling interval, confidence thresholds,
route matching and temporal confirmation remain unchanged. Blank/uncertain reads
remain Detecting or Unknown; a scan rectangle alone is not proof of recognition.
New camera angles, occlusion and small/distant text can require later crop
calibration. No recognition or accuracy guarantee is made for every vehicle.

`Occupancy_Log` now receives first-observed arrivals and confirmed departures
through the existing schema. Duration uses the monotonic session clock; timestamps
are UTC. These are observations of the recording, not proof of real-time terminal
visits. The authenticated occupancy CSV includes this saved history. Analytics
charts and the illustrative Violation Logs register remain labeled examples.
Actual overstay alerts and PA triggers consume healthy shared bay sessions.

At a recording loop, pending inference/OCR results are invalidated. The first
new-cycle observation establishes a fresh baseline without a logged arrival or
departure. Session identity, route evidence and timer are reset to avoid giving a
different vehicle the previous cycle's identity. During reset, coverage is unknown.
Interrupted visits (loop, stop, source replacement, shutdown) remain incomplete
with null departure/duration rather than fabricated timestamps. They are not
silently reopened after restart. Subsequent observed changes use normal confirmation.
Storage failures appear as a history error; detection continues, but failed writes
are not automatically replayed. Cloud behavior is unchanged.

The loading limit remains 900 seconds. A recording shorter than that cannot prove
a fifteen-minute overstay by repeatedly looping: each cycle begins a new observation
window. Use a sufficiently long recording for that rehearsal; the system does not
shorten timers or fabricate an overstay for presentation.

## Manual rehearsal

1. Confirm all three configured feeds report Live and all ten bays have current
   coverage. Check the real blue vehicle/OCR regions and red/green bay outlines.
2. Compare occupied bays, vehicle types, timers and confirmed routes across the
   dashboard, `/public-view` and `/signage`. Unreadable signs must remain unknown.
3. Stop one feed: its bays must become unmonitored, not available. Restart it and
   confirm coverage returns only after detection completes.
4. Edit a feed, switch a valid mapping, and remove a disposable configuration.
   Confirm previous workers release their sources and other cameras continue.
5. Attempt a duplicate bay assignment: the later conflicting feed must not run.
6. Let recordings loop. Check there is no synthetic departure/arrival history at
   the loop boundary and no old OCR text attached to the new session.
7. Export saved occupancy CSV and distinguish completed visits from interrupted
   rows. Verify actual overstay/PA behavior during a sufficiently long observation.
8. Rehearse on the ThinkPad offline after dependencies/models are installed.
   Browser smoothness, long-duration stability, GPU models and live RTSP require
   separate verification; short CPU tests do not establish them.

## Implementation file inventory

New files:

```text
backend/cameras/operational.py
backend/state/occupancy_history.py
src/cameras/operationalCamera.ts
src/components/ui/OperationalCameraPreview.tsx
tests/test_operational_cameras.py
tests/operational-cameras.test.mjs
docs/operational-multibay.md
```

Updated files (the pre-existing ROI forwarding in camera_inference/server is retained):

```text
backend/cameras/camera_inference.py
backend/detection/detector.py
backend/ocr/ocr_worker.py
backend/server.py
backend/state/occupancy.py
src/App.tsx
src/types.ts
src/utils/monitoringCoverage.ts
src/notifications/useNotifications.ts
src/components/ui/BayCard.tsx
src/components/ui/PublicBayCard.tsx
src/components/ui/ProcessedSampleFeeds.tsx
src/components/ui/RoiMappingPicker.tsx
src/components/ui/SampleCoverageNotice.tsx
src/components/views/CameraZonesView.tsx
src/components/views/DashboardView.tsx
src/components/views/PublicView.tsx
src/components/views/PublicSignageView.tsx
src/components/reports/AnalyticsPrintReport.tsx
tests/public-display.test.mjs
tests/camera-feeds.test.mjs
tests/test_backend_startup.py
tests/test_integrated_preview.py
tests/test_occupancy_export.py
tests/test_ocr.py
tests/test_synchronized_preview.py
docs/camera-feeds.md
docs/occupancy-csv.md
docs/ocr-public-view.md
```

## Recorded validation on November 13, 2026

The backend suite ran 144 tests: 143 passed and one optional test was skipped.
The selected frontend suite passed 44 tests. After correcting the feed-management
messages, its 20 affected camera tests were rerun and passed. Both `npm.cmd run
build:demo` and `npm.cmd run build` passed, including TypeScript validation;
Vite reported a non-failing bundle-size warning. `git diff --check` passed.
Tests use temporary databases and
explicit fixture detections; they do not establish detector accuracy.

A separate 30-second desktop CPU smoke check used the three actual recordings,
their saved ROI mappings, the existing YOLO model, and real RapidOCR, with
temporary feed/history databases. All three workers became healthy and reported
coverage of all ten bays, with roughly 2.6–3.8 completed AI updates/second/camera
at the sampled checkpoints. OCR produced nonempty reads for Bays 3, 4 and 5,
but no confirmed route was retained at the cutoff. Three history rows were saved
in the temporary database, and the camera threads stopped cleanly. This does not
prove correct occupancy/classification, route convergence for all ten bays, browser
frame rate, ThinkPad performance, GPU behavior, or long-duration stability.
