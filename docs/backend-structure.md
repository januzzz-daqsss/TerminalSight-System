# Backend organization

The root `app.py` is a guarded launcher. Keep using:

```powershell
.\.venv\Scripts\python.exe -B app.py
```

Start the frontend separately with `npm.cmd run dev`. The existing `npm.cmd run
start` command also uses this launcher; its `python` command must resolve to the
project virtual environment.

| Location | Responsibility |
| --- | --- |
| `backend/server.py` | Existing Flask routes, database initialization, camera loop and startup |
| `backend/paths.py` | Repository paths for the database, configuration, models and sample videos |
| `backend/cameras/camera_inference.py` | Bounded asynchronous inference |
| `backend/detection/` | Vehicle-to-bay assignment, model adapters, shared runtime and AMD child process |
| `backend/ocr/` | OCR worker, route recognition and extra destinations |
| `backend/state/` | Occupancy sessions and system health |

Frontend files remain in `src`. Scripts, tests and notebooks retain their existing
folders. Configuration, the operational SQLite database, trained weights and
sample videos have not moved. Resource paths are anchored to the repository,
independent of the current working directory. RapidOCR continues to read its
models from its installed package.

Import backend modules by their full package names, for example
`from backend.detection.detection_runtime import runtime`. The API and camera
detector share that one runtime. Package initializers do not import the server
or load models. DirectML sessions remain inside disposable spawned processes;
the root launcher calls `freeze_support()` under its main guard.

Importing `app` or `backend.server` does not initialize SQLite or start workers.
`backend.server.main()` initializes the database, starts the detector and camera
workers unless `TERMINALSIGHT_DISABLE_AI=1`, then starts Flask. API tests load the
server implementation, assign a temporary `DB_FILE`, and explicitly call
`init_db()` before making requests. Never initialize the operational database
just to inspect routes or run a test.

Validation commands remain in `AGENTS.md`. `tests/test_backend_startup.py` also
checks imports from another working directory, spawn-style launcher imports,
shared runtime identity, resource paths and startup wiring. These automated
checks do not replace actual camera and GPU validation.

## Reorganization validation (November 9, 2026)

- 67 backend tests and 9 frontend tests passed; TypeScript and the production
  build passed. The existing large JavaScript chunk warning remains. Build output
  was written to a temporary directory to preserve the existing `dist`.
- The root launcher was exercised through an isolated HTTP harness with temporary
  SQLite databases and detector settings on CPU and AMD/DirectML. Both sample
  streams produced decodable JPEGs, Bay 1 and Bay 6 remained occupied with stable
  sessions and advancing timers, and authenticated detection settings and CSV
  export responded correctly. The harness used an available local port and
  stopped its own camera workers afterward.
- Six-second observation windows counted 150/150 CPU and 151/150 AMD preview
  updates. These are produced previews, not measured browser FPS. OCR was Ready;
  AMD recognized both routes. CPU recognized southbound, while northbound was
  still Detecting at the short check cutoff.
- The real SSD/Faster R-CNN AMD switching check passed under concurrent inference,
  including deliberate termination of its private child and CPU recovery.
  YOLO AMD initialization was covered by the HTTP/sample-video harness.
- `npm.cmd run dev` served the application and both public-screen entry routes.
  Public display rendering and timer states were checked by frontend tests;
  a new interactive browser walkthrough was not performed.
- Read-only SQLite connectivity and `quick_check` passed. Checksums confirmed all
  236 protected database, configuration, model, video, frontend, notebook, build
  and archive files were unchanged. Imports, script CLI entry points, the module
  dependency graph, and Git whitespace/status checks were reviewed.

CUDA was unavailable, so NVIDIA execution was not tested. Intel support remains
unimplemented. Real RTSP cameras, real scrolling LED footage and prolonged
operation were not validated by this reorganization check.
