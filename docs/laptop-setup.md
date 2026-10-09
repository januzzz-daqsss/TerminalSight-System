# Continue on another Windows laptop

This branch contains the completed multi-model runtime, AMD isolation/recovery,
training/evaluation updates, and saved manuscript results. Intel device selection
is not enabled yet; test on CPU first. Use your laptop GPU model name when planning
Intel support. DirectML currently targets adapter 0, not automatic vendor selection.

## Get the code into a fresh folder

```powershell
git clone --branch codex/multi-model-amd-integration https://github.com/januzzz-daqsss/TerminalSight-System.git TerminalSight
cd TerminalSight
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm.cmd ci
```

The desktop was tested with 64-bit Python 3.14. Existing environments containing
`onnxruntime` should uninstall it before installing Windows requirements, which
use `onnxruntime-directml`. Do not install both distributions together.

## Copy local assets from the desktop

Cloning does not include ignored large assets. Copy these paths into identical
locations in the new project (retain both checkpoint and ONNX for each model):

- `trained_models/fasterrcnn_resnet50_fpn/best.pth`
- `trained_models/fasterrcnn_resnet50_fpn/AMD/best.onnx`
- `trained_models/ssd300_vgg16/best.pth`
- `trained_models/ssd300_vgg16/AMD/best.onnx`
- `public/sample-videos/sample-VID_20260604_131402.mp4`
- `public/sample-videos/sample-VID_20260604_133427.mp4`

The small model metadata and test metrics are versioned. Existing YOLO weights
and exports are already versioned. Do not copy `.venv`, `.venv-amd`, `node_modules`,
`dist`, caches or the desktop's `config/detection.local.json`; install dependencies
locally and start with CPU. Configure email credentials separately if email OTP
is needed. Local runtime remains offline after installation and asset transfer.
The repository already tracks `terminalsight.db`; do not overwrite a laptop's
existing operational database without backing it up.

## Run

First terminal:

```powershell
.\.venv\Scripts\python.exe -B app.py
```

Second terminal:

```powershell
npm.cmd run dev
```

Open the URL printed by Vite. Log in and check Camera Zones on CPU. Missing models
appear unavailable. Select a GPU only after confirming which physical adapter it
uses on the laptop. See `detection-models.md` for runtime details and export tools.

## Verification

```powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p "test_*.py" -v
npm.cmd run build
```

Preserved desktop sample validation summaries are in `docs/validation/amd-2026-10-04`.
These are short functional checks, not full accuracy or long-running benchmarks.
