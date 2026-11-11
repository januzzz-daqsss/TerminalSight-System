# ThinkPad transfer and pre-deployment checks

Prepared from the desktop workspace on `feature/camera-zones-modes`. Checkpoint 2B
and earlier Camera Zones changes remain uncommitted. **Cloning or pulling GitHub
will not transfer this working version.** No commit, push, deployment, database copy
or transfer was performed while preparing this guide.

## Copy the current working version

Use a separate destination folder on the ThinkPad; do not overwrite an existing
working installation or its database. Stop Flask before privately copying SQLite
files so the database and any journal/WAL files form a consistent snapshot. Keep
the desktop originals intact. Preserve relative folder names, spaces and spelling.

Copy the current source tree, including untracked source:

- `app.py`, `backend/`, `src/`, `api/`, `server/` if present, `tools/`, `tests/`.
- `config/roi/`, `config/routes.json`, other non-secret project configuration.
- `package.json`, `package-lock.json`, `requirements.txt`, `requirements-export.txt`,
  `index.html`, `tsconfig.json`, `vite.config.ts`, `vercel.json`, `.vercelignore`,
  `.gitignore`, `AGENTS.md`, `.agents/skills/`, and supporting `docs/`/`scripts/`.
- Public application assets and recordings listed below, plus trained weights.

A full private workspace copy can preserve `.git` and the current branch/history;
exclude `.venv/`, other virtual environments, `node_modules/`, generated `dist/`,
Python caches, logs, temporary diagnostics, `.vercel/`, and archive/report folders.
Recreate dependencies on the laptop. If omitting `.git`, the copy is a runnable
snapshot, not a Git checkout. Do not use Git clean/reset to prepare the copy.

## Recordings to transfer separately from Git

All seven recordings below exist locally and are currently ignored and untracked.
The five CCTV recordings total about 256 MB; the two legacy recordings add 307 MB.

| Path | Required use |
| --- | --- |
| `public/sample-CCTV/Bays 1-2.mp4` | Checkpoint 2B integrated preview pilot |
| `public/sample-CCTV/Bays 1-3.mp4` | Ordinary sample playback |
| `public/sample-CCTV/Bays 2-5.mp4` | Static ROI playback, Bays 3–5 |
| `public/sample-CCTV/Bays 4-7.mp4` | Ordinary sample playback |
| `public/sample-CCTV/Bays 6-10.mp4` | Static ROI playback, Bays 6–10 |
| `public/sample-videos/sample-VID_20260604_131402.mp4` | Original Northbound Cam 1 operational worker |
| `public/sample-videos/sample-VID_20260604_133427.mp4` | Original Southbound Cam 1 operational worker |

Keep both legacy recordings for the normal two-worker startup. The CCTV files
were decoded at 2304×1296; the legacy recordings are 1920×1080. Original HEVC
recordings may not play natively in every browser; the backend MJPEG path decodes
through OpenCV. Do not transcode or overwrite originals as part of this transfer.

## Model and ROI assets

Required custom YOLO weights: `trained_models/yolov8n/best.pt` (about 6.2 MB).
The code uses this custom bus/uv checkpoint, not the generic `yolov8n.pt`.
For AMD tests also preserve `trained_models/yolov8n/AMD/best.onnx` (about 12.2 MB).

Inspection found these YOLO assets **already tracked**, despite the newer ignore
patterns: `best.pt`, `yolov8n.pt`, `AMD/best.onnx`, plus Intel export files. Ignore
rules do not remove already-tracked assets. No Git index/history changes were made.
Intel export files do not mean Intel GPU selection is implemented.

If demonstrating all model choices, privately copy the complete following folders
including metadata and class names. Their large weights/AMD exports are ignored:

- `trained_models/fasterrcnn_resnet50_fpn/`: `best.pth` and `AMD/best.onnx`.
- `trained_models/ssd300_vgg16/`: `best.pth` and `AMD/best.onnx`.

The three schema-1 ROI JSON files currently exist but remain **untracked**:

| ROI JSON | Associated recording | Bays |
| --- | --- | --- |
| `config/roi/bays-1-2.json` | `public/sample-CCTV/Bays 1-2.mp4` | 1, 2 |
| `config/roi/bays-2-5.json` | `public/sample-CCTV/Bays 2-5.mp4` | 3, 4, 5 |
| `config/roi/bays-6-10.json` | `public/sample-CCTV/Bays 6-10.mp4` | 6–10 |

Copy them unchanged. Their relative recording paths, dimensions and bay directions
are validated; do not rename recordings without preparing a matching mapping.
Add/Edit Feed selects existing ROI JSON; no remapping is necessary for these files.
Only the Bays 1–2 recording is enabled for integrated AI in Checkpoint 2B.

## Private state and secrets — never add to a commit

- `terminalsight.db`: local administrator password hashes and operational records.
  Transfer privately only if preserving the current administrator account/data is
  intended. Keep it at the project root. Do not reset it or replace an existing
  laptop database without a separate backup and explicit decision.
- `config/camera-feeds.local.sqlite3`: saved feeds, ROI selections, legacy display
  metadata, and possibly private camera addresses. Copy privately to retain the
  current grid, or recreate feeds through local Add Sample Feed.
- `config/detection.local.json`: machine-specific selected model/device. Prefer
  not copying a desktop AMD preference to an untested laptop. In a new installation
  with no saved preference, the app defaults to YOLO CPU. If a laptop preference
  already exists, keep it and choose CPU through AI Detection for initial testing.
- Real `.env` files, credentials, Supabase service-role/database secrets, SMTP
  passwords, tokens, camera credentials, private logs and `.vercel/` linkage must
  not be committed. Do not paste their contents into screenshots or reports.

Local login does not need Supabase settings. The existing `.env.demo` selects the
hosted demo build; use ordinary `npm run dev` for local Flask operation. `.env.example`
contains hosted-auth placeholder keys, not the laptop's local admin credentials.
SMTP OTP/password-reset email needs `TERMINALSIGHT_SMTP_PASSWORD` in the backend
process environment and internet access. Backend code reads that environment
variable directly; do not assume creating a `.env` file loads it automatically.
Normal local sign-in and monitoring do not require sending an email.

## Windows dependencies and startup

Desktop versions inspected: **Python 3.14.4 (64-bit), Node.js 22.22.2**.
Use matching versions for the first laptop setup where possible. Install packages
while internet access is available, before the defense; do not copy the desktop
virtual environment or `node_modules` as a substitute for installation.

Run in the copied project root:

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pip check
npm.cmd ci
npm.cmd run build
```

`requirements.txt` includes Flask, flask-cors, OpenCV, Ultralytics, Shapely, NumPy,
PyTorch and Torchvision, plus pinned RapidOCR/ONNX Runtime. Most Python packages
are not pinned; a fresh install can resolve different versions. Desktop versions
observed during testing were:

| Package | Installed version |
| --- | --- |
| flask / flask-cors | 3.1.3 / 6.0.5 |
| opencv-python | 5.0.0.93 |
| ultralytics | 8.4.163 |
| shapely / numpy | 2.1.2 / 2.5.3 |
| torch / torchvision | 2.14.0 / 0.29.0 |
| rapidocr | 3.9.2 |
| onnxruntime-directml | 1.24.4 |

These are an inspected reference, not a complete dependency lock. Resolve any
wheel/version mismatch before the defense; do not replace working dependencies
blindly. `requirements-export.txt` is optional for re-exporting models and is not
needed merely to run the copied weights.

On Windows use the DirectML distribution selected by requirements. Never install
both `onnxruntime` and `onnxruntime-directml` into the same environment. Start with
YOLO CPU; do not assume the ThinkPad supports the desktop's AMD adapter setting.
Intel GPU integration remains unavailable. NVIDIA acceleration needs a compatible
CUDA-enabled PyTorch installation and is not guaranteed by the ordinary install.

RapidOCR 3.9.2 contains the three ONNX models the application explicitly loads:
`PP-OCRv6_det_small.onnx`, `PP-OCRv6_rec_small.onnx`, and
`ch_ppocr_mobile_v2.0_cls_mobile.onnx`. Verify the package installation includes
them. The operational OCR loader fails clearly if missing; it does not download
models automatically. Checkpoint 2B itself does not add OCR to the pilot feed.

Start backend and frontend in separate PowerShell terminals, from the project root:

```powershell
.\.venv\Scripts\python.exe -B app.py
```

```powershell
npm.cmd run dev
```

Use the URL Vite prints (normally `http://localhost:5173`). Flask uses port 5000.
Stop an existing server before starting another instance. `-B` prevents bytecode
writes; it is not an AI/GPU enable flag. Local Vite proxies API calls to Flask.
Do not expose Flask publicly or change LAN/network access for this checkpoint.

## Defense rehearsal

1. Compare copied file sizes and, for critical assets, SHA-256 on both machines:
   `Get-FileHash -LiteralPath 'trained_models/yolov8n/best.pt' -Algorithm SHA256`.
   Repeat for the pilot video and ROI JSON. No hashes or secrets need publication.
2. Sign in with the intended local administrator account. Verify both original
   previews, operational timers, and local OCR status using the copied recordings.
3. Select YOLOv8 / CPU in AI Detection. Open Camera Zones → Sample Demonstration.
4. Add or edit Bays 1–2, choose `bays-1-2.json`, save, then click Monitor recording.
   AI starts automatically; check boxes, occupancy colors and the separate AI rate.
5. Test pause, seek, resume, restart, loop, fullscreen, Stop and leaving the page.
6. Confirm other ordinary recordings still play and both public display routes
   remain accessible. Verify hosted demo isolation separately using the demo build.
7. Rehearse with network disconnected after installation. SMTP email and hosted
   Supabase login remain internet-dependent; local monitoring should not depend on them.

The desktop CPU smoke check produced 75 JPEGs in five seconds and 3.8 successful
AI updates/second. This is backend output, not browser-delivered FPS, and does not
predict ThinkPad/GPU performance. Do not present smoothness or accuracy as verified
until the laptop browser rehearsal passes. No multi-camera AI or pilot OCR is enabled.
