# Optional Intel Iris Xe inference

This is an optional YOLOv8 OpenVINO integration, pending actual ThinkPad GPU
verification. It is not a fix or performance guarantee for the earlier OCR
allocation failure. No packages are installed automatically.

## Supported paths

| Component | Intel option | Existing paths retained |
| --- | --- | --- |
| Custom YOLOv8 | OpenVINO GPU, fixed 512x512 ONNX | PyTorch CPU/CUDA, AMD DirectML |
| SSD300 / Faster R-CNN | Not enabled in this change | PyTorch CPU/CUDA, AMD DirectML ONNX |
| RapidOCR | Unchanged ONNX Runtime CPU | Existing local models and settings |

SSD/Faster R-CNN ONNX exports contain detection/NMS and variable-output operations.
Their existing DirectML validation does not establish OpenVINO GPU compatibility.
They require separate compile/output/hardware checks before enabling Intel. This
is a current application limitation, not a claim those architectures cannot run
on OpenVINO. RapidOCR could have a separate backend integration later; selecting
Intel detection here does not move OCR or video decoding to the GPU.

## ThinkPad preparation

Use the existing application environment. Keep its current `onnxruntime-directml`
installation; do not install another ONNX Runtime distribution alongside it.
The optional requirements add the OpenVINO runtime and the ONNX metadata parser.
Check package compatibility with the laptop's Python version using pip's dry run
before approving the install. Do not upgrade the working environment blindly.

```powershell
.\.venv\Scripts\python.exe --version
.\.venv\Scripts\python.exe -m pip install --dry-run -r requirements-intel.txt
# Run only after reviewing the dry-run changes:
.\.venv\Scripts\python.exe -m pip install -r requirements-intel.txt
.\.venv\Scripts\python.exe -m pip check
```

Copy the existing ignored `trained_models/yolov8n/AMD/best.onnx` alongside
`trained_models/yolov8n/best.pt` for CPU recovery. The ONNX file is backend-neutral
despite its historical AMD directory name. No export, retraining, download or
replacement of trained weights occurs. Preserve the three recordings, their ROI
JSON files and the separately transferred camera-feed database.

OpenVINO GPU discovery must identify an Intel GPU. The reported ThinkPad driver
32.0.101.7085 has not been tested here. Device discovery alone does not establish
driver/model compatibility. If multiple Intel GPUs exist, optionally set the
process environment variable `TERMINALSIGHT_INTEL_DEVICE` to an exact discovered
ID such as `GPU.0` before starting Flask. CPU/AUTO/HETERO values are rejected.
Otherwise the first discovered GPU ID is selected. Discovery is cached until
process restart; restart after installing optional packages or changing drivers.

## Verification before enabling operational GPU inference

Stop the backend yourself before running the standalone checker, to avoid loading
an extra model alongside monitoring. The checker never starts Flask, writes saved
settings, accesses SQLite, runs OCR or updates occupancy.

```powershell
.\.venv\Scripts\python.exe -B scripts/check_intel_detection.py --discover-only
.\.venv\Scripts\python.exe -B scripts/check_intel_detection.py --video "public/sample-CCTV/Bays 1-2.mp4" --frames 12
.\.venv\Scripts\python.exe -B scripts/check_intel_detection.py --video "public/sample-CCTV/Bays 2-5.mp4" --frames 12
.\.venv\Scripts\python.exe -B scripts/check_intel_detection.py --video "public/sample-CCTV/Bays 6-10.mp4" --frames 12
```

Require exit code 0, GPU-only `execution_devices`, and
`gpu_inference_completed: true` on the inference checks. Exit 2 means discovery
failed; exit 1 means inference/decoding/compilation failed. There is deliberately
no CPU fallback in this verification command. Timings include preprocessing,
interprocess transfer, inference and postprocessing, exclude warmup, and do not
measure browser FPS. Empty detections are honest results, not an accuracy pass.

Then start `.\.venv\Scripts\python.exe -B app.py`. In Camera Zones > AI Detection,
choose YOLOv8 and Intel GPU / OpenVINO, then Apply. The existing authenticated API
persists that choice on the ThinkPad only. Read GET `/api/detection` through the
signed-in UI: `device` must be `intel`, and `accelerator.execution_devices` must
contain GPU devices. Compare actual boxes/classes/occupancy with CPU on the same
recordings, then rehearse all three feeds and OCR through at least two loops of
the longest recording while observing memory. An iGPU shares system RAM; CPU
offload does not guarantee lower memory consumption or faster end-to-end operation.

## Isolation and fallback

All cameras retain the existing single shared runtime and bounded FIFO scheduling.
Intel uses one disposable spawned process, one compiled model, one stream and one
synchronous infer request. The same 512 letterboxing, bus/uv mapping, 0.50
confidence threshold and class-wise NMS are shared with DirectML. No tracking,
occupancy or OCR rules change. Native failures cannot directly terminate Flask
through this child, although system-wide driver failures remain possible.

Compilation and warmup must succeed before activation. A failed switch from CPU
keeps the current detector. An old GPU worker is closed before loading another;
a failed switch recovers the previous algorithm on CPU. An Intel inference failure
closes its worker and attempts PyTorch CPU recovery, visibly changing active
device/status. The saved preference is not overwritten by fallback. Missing CPU
weights or CPU load/allocation failure can prevent recovery; this is not concealed.
An unavailable saved Intel setting falls back to YOLO CPU on startup with a warning.

Keep CPU as the defense fallback until real ThinkPad verification passes. This
change does not prove SSD/Faster R-CNN Intel performance, scrolling LED recognition,
three-camera stability, or resolution of the prior memory failure.

## Development validation (November 14, 2026)

The backend suite ran 171 tests: 170 passed and one skipped, including 12 focused
Intel discovery, adapter, configuration and recovery tests. GPU compilation and
inference in those tests use fakes; controlled child-process failure tests exercise
process isolation. They do not establish actual Intel GPU compatibility.

The 41 selected frontend camera, demo, notification and public-display tests
passed with `--test-concurrency=1`. An earlier concurrent run failed in a native
frontend test process with a memory-allocation error; serial execution reduced
peak test-process load. Both local and demo production builds (including TypeScript)
and `git diff --check` passed. Saved detection settings, camera configuration and
the three operational ROI files remained byte-for-byte unchanged.

OpenVINO is not installed on the development desktop. The standalone discovery
check correctly returned unavailable (exit 2). Real Iris Xe inference, output
agreement, performance and sustained three-camera/OCR stability remain untested.

References: [OpenVINO GPU device](https://docs.openvino.ai/2026/openvino-workflow/running-inference/inference-devices-and-modes/gpu-device.html)
and [system requirements](https://docs.openvino.ai/2026/about-openvino/release-notes-openvino/system-requirements.html).
