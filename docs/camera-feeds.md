# Camera Zones feed configurations

Current operational multi-bay behavior supersedes the diagnostic-only checkpoints
below. See [Operational monitoring](operational-multibay.md) for automatic startup,
exclusive bay ownership, OCR, history and ThinkPad rehearsal instructions.

## Current integrated-monitoring coverage

The pilot-only restriction described in the historical checkpoints below has been
extended to all three reviewed recordings. **Only one is AI-monitored at a time.**

| Recording | Default ROI | Actual bays |
| --- | --- | --- |
| `sample-CCTV/Bays 1-2.mp4` | `config/roi/bays-1-2.json` | 1, 2 |
| `sample-CCTV/Bays 2-5.mp4` | `config/roi/bays-2-5.json` | 3, 4, 5 |
| `sample-CCTV/Bays 6-10.mp4` | `config/roi/bays-6-10.json` | 6, 7, 8, 9, 10 |

The authenticated feed response advertises `integratedAiCompatible` only when the
validated mapping matches the recording's explicit bay set and direction. The UI
uses that flag to show Monitor recording; the start endpoint independently checks
the saved feed and reloads its ROI against the decoded dimensions. Compatible
custom JSON filenames remain supported. No bay IDs are inferred from filenames.
Old feeds without `roiId` retain the recording-specific default association; an
explicit empty `roiId` remains playback-only. Choose the mapping in Edit Feed if
the button is absent. Bays 2–5 correctly uses Bays 3–5, not Bay 2.

Selecting another feed stops the previous capture before starting the next. The
same executor, shared YOLO runtime, source-clock pacing, generation invalidation,
IoA 0.20 assignment, expiry rules and playback controls remain in use. CPU-only
YOLO operation is supported; no new dependency, OCR or parallel sample inference
is introduced. Original operational workers and all operational state are unchanged.

For the ThinkPad, transfer this updated source version, all three recordings and
their JSON files together, restart Flask and Vite, then refresh Camera Zones.
Select YOLOv8 / CPU and test each feed in turn, including pause, seek, restart,
fullscreen and switching. Other cards remain ordinary playback. Laptop performance
and browser smoothness require local verification; desktop checks do not establish them.

## Existing feed configuration behavior

Camera Zones has **LIVE FEED** and **SAMPLE DEMONSTRATION** modes. Only signed-in
local administrators can read or change saved configurations. Hosted administrators
and anonymous visitors receive a read-only layout with no local feed list, camera
addresses or video catalog requests. Supabase authorization is unchanged.

Live feeds store a name, northbound/southbound assignment, selected bay numbers,
credential-free RTSP address (including optional port/path), and TCP/UDP transport.
Plain IP/host inputs are normalized to RTSP URLs. Credentials, embedded user info,
query strings and fragments are rejected; credential handling is deferred until
live integration. Saving never contacts the camera. RTSP playback is not implemented.

Sample feeds store a name, bay labels and a recording selected from
`public/sample-CCTV/` or `public/sample-videos/` (including subdirectories).
Supported file extensions: MP4, WebM, OGG, M4V, MOV, AVI and MKV. Browser previews
use native HTML video; codec support varies. The catalog's preview flag is a hint,
not a gate: other listed formats may be attempted by browsers that support them.
Unsupported previews show an explanation. Missing files remain visible as unavailable configurations.
Refresh the list after adding files externally. Removing a feed removes only its
configuration, never the source video. No uploads or file-management API is added.

Configuration is stored in the ignored local SQLite file
`config/camera-feeds.local.sqlite3`, created lazily after an authorized request.
The operational `terminalsight.db` schema and records are not changed. The existing
administrator token is checked against the current local account; expired, invalid,
or password-invalidated tokens cannot access any new endpoint. Addresses/configuration
are not persisted to browser storage. Configuration databases must stay on the local
machine; they are not frontend assets.

Endpoints: GET/POST `/api/camera-feeds`, PATCH/DELETE `/api/camera-feeds/<id>`,
GET `/api/camera-feeds/videos`. All require local administrator authentication and
return `Cache-Control: no-store`. Catalog entries use relative, encoded public URLs;
recordings are local static assets as before, not confidential authenticated media.
Hosted builds disable public-directory copying and do not deploy the Flask API.

Ordinary sample playback and editable bay labels do not drive operational
detectors, OCR, occupancy sessions, timers, or ROI definitions. The original two
processed sample previews share the Sample Demonstration card grid with added
feeds, retaining their health states, fullscreen action, AI selector and AI-disabled
video fallback. Their backend workers still update operational Bay 1/Bay 6 state;
editing/removal dialogs explain that these workers remain operational regardless
of card visibility or display labels.

Restart the updated local backend and sign in again if its restart invalidated the
local token. Use the existing frontend command. No new packages are required.

Validation commands:

```powershell
.venv\Scripts\python.exe -B -m unittest discover -s tests -p test_camera_feeds.py -v
node --experimental-strip-types --test --test-concurrency=1 tests/camera-feeds.test.mjs tests/demo-deployment.test.mjs
npm.cmd run build:demo
npm.cmd run build
```

Tests use temporary databases and synthetic files. Real camera connectivity is not
tested or implemented, and browser playback depends on the recording codec.

## Optional local AI preview (checkpoint A)

The existing Add Sample Feed picker is unchanged. Three explicit server-side
associations enable **Enable AI Preview** after a local administrator signs in:

| Recording under `public/` | Saved ROI | Diagnostic bays |
| --- | --- | --- |
| `sample-CCTV/Bays 1-2.mp4` | `config/roi/bays-1-2.json` | 1, 2 |
| `sample-CCTV/Bays 2-5.mp4` | `config/roi/bays-2-5.json` | 3, 4, 5 |
| `sample-CCTV/Bays 6-10.mp4` | `config/roi/bays-6-10.json` | 6–10 |

No filename parsing or remapping is required. The backend validates source paths,
schema, geometry, coordinate convention, expected IDs/directions and decoded
dimensions. Invalid or unavailable mappings are not advertised as eligible.
The saved ROI bays take precedence over the feed's presentation-only bay labels.

Select IoA or Ground, then enable the preview. Stop before changing method.
IoA preserves the standalone baseline; Ground is an experimental approximation,
not a promise of higher accuracy. Both show instantaneous states only, including
Ground ambiguity. Labels/confidences come from the existing custom YOLO model.
Nothing is written to operational occupancy, timers, alerts, PA, databases or OCR.

The local Flask process permits one diagnostic worker at a time. It is spawned
separately and uses CPU with one PyTorch thread. It loads its own model rather than
changing the operational runtime/device. Each authenticated frame request returns
a JPEG and metadata for that same source frame. The browser has one outstanding
request; playback skips source frames when inference is slower than the video.
This is a fetched JPEG sequence, not an RTSP stream or a promised video frame rate.
AI playback starts at frame 0 independently of the ordinary HTML video position.
Pause/resume are available; after the recording ends, stop and enable to restart.

Stop, closing the AI diagnostics dialog, leaving Camera Zones, or logout unmounts
the preview and requests cleanup. A lost browser expires after 20 idle seconds; a
running frame has a 90-second timeout. Stopping forcibly ends an unresponsive
worker. Disposable library settings are owned/cleaned by the parent process.
One-worker enforcement assumes the existing single-process Flask launcher.

Every `/api/sample-ai` endpoint uses the existing local administrator verifier:
GET `/mappings`, POST `/sessions`, POST `/sessions/<id>/frame`, and DELETE
`/sessions/<id>`. Sessions belong to their creating login token. Tokens are sent
only in Authorization headers, never image URLs. Responses are no-store. Hosted
builds cannot initiate requests and Vercel excludes these Python modules/assets.

OCR is deliberately not enabled in checkpoint A. For a future approved OCR checkpoint, the inspected
`create_engine`, `crop_sign` and `read_sign` helpers in `backend/ocr/ocr_worker.py`
can provide rate-limited raw text/no-read results. Do not use operational
`OCRWorker`, which calls `occupancy.apply_ocr`.

Additional checks:

```powershell
.venv\Scripts\python.exe -B -m unittest discover -s tests -p test_sample_ai.py -v
node --experimental-strip-types --test --test-concurrency=1 tests/sample-ai.test.mjs tests/camera-feeds.test.mjs tests/demo-deployment.test.mjs
```

An explicit real CPU/model smoke check is available by setting
`TERMINALSIGHT_SAMPLE_AI_SMOKE=1` for the Python test process. It reads local
recordings, returns JPEGs, tests pause/cleanup and never initializes the operational
server/database. It is skipped by default where model/video assets are unavailable.

## Unified Sample Demonstration: checkpoint B

Northbound Cam 1 and Southbound Cam 1 share the same grid as saved feeds.
There is no separate “Existing detection previews” section or duplicate recording.
Their worker identities and sources stay fixed; display labels and visibility
are now saved separately as described below. The
catalog still includes both original `sample-VID_20260604_*.mp4` recordings.
Notification focus targets (`camera-1`, `camera-2`) and fullscreen controls remain.

The editor shows all ten bay labels grouped as Northbound 1–5 / Southbound 6–10.
The terminal direction enables its corresponding group. The backend already
accepted both ranges; existing saved feed configurations need no migration.
These are presentation labels, not edits to saved ROI assignments.

Ordinary players are independent native `<video>` elements with controls, muted
audio, metadata preloading and aspect-ratio-preserving presentation. Several can
play at once subject to browser/device decoding resources. Unmount releases only
that player's media. AI scheduling and processed overlay behavior are unchanged.

On media failure, a credential-free HEAD request checks the same local video URL.
404/410, other HTTP failures, an HTML/API response at a media URL, network failures,
unsupported formats and decode failures receive separate messages. Retry remounts
that player. HEAD cannot prove codec support or file integrity; a decode error may
still mean an unsupported codec profile or damaged file.

Read-only local inspection found H.264 in the five `sample-CCTV` recordings
(2304×1296), and HEVC in the two original recordings (1920×1080). OpenCV decoded
all seven. HEVC support varies across browsers and devices; the original processed
MJPEG previews do not depend on browser HEVC support. No transcoding is performed.

Legacy architecture audit: `run_ai_background` passes clean source frames to
`CameraInference` / `analyze_frame` / the active runtime. The saved preference at
inspection was YOLOv8 AMD; startup can fall back or an administrator can select
another model. Playback follows the source clock independently of inference
(one pending job per camera, at most ten observations/second), then emits 960-wide
JPEGs. MJPEG delivery FPS is not inference FPS. Completed detections update
`OccupancyState`, timers and OCR work. `OCRWorker` calls the real OCR engine and
applies recognized text; a scan rectangle alone does not establish recognition.
These states can drive frontend notifications and PA speech. The inspected worker
path does not persist automatic vehicle-visit records to SQLite.

Checkpoint C (separate synchronized overlays and fair multi-camera scheduling)
and checkpoint D (new diagnostic OCR recognition) remain deferred for manual review.


## Editable grid and continuous ROI overlays (A and B)

Legacy cards use the same Edit Feed dialog for their display name, terminal
direction and bay labels. PATCH `/api/camera-feeds/display/1` (or `/2`) accepts
only `name`, `direction`, `bays`, and boolean `hidden`. The authenticated feed
list returns `legacyDisplays` alongside the unchanged `feeds` array. Overrides
live in a separate `legacy_display` table inside the ignored feed configuration
SQLite file. This does not alter the operational database or worker settings.
Old saved feed rows need no migration; absent display overrides use original labels.

Removing a legacy card hides its UI only. The confirmation explains that detection,
OCR, shared timers and announcements continue. Restore it with **Hidden camera
cards → Restore**. The two stream URLs and physical Bay 1/Bay 6 assignments never
depend on editable labels. Removing an added feed still removes only its saved
configuration, not its recording.

Native grid videos autoplay muted and loop when the browser allows it. Each video
has its own clock and controls. Validated `/api/sample-ai/mappings` responses now
include `roi: {width, height, normalization, polygons}` using the saved JSON points.
Reading mappings starts no inference worker. A pointer-transparent SVG shows
these fixed regions continuously, even with AI off or the video paused. These
outlines represent geometry, not a detected occupancy status. The saved ROI bay
IDs remain authoritative even when a feed's display labels are edited.

The SVG viewBox uses decoded video dimensions and centered aspect-ratio-preserving
scaling, matching the video element's object-contain fit. The shared fullscreen
button expands the video and overlay together. A source-dimension mismatch hides
the overlay and shows a warning. Browser-native video-only fullscreen may omit
HTML overlays on browsers that ignore controlsList; use the card fullscreen button.
No OCR rectangle or recognized text is synthesized for the new recordings.
Legacy MJPEG retains all existing baked-in detector/OCR overlays.

**AI diagnostics** opens the existing opt-in IoA/Ground preview in a separate dialog.
It starts at its own frame zero and is explicitly independent of the grid timeline.
Opening the dialog does not start inference until Enable AI Preview is pressed.
The native player remains mounted and its playback is not driven by inference.
Closing the dialog unmounts and stops the diagnostic session. The existing one-worker
limit remains. Synchronized YOLO overlays (C), multi-camera AI scheduling and new
OCR configuration/recognition (D) are not implemented in this checkpoint.

## Unified AI monitoring pilot — checkpoint B

The synchronized pilot is limited to `sample-CCTV/Bays 1-2.mp4` and its existing
Bay 1/Bay 2 ROI. The other recordings retain static ROI playback and their prior
separate diagnostics; multi-camera synchronized scheduling needs checkpoint C approval.

Enable AI monitoring on the pilot card after choosing YOLOv8 in AI Detection.
This uses the active, already initialized runtime/device, including the isolated
DirectML adapter when selected. It never switches models, writes saved selection,
initializes a second model or forces CPU. Other active model selections reject the
pilot request with a useful message. The ordinary operational prediction result
shape remains unchanged; opt-in detailed predictions preserve actual custom class
IDs/names and confidence (`bus` → Bus, `uv` → UV Express; no car-to-van remapping).

POST `/api/sample-monitor/frame` requires the same local administrator token as
feed configuration. Its body is exactly `{videoId, seconds, method, epoch}`.
The server validates the approved video/ROI, decodes the requested source timestamp,
checks actual source dimensions and returns source-frame boxes, scores, bay states,
frame/time, processing rate and active model/device. It writes no operational
occupancy/session state, database records, notifications, announcements or OCR results.
The IoA baseline remains intersection divided by bay area, threshold 0.20, with
one vehicle per bay and one bay per vehicle in saved ROI order. Ground remains an
explicit experimental comparison; ambiguity is not presented as certain occupancy.

The server admits only one diagnostic request at once, with at most two starts per
second and no queue. It skips busy shared inference or model switching instead of
waiting for that lock. The client has one pending request and waits 500ms between
responses. The shared model can still briefly delay an operational inference while
a diagnostic call is running; this is not a guarantee of unchanged throughput.
This limit is per Flask process, matching the current single-process launcher.
The old separate diagnostic service retains its own existing one-worker limit.

Native playback never waits for AI. Results must match the camera, method, seek
generation and decoded dimensions, and be within 0.25 seconds of playback time.
Seeking, pausing/resuming, loops, errors and method changes invalidate prior results.
Paused videos can retain the matching analyzed frame. Stop/unmount aborts the client
request; an already running server call finishes and releases its capture/lock.
Results are not extrapolated or tracked forward. If inference is too slow, boxes
and occupancy colors disappear rather than becoming stale; pause for inspection.
The displayed processing FPS describes the last request's decode/inference work;
source FPS is labeled separately and is not measured browser-delivered FPS.

Available is #22c55e, occupied #ef4444, uncertain #f59e0b, boxes #3b82f6 and
inactive ROI gray. Legacy slot colors now use the same green/red; the existing
OCR scan region uses cyan #06b6d4 (held regions amber). These legacy changes are
rendering-only. Operational ROI assignments, occupancy and timers are unchanged.

OCR audit: `sign_bounds` derives class-specific fractional crops inside vehicle
boxes from `config/routes.json`, rather than fixed camera coordinates. `crop_sign`
preprocesses the clean crop, `read_sign` returns actual RapidOCR text/scores, and
`RouteEvidence.observe` aggregates repeated known-route evidence. The operational
OCRWorker writes session state and must not be reused directly for diagnostics.
New camera angles require crop calibration and isolated evidence state in checkpoint D.
No OCR scan area or recognized text is added to this pilot; legacy real OCR continues.

Automated tests cover auth, timestamp bounds/generation checks, explicit associations,
resource rejection, cleanup, real confidence preservation and unchanged legacy adapter
contracts. Actual browser rendering and contention on the configured GPU require
manual verification before C/D. A real CPU smoke check decoded and predicted at two
pilot timestamps without starting the application or writing operational data.

Checkpoint B validation: 114 backend tests ran (113 passed, one optional model smoke test skipped); 27 frontend regressions plus one deterministic hook lifecycle test passed. The hook test exercises actual request logic with simulated media events and does not substitute for browser playback/GPU verification. Both frontend builds and TypeScript checks passed.

## Reusable ROI geometry and mapping workflow — Checkpoint 2A

`backend/detection/roi_config.py` loads schema-1 JSON through the existing mapper
validator. It checks source association, decoded dimensions, geometry and terminal
direction, and caches immutable polygon/array snapshots by JSON content. Changed
or invalid JSON cannot mutate a snapshot already held by a caller. Overlap warnings
are retained. JSON bay order is preserved; it can affect the legacy first-bay
assignment policy. No automatic activation or operational state publication occurs.

`detector.assign_detections(results, polygons)` extracts the existing IoA algorithm:
intersection divided by bay area, inclusive 0.20 threshold, each detection used once,
first detection wins equal scores, bays visited in insertion order. This is the
legacy policy, not the standalone Ground diagnostic's global matching policy.
`analyze_frame(..., roi=prepared)` accepts prepared geometry for future callers.
Omitting it retains the exact Bay 1/Bay 6 coordinates and legacy return format.
Prepared frame dimensions must match before inference is called.

The desktop mapper displays paused frames. Drag its visible timeline and release
to decode one frame; dragging does not repeatedly decode. Keyboard `,` / `.` steps
one frame and `[` / `]` jumps 30. Polygons remain camera-viewpoint geometry while
seeking. The exported frame index is only a representative frame, not a per-frame
polygon key. Unknown frame counts disable the slider but keep keyboard seeking;
failed seeks retain the last decoded frame and polygons. No automatic writes occur.

From the repository root, edit the existing mapping into a separate file:

```powershell
.\.venv\Scripts\python.exe -B tools/roi_mapper.py --video "public/sample-CCTV/Bays 1-2.mp4" --load "config/roi/bays-1-2.json" --output "config/roi/bays-1-2-review.json"
```

Use `1`–`9` / `0` (Bay 10), `N` then four perimeter-order clicks to add a bay;
click to select and drag corners to edit; `U` undoes a draft point, `C` cancels the
draft, `D` deletes the selected polygon. `B` changes direction, but saved feed
associations require Bays 1–5 northbound and 6–10 southbound. `S` saves explicitly;
overwriting requires `Y`. `Q`/Escape quits with unsaved-change confirmation.

In local Camera Zones → Sample Demonstration → Add/Edit Feed, choose the recording
using the existing picker, then choose **Parking-bay mapping**. Selection fills
its bay labels and terminal direction; saving validates both again server-side.
To register a new mapping, save its JSON in `config/roi` using the desktop mapper,
click **Refresh mapping list**, select it and save the feed. No browser upload or
desktop process launch is provided. Only compatible files appear; bad geometry,
wrong source/dimensions or mixed/wrong directions are excluded.

GET `/api/camera-feeds/roi?videoId=...` and feed writes require local administrator
authentication. Only catalogued local videos and JSON filenames within `config/roi`
are accepted; responses omit absolute filesystem paths. No mapping management or
local geometry is loaded in hosted Demo Mode. The separate feed-settings database
stores optional `roiId`: omitted preserves the existing explicit three-recording
association, empty string means no mapping, otherwise it names a selected JSON.
No operational database schema or camera worker configuration changes are needed.

Unmapped or invalid mappings leave ordinary playback available and show a status.
Valid mappings provide static neutral ROI overlays, not occupancy. Existing AI
controls remain available only for their original approved recording/mapping pairs;
other selected mappings wait for a separately approved integration checkpoint.
This checkpoint adds no YOLO/OCR processing, MJPEG route or multi-camera scheduling.
Manual desktop/browser verification is still required; automated geometry tests
do not establish visual alignment, smooth playback or detection accuracy.

## Checkpoint 2B — single-recording integrated preview

Select **Monitor recording** on a saved Bays 1–2 feed to start one integrated
YOLOv8/IoA preview automatically. No second Enable AI button is needed. The selected
card replaces its native player with an authenticated MJPEG consumer; all other
cards retain ordinary playback. Stop monitoring returns to ordinary playback.
Only `sample-CCTV/Bays 1-2.mp4`, with a validated mapping containing Bays 1 and 2,
is enabled. Custom compatible JSON selections from 2A are accepted. No OCR is added.

The previous diagnostic route's busy messages came from its nonblocking shared
runtime lock. Its 0.25-second browser timestamp filter then removed delayed or
between-update results. Integrated preview instead uses one OpenCV capture and one
authoritative source-clock timeline, with skipped obsolete frames and a latest-JPEG
buffer. Inference receives a clean copy of that capture's frame and runs on one
executor, at no more than five submissions per second. It uses the active YOLOv8
adapter/device; it never loads, switches or shuts down the shared runtime. Busy
runtime calls skip diagnostics, retaining an existing observation until expiry.

The existing IoA assignment function and 0.20 threshold are unchanged. Occupancy
persists for at most two seconds measured from submission, both in wall time and
source-video time. Boxes require source-time lag of at most 0.35 seconds as well.
This is bounded-lag visualization, not motion tracking or exact same-frame inference.
With slow inference, boxes may disappear while occupancy remains; after expiry ROIs
turn gray. An actual empty detection result marks bays available; unavailable AI
does not. Source FPS and measured successful AI updates/second are labeled separately.

Pause/resume, seek, restart and looping advance a generation and clear observations.
Old-generation results cannot overwrite new geometry/status. Seeks are queued to
the capture-owning playback thread, rather than performed in the request handler.
Controls may briefly blank the preview while the target frame decodes. Browser
JPEG parts carry a generation so buffered older parts can be discarded. The browser
does not run a second native timeline during integrated monitoring.

POST `/api/sample-preview` accepts only `{feedId}` and reads the separate feed
configuration database in SQLite read-only mode. It resolves the saved association
through the 2A loader. GET/PATCH/DELETE `/api/sample-preview/<id>` manage the owning
session; GET `/api/sample-preview/<id>/stream` streams multipart JPEG. Every route
requires the existing local admin bearer header. The browser uses authenticated
`fetch`, bounded multipart parsing and short-lived blob image URLs; no bearer token
appears in a media URL. Hosted Demo Mode refuses these requests before reading local
credentials. Each session is bound to its creator's token fingerprint, not a supplied
username. Heartbeats revalidate authorization; absence for 20 seconds expires the
session (the lease is checked every two seconds).

Switching stops and joins the previous playback thread before opening another capture.
There is one pending diagnostic inference across switches, including a native call
that cannot be cancelled. A stalled decoder prevents a new session rather than
launching another decoder. Disconnect, removal, unmount and Stop release playback;
the lease handles missing cleanup. A running model call may finish after stopping,
but its result is discarded and it never stops the operational model. Existing
operational workers continue independently; shared CPU/GPU use can still affect
their throughput and requires hardware verification.

The old separate-worker POST endpoints and timestamp-polling endpoint now return
409 after authentication in the application. Their implementation is retained for
diagnostic tests, but they cannot run a competing sample worker through this server.
The separate AI Diagnostics window is removed from Camera Zones. No operational
occupancy, timers, routes, visit logs, notifications, PA or cloud state is accessed
by the new controller. The only database connection it opens is read-only feed settings.

Manual verification: restart Flask, choose YOLOv8 in AI Detection, edit a Bays 1–2
sample feed and select its matching ROI. Click Monitor recording. Check native
source-paced movement, blue vehicle boxes, red/green occupancy, then Pause, seek
using the position slider plus Seek, Resume, Restart and Loop. Check fullscreen,
Stop, removal and leaving Camera Zones. Confirm the original two operational
previews and timers continue. Repeat with the configured AMD runtime if available.
Automated tests do not establish browser smoothness, GPU contention or accuracy.
