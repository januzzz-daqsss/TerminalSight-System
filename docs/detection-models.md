# Local detection algorithms

Camera Zones > AI Detection changes the algorithm and device for both sample
camera workers. It uses the existing administrator login token (8-hour expiry;
password changes invalidate it). GET/POST `/api/detection` require that token.
POST accepts only `{ "model": "ssd300_vgg16", "device": "cpu" }` or the
other advertised available model/device IDs. Arbitrary paths are not accepted.

Models: `yolov8`, `fasterrcnn_resnet50_fpn`, `ssd300_vgg16`.
Devices: CPU and NVIDIA CUDA when available in the installed PyTorch runtime.
AMD DirectML is supported for all three bundled ONNX exports on Windows. It uses
the default graphics adapter (device 0, verified as RX 580 on this desktop).
Intel selection remains unavailable. CPU is always
available. A model must load and warm up successfully before activation.

The selected model is loaded from local weights and warmed up before activation.
Inference pauses during switching; video playback remains independent. The old AMD
worker exits before another loads. Failed AMD switches recover the previous
algorithm on CPU. Concurrent switch requests are rejected. Inference is serialized across the camera workers.
Selection is saved atomically in ignored `config/detection.local.json` and restored
on restart. Unusable saved settings fall back to YOLO CPU with a status warning.
The runtime starts on YOLO CPU when no settings exist. Switching preserves active
occupancy sessions, timers and OCR aggregation, subject to subsequent detections
and the existing departure grace period. Confidence stays at 0.50 and the existing
bay-overlap rule stays unchanged. This is a global selection, not per-camera.

## Installed files and copying to another computer

The v18 models come from `TerminalSight_trained_models (1).zip` and are installed:

```
trained_models/fasterrcnn_resnet50_fpn/best.pth
trained_models/ssd300_vgg16/best.pth
```

Metadata, class names and test metrics are retained alongside each checkpoint.
Checkpoint SHA-256:

- Faster R-CNN: `1cdcbb7123910a005ac6f07ca2c4bd6fd4c2d4c14d19865eab6c2423c0920970`
- SSD300: `c28f65843ba0ba05bb5839faba3e029c2b083bc69533157799d3e0a8a26888e0`

The large `.pth` files are ignored by Git. Copy these two folders from the ZIP
into `trained_models` on another computer; cloning alone will not supply weights.
Missing weights are shown as unavailable in the selector. Do not replace YOLO's
`trained_models/yolov8n/best.pt`. The checkpoint loader uses `weights_only=True`,
validates architecture/classes, and uses strict state-dict loading. No pretrained
model weights are downloaded by the Torchvision adapters.

Runtime preprocessing matches v18: BGR frames are stretched to 416x416, converted
to RGB float tensors in [0,1], then processed by each model's internal transform.
Faster R-CNN uses the checkpoint's 416 resize settings; SSD retains 300x300. Boxes
are mapped back to the original camera frame before Shapely occupancy and OCR
cropping, preserving the existing high-resolution OCR source.

## Run and check

```
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe app.py
```

In another terminal: `npm.cmd run dev`. Log in, open Camera Zones, open AI
Detection, choose an available model/device, Apply, then check both feeds, bay
occupancy, OCR scan regions, passenger view and timers. Reopen the dialog to read
active settings; restart the backend to confirm persistence. If an old browser
token was invalidated by a server restart, sign in again.

CPU inference may be slower than the reported Colab T4 results. GPU acceleration
requires a compatible driver and CUDA-enabled PyTorch installation; standard
package installation alone does not guarantee GPU availability. The selector
reports actual CUDA availability. The existing sample-video and camera-zone
configuration behavior is otherwise unchanged; RTSP setup is not expanded here.

Validation: Python runtime/API unit tests, TypeScript/Vite build, and direct local
checkpoint inference. These do not substitute for benchmarking the deployed GPU.

## AMD setup and smoother previews (October 4, 2026)

The working `.venv` now uses `onnxruntime-directml==1.24.4` instead of the CPU-only
ONNX Runtime distribution. Do not install both distributions into the same venv:
they share the `onnxruntime` import. Windows requirements select DirectML; other
platforms retain the CPU package. Existing Windows installations should uninstall
`onnxruntime` before installing the updated requirements.

Restart the backend using `.venv\Scripts\python.exe -B app.py`, refresh the
frontend, and select Camera Zones > AI Detection > YOLOv8 > AMD / DirectML > Apply.
The temporary `.venv-amd` testing environment has been removed. Use `.venv` for all tests and the full app.

DirectML uses `trained_models/yolov8n/AMD/best.onnx`, class names bus/uv, fixed
512x512 letterboxing and class-wise NMS. Boxes are mapped back to source pixels.
The ONNX and current YOLO checkpoint metadata both reference SlotSight_Master-9;
this is distinct from the v18 Faster R-CNN and SSD dataset. Do not interpret these
runtime comparisons as a controlled accuracy comparison among all three models.
CPU fallback for unsupported ONNX nodes may occur. Default adapter selection is
not automatic AMD hardware discovery on computers with multiple GPUs.

Playback follows the source video clock. One inference job per camera runs
separately, at up to 10 observations/second, without a growing frame queue. Old
results are discarded when a sample loops. OCR receives the full source image;
only the browser JPEG is reduced to 960 pixels wide at quality 80. Overlays use
the latest completed detection, so they may trail motion slightly. Existing
occupancy grace periods and route aggregation remain in place.

Measured smoke check: both sample camera workers produced 149 preview updates in
six seconds (~25 FPS each), with correct Bay 1 UV and Bay 6 bus occupancy. This
measures produced previews, not browser-delivered FPS. The local OCR engine also
read DAVAO after the runtime replacement. These are functional checks, not a
formal long-duration performance benchmark.

Concurrent OCR check: 295 northbound / 294 southbound preview updates in 12 seconds
(~24.5 FPS per camera). OCR was Ready; both routes recognized Panabo - Davao, with
MA-A additionally recognized on the southbound bus. Frontend build and 59 Python
tests passed (58 in the full run plus the new DirectML postprocessing test).

## Faster R-CNN and SSD on AMD (October 4, 2026)

All three algorithms now support the AMD/DirectML option. Restart the backend and
refresh Camera Zones, select the desired algorithm and AMD/DirectML, then Apply.
No retraining is required. Files installed locally:

- `trained_models/fasterrcnn_resnet50_fpn/AMD/best.onnx`
- `trained_models/ssd300_vgg16/AMD/best.onnx`

These large files are ignored by Git; copy them alongside the original `.pth`
checkpoints on other PCs. Metadata validates architecture, class map, preprocessing
and checkpoint SHA-256 to reject mismatched exports. Missing exports disable the
AMD option for that model. Loading and warmup failures retain CPU selections or recover an AMD selection on CPU.

The export includes each model's resize, box decoding and NMS. Input uses the same
416-square RGB stretch as the PyTorch adapter; SSD internally resizes to 300. Model
outputs are converted back to full camera coordinates for parking and OCR.

Both exports matched their CPU counterparts on six sample frames (0, 5, 10 seconds
from each video), with matching classes/counts and matched box IoU above 0.99999.
ONNX Runtime profiling confirmed DirectML nodes for both, alongside CPU nodes.
This is hybrid execution, not a claim that every operation is on the GPU.
Observed post-first-frame inference ranges: SSD ~32–56 ms; Faster R-CNN ~108–181 ms.
Profiling was enabled; these are indicative sample timings, not benchmark results.
The first frame is slower due to warmup. Video preview FPS is independent of
inference throughput; slower models update occupancy/overlays less frequently.

Recreate exports using the existing environment:

```powershell
.venv\Scripts\python.exe -m pip install -r requirements-export.txt
.venv\Scripts\python.exe -B scripts/export_amd_detectors.py ssd300_vgg16
.venv\Scripts\python.exe -B scripts/export_amd_detectors.py fasterrcnn_resnet50_fpn
.venv\Scripts\python.exe -B scripts/validate_amd_detectors.py ssd300_vgg16
.venv\Scripts\python.exe -B scripts/validate_amd_detectors.py fasterrcnn_resnet50_fpn
```

The optional exporter uses fixed-batch legacy ONNX export (opset 17) for compatibility
with these Torchvision detection models. Its trace warnings require keeping the
fixed input shape and validating outputs. No model weights are downloaded. JSON
validation reports and provider profiles are saved under `tmp/amd-check`.

Integrated eight-second checks with concurrent OCR: SSD produced 191/192 previews;
Faster R-CNN produced 199/200. Both maintained occupied Bay 1 and Bay 6, and OCR
remained Ready. SSD northbound was still Detecting at the short test cutoff; its
southbound route was recognized. Faster R-CNN recognized both routes plus MA-A.
These short checks do not guarantee identical OCR convergence between detectors.
60 Python tests passed; the TypeScript/Vite build and dependency check passed.

## Native driver crash recovery (October 9, 2026)

Windows Application events recorded access violations (0xc0000005) in
`amdxc64.dll` and `onnxruntime_pybind11_state.pyd` during the reported switching
failure. These are native faults, so Python exception handling alone cannot
protect the Flask process. The exact triggering driver operation is unconfirmed.

The application now creates DirectML sessions only in a spawned, disposable
worker process. AMD workers are stopped before loading another model; loading
and inference never overlap during a switch. A failed switch recovers the prior
algorithm on CPU, and a dead inference worker falls back to CPU without ending
the camera thread. The saved preference remains unchanged on failure; the dialog
shows the actual active device and recovery message. Detection briefly pauses
while loading/recovering, but playback runs independently. A system-wide GPU
reset or driver fault can still affect other applications; process isolation
cannot repair the driver itself.

The frontend now handles empty/non-JSON backend replies with a useful message.
63 Python tests and the frontend build passed, including a controlled child
process exit and CPU fallback tests. Hardware switching check:

```powershell
.venv\Scripts\python.exe -B scripts/check_amd_switch_recovery.py
```

This uses a temporary configuration and only terminates its own test worker.
Restart the real backend after these code changes:

```powershell
.venv\Scripts\python.exe -B app.py
```
