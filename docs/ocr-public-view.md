# OCR route recognition and the two public displays

## Implemented

Local destination-sign OCR now accompanies the existing YOLO/Shapely sample-video
pipeline. Active bay sessions expose a stable route and a shared server timer.
The new passenger Public View uses a boarding-information table. The existing driver
Public Display retains its two-zone terminal map and adds routes and countdowns.
The sidebar has matching launch buttons, with Public View immediately above Public Display.

## Files created for this feature

- `config/routes.json`: route IDs, labels, aliases, crop regions, sampling/matching thresholds.
- `route_recognition.py`: normalization and temporal known-route matching.
- `route_details.py`: dynamic extra sign labels using per-line confidence, position
  and repeated readings; no list of allowed secondary destinations.
- `occupancy.py`: thread-safe session identity, route state, and shared monotonic clock.
- `ocr_worker.py`: bounded background OCR queue and explicit local-model loading.
- `scripts/test_sample_ocr.py`: repeatable real-video OCR diagnostics.
- `src/components/views/PublicView.tsx`: passenger display at `/public-view`.
- `src/utils/publicDisplay.ts`: shared passenger/driver status, route and timer formatting.
- `tests/test_ocr.py`: temporal recognition, isolation, session and queue tests.
- `tests/public-display.test.mjs`: public UI rendering and status-boundary tests.
- `docs/ocr-public-view.md`: this report.

## Existing files modified for this feature

- `app.py`: starts OCR alongside detection, exposes `/api/bays`, optional authenticated
  `/api/ocr/debug`, and OCR health; existing status/timer routes use the same session clock.
- `detector.py`: optionally returns the vehicle box/class assigned to each bay, preserving
  the original status-only interface and parking polygons.
- `requirements.txt`: pinned local OCR dependencies.
- `src/App.tsx`: one shared polling path for admin and both public routes; public pages
  work independently without an admin tab. PA remains admin-only and resets per session.
- `src/types.ts`: session, route, confidence, OCR state and elapsed-time fields.
- `src/components/layout/Sidebar.tsx`: new passenger launch action.
- `src/components/ui/BayCard.tsx`: recognized route/detecting/unknown text for admins.
- `src/components/ui/PublicBayCard.tsx`: driver routes, timers and boarding/departure states.
- `src/components/views/PublicSignageView.tsx`: stale-update indicator; map preserved.
- `src/notifications/model.ts`: OCR engine health type.
- `src/notifications/useNotifications.ts`: genuine OCR service-failure/recovery alerts;
  overstay deduplication uses occupancy session IDs.
- `src/notifications/NotificationUI.tsx`: OCR service state in system details.
- `tests/test_occupancy_export.py`: API timer consistency and debug-access regression tests.

The earlier notification/OCR work is preserved in commit `c25c9e3`. The dynamic
secondary-label update is a new working-tree change and has not been committed or pushed.

## Dependencies and database

Added `rapidocr==3.9.2` and `onnxruntime==1.30.0`. RapidOCR detects/reads text locally;
ONNX Runtime executes its models on the CPU with one intra/inter-operation thread.
The installed RapidOCR wheel bundles the three model files used here. Startup verifies
those files and uses explicit local paths, so runtime does not download OCR models or
send images to a remote service. Package installation initially requires internet.
Missing models disable OCR with a system alert; vehicle detection and timers continue.

No SQLite tables or columns were changed for this feature. Active routes/sessions are
in memory and reset on backend restart or confirmed departure. Route history is not
added to CSV. The previous feature's existing Occupancy_Log export is unchanged;
automatic persistence of vehicle visits remains a separate unfinished integration.

## OCR and LED recognition

1. YOLO supplies the best matching vehicle bounding box for each existing Shapely bay.
2. A configurable rectangle relative to that vehicle crops the upper/front sign region.
   Crops come from the unannotated frame, not the drawn bay overlays.
3. Bus crops use up to 2x enlargement. UV crops focus on the windshield, use up to 3x
   enlargement and a 2x vertical stretch to compensate for flattened sign lettering.
   Both are capped at 960 pixels. `sign_regions` and `sign_preprocessing` in
   `config/routes.json` control this calibration. Original color is retained; no
   characters are invented and the route-confidence thresholds remain unchanged.
   Live camera feeds display a cyan **OCR SCAN AREA** rectangle using these exact
   source-image crop coordinates. It follows the detected vehicle on processed frames;
   OCR still samples every 1.5 seconds. During the obstruction grace period, the last
   position appears in amber as **OCR AREA - HOLD**. Boxes disappear when the session
   ends or OCR fails. Overlays are drawn after taking the clean OCR frame copy, so
   their labels cannot be read back into recognition.
4. At most one crop per bay every 1.5 seconds is submitted. A separate worker keeps at
   most two pending jobs, replacing obsolete work instead of blocking YOLO.
5. OCR lines below 0.65 text confidence are discarded. Text is uppercased, punctuation
   normalized and common digit/letter confusion corrected (for example PANAB0).
6. Up to 24 observations over 30 seconds are compared with configured route aliases.
   Matching blocks can cover different parts of an alias across frames. Each character
   needs support in at least two observations and there must be at least three supporting
   observations overall. This lets repeated LED fragments combine without requiring a
   complete route in one frame. Near-matches must meet strict length/similarity checks.
7. Publication requires a route score of at least 0.90 and a 0.10 lead over the next
   candidate. This score is a matching heuristic, not a calibrated probability.
8. Recognized routes stay stable despite blank/noisy reads. A correction requires at
   least six strong observations, score >=0.95 and a >=0.20 lead over the incumbent's
   current evidence. Otherwise the route remains unchanged.
9. Before recognition the UI says Route Detecting...; after 20 seconds without a
   confident result it says Route Unknown. Later good evidence can still resolve it.

### Brief obstructions and departure confirmation

`departure_confirm_seconds` in `config/routes.json` defaults to **5 seconds**; set it
to `3` and restart Flask for a shorter grace period. When a person temporarily hides
the vehicle, its session, confirmed route, occupied polygon and running timer remain.
An observed detection gap of at least five seconds clears the session. Confirmation
is evaluated on processed frames, so slow inference can delay the visible change.
Sample-video rewinds still explicitly clear sessions because they start a new replay.

Transient changes in vehicle class or a non-overlapping box also require five seconds
of consistent replacement evidence before starting a new session. Pending replacement
frames cannot submit OCR into the previous vehicle's route. Reacquiring the original
vehicle before the grace period ends preserves its timer and clears that candidate.
Unreadable OCR alone never erases an already confirmed route during the same session.

This update changes `config/routes.json`, `route_recognition.py`, `occupancy.py`,
`ocr_worker.py`, `detector.py`, `app.py`, `scripts/test_sample_ocr.py`,
`tests/test_ocr.py` and this document. It adds no dependencies or database changes.

An occupancy UUID binds every OCR job/result to a bay session. A confirmed 5-second
absence clears the session. A sustained disjoint vehicle box also starts a new session.
Late results from an older UUID are rejected. Sample-video rewinds explicitly reset
sessions, preventing the previous loop's route from carrying into a new loop.

The route list currently contains editable starter mappings **Panabo - Tagum** and
**Panabo - Davao**, with destination-only aliases TAGUM/DAVAO. These treat Panabo as
origin context; OCR only supplies the text actually read. Replace/approve these mappings
before terminal deployment. Ambiguous aliases are not automatically resolved.

## Public displays and timing

- `/public-view`: passenger table with BAY / ROUTE / VEHICLE / STATUS / TIME.
- Repeated extra destination-sign text appears beside the main route, for example
  **Panabo → Davao · MA-A · NCCC** when those names are actually read. No secondary
  destination configuration is required. The previous Ma-a-only list has been removed;
  the main Panabo/Davao/Tagum route mappings remain configured as before.
  The worker preserves each OCR line's own confidence and rectangle. Extra labels
  require at least 0.85 line confidence and three matching sampled frames within 30
  seconds. They must be beside the main sign at its height or just beneath it; upper
  windshield branding, common service/slogan text and fleet/plate numbers are filtered.
  The same name repeated in one frame gets only one vote. Punctuation variants such
  as MA-A / MA A / MAA are deduplicated; the spelling displayed comes from OCR, and
  uppercase acronyms such as NCCC remain uppercase. Multiword names remain together.
  Main-route words are removed from extra labels. A main route must be confirmed
  before any extras are published. Details survive blank reads and short obstructions,
  and clear on route correction or occupancy-session reset.
  The bay API exposes these labels in `routeDetails`; the driver map keeps its main
  route label. No dependencies or database changes were added for secondary destinations.
  This is a text-and-position heuristic, not a geographic destination classifier:
  repeated OCR errors or unrelated text in the same sign band can still appear. Text
  outside the crop/band, below the confidence threshold, or on a scrolling sign without
  three repeated complete readings may be missed. It does not invent unseen destinations.
- `/signage`: existing driver map, with route, loading timer and departure status.
- Both open in a new tab from the lower sidebar action area, before admin authentication
  checks, and can be opened directly on another display using the same local server.
- Both poll `/api/bays` every second, as does the admin view. They do not run independent
  loading countdowns. Minor differences of one polling interval between screens are
  possible; timers cannot accumulate independent clock drift.
- Available means no active vehicle. Boarding means positive remaining time. At exactly
  zero the public wording is Departing. Beyond zero it is Delayed; admin remains Overstaying.
  Public delayed timers stay at 00:00 while the admin can show elapsed overstay time.
- Failed polling preserves the last snapshot with a prominent stale-data message.
- Public pages show no raw OCR text, candidate scores, admin UI, or debug panel.

The existing effective loading limit remains 900 seconds. This feature centralizes that
policy without connecting the earlier browser-only Settings controls to the backend.

## Exact run commands (PowerShell)

Run from `D:\Documents\CAPSTONE\app`. Stop any existing backend before starting a
second instance on port 5000. A working backend/frontend were left running after testing.

```powershell
Set-Location D:\Documents\CAPSTONE\app
# Only needed on a fresh setup:
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
npm.cmd ci

# Backend, including the existing sample-video detection loops:
$env:TERMINALSIGHT_DISABLE_AI = '0'
$env:PYTHONIOENCODING = 'utf-8'
$env:YOLO_CONFIG_DIR = "$PWD"
$env:YOLO_AUTOINSTALL = 'false'
.venv\Scripts\python app.py
```

Second terminal:

```powershell
Set-Location D:\Documents\CAPSTONE\app
npm.cmd run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173/public-view` and `http://127.0.0.1:5173/signage`.
An admin login is not required on either public page. Sign out/in after a backend
restart before using authenticated CSV or debug endpoints, because export tokens reset.

## Tests and sample diagnostics

```powershell
.venv\Scripts\python -m unittest discover -s tests -v
node --experimental-strip-types --test tests/notifications.test.mjs tests/public-display.test.mjs
npm.cmd run build
git diff --check

$env:YOLO_CONFIG_DIR = "$PWD"
$env:PYTHONIOENCODING = 'utf-8'
.venv\Scripts\python scripts/test_sample_ocr.py --samples 16
```

The sample script writes raw/normalized OCR, candidate, route confidence, session/bay,
support count and processing time to `docs/ocr-evidence.local/sample-results.json`,
plus the initial sign crops. This ignored local directory is for development only.
The script samples video timestamps rather than changing the running server's state.

For live admin-only debugging, set `TERMINALSIGHT_OCR_DEBUG=1` before starting Flask.
Sign in through `/api/login` and send the returned `export_token` as a Bearer token to
`GET /api/ocr/debug`. Without the flag the endpoint returns 404; without a valid login
it returns 401. `/api/bays` never includes raw OCR debug information.

Manual checks: open both public tabs with the admin tab closed, confirm automatic
updates, compare timers with admin, and verify route clearing when a vehicle departs
or a sample video loops. Test server disconnection to see the stale-update message.
The automated fixtures verify Departing/Delayed boundaries without waiting 15 minutes.

## Validation and limitations observed

- Dynamic secondary-label update: 36 Python tests and 7 frontend/notification tests
  passed; TypeScript/Vite production build passed (existing large-bundle warning).
  The 16-sample-per-camera video test recognized the bus's MA-A text dynamically at
  3 seconds, without a configured secondary destination, and retained it on the next
  ten associated observations. Upper windshield slogans were not published. The UV
  retained its Davao route and published no spurious extra labels in the sampled window.
  NCCC and multiple unlisted names passed controlled OCR-line and public-rendering
  fixtures; this is not a claim that NCCC was seen in the supplied videos.
- Dynamic label tests cover unlisted acronyms/multiword names, confidence/position
  filtering, per-frame deduplication, evidence expiry, main-word removal, route correction
  and departure cleanup. Public View tests render multiple extra names together.
- Actual local OCR model initialization and inference succeeded on Python 3.14.
- Both public URLs and the new bay API returned 200 through Vite.
- Both annotated MJPEG streams remained operational with OCR enabled.
- In the sampled first 22.5 video seconds, the bus produced 13 associated OCR observations:
  Davao was published on the third observation and remained recognized on the next 10.
- Before the focused-crop update, none of the 15 UV observations in the first 22.5
  seconds published a route. With the focused/stretched crop, the same sampled window
  recognized Davao at 4.5 seconds, with 12 recognized observations through the end
  of the sampled window. A missed detection at
  21 seconds did not reset the route/session on reacquisition at 22.5 seconds.
  Some individual reads are still incorrect; temporal aggregation remains essential.
  These are sample-video timestamps, not a promised real-time recognition latency.
- Only the existing Bay 1 and Bay 6 polygons have real detector coverage. The other
  bays retain their existing available placeholders; configure cameras/polygons before
  relying on them operationally.
- The supplied clips show static windshield signs, not a validated scrolling LED sign.
  Fragment aggregation passed synthetic sequence tests; real LED refresh/flicker, glare,
  perspective and scrolling speed still require footage-specific calibration.
- CPU-only testing (no CUDA) measured up to about 3.9 seconds per sampled YOLO+OCR job
  while the live detector was also running. Work is bounded/asynchronous, but this is
  not a production performance benchmark.
- Vehicle association uses bay overlap and box continuity, not a trained sign detector
  or full identity/re-identification tracker. Occlusions and overlapping replacement
  vehicles remain a limitation. Crop regions may need camera-specific tuning.
- Screens were checked through component rendering tests, not a completed interactive
  browser/TV visual inspection. Test final readability on the actual terminal display.
- The existing frontend large-bundle warning remains; no new frontend packages were added.
