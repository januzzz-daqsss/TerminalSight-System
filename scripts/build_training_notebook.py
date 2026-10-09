"""Build a self-contained Colab notebook from the versioned training script."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
cells = []


def markdown(text):
    cells.append({'cell_type': 'markdown', 'metadata': {}, 'source': text.strip() + '\n'})


def code(text):
    cells.append({'cell_type': 'code', 'execution_count': None, 'metadata': {},
                  'outputs': [], 'source': text.strip() + '\n'})


markdown('''
# TerminalSight — train Faster R-CNN and SSD-VGG16

Run each cell from top to bottom using its ▶ button. This notebook trains **Faster
R-CNN with ResNet-50-FPN** and **SSD300 with VGG16**, using the same Roboflow COCO
dataset. If your study requires another Faster R-CNN backbone, change the architecture
before training; checkpoints are architecture-specific.

**Upload:** the entire **COCO JSON dataset ZIP** from Roboflow, containing `train/`,
`valid/`, and preferably `test/`, their images, and `_annotations.coco.json` files.
Do not upload only a JSON file, a YOLO dataset ZIP, `best.pt`, or TerminalSight's codebase.
Both Bus and UV must have labeled examples in each split. Nested ZIP folders are supported.

**Before cell 1:** Runtime → Change runtime type → select a GPU (T4 if available) → Save.
Training uses Colab's NVIDIA GPU, not your computer's AMD card. GPU availability and
session duration are not guaranteed. Internet is needed for setup/pretrained weights;
the resulting files can later be used by the offline TerminalSight application.

Use the same dataset version/splits as YOLO for comparison. Keep related frames from
one recording in one split; this notebook only checks exact duplicates, not near-duplicates.
This revision starts a NEW 50-epoch manuscript-aligned experiment. Preserve your old
20-epoch outputs; do not resume them into this changed experiment. Both implementations
are Torchvision, NOT Detectron2. Correct that framework description in the manuscript.
Use Roboflow v18 COCO JSON (416x416) for this baseline; SSD300 still internally uses
300x300. 416 is not proven optimal: compare resolution on identical source images and
splits using validation data before final test evaluation. v17 and v18 have different
image counts, so comparing them alone does not isolate resolution. Stretch preprocessing
changes aspect ratios; preserve the chosen preprocessing consistently at deployment.
Roboflow augmentation is already baked into this export; extra online flipping is off.
Do not treat exported augmented siblings or nearby video frames as independent splits.
50 epochs is an experimental budget, not a promised accuracy. Validation chooses `best.pth`;
the test set is reserved for final evaluation.
''')
markdown('## 1. Install the evaluation package and check the GPU\nKeep Colab\'s matching PyTorch/Torchvision installation.')
code('''
%pip -q install pycocotools
import torch, torchvision, sys
print('Python:', sys.version.split()[0])
print('PyTorch:', torch.__version__, '| Torchvision:', torchvision.__version__)
assert torch.cuda.is_available(), 'Select Runtime > Change runtime type > GPU, then rerun this cell.'
print('GPU:', torch.cuda.get_device_name(0))
from torchvision.ops import nms
nms(torch.tensor([[0., 0., 10., 10.]], device='cuda'), torch.tensor([.9], device='cuda'), .5)
print('GPU and detection operators are ready.')
''')
markdown('## 2. Create the training program\nRun this whole cell once. You do not need to edit the long code.')
code('%%writefile /content/train_colab_detectors.py\n' + (ROOT / 'scripts/train_colab_detectors.py').read_text(encoding='utf-8'))
markdown('''
## 3. Connect Google Drive to keep checkpoints
Authorize your own Drive in Colab's dialog. Each new notebook session uses a new run
folder. To resume after disconnecting, set `RUN_NAME` below to your previous folder
name and rerun setup/upload/validation cells. Then change the relevant training cell
to `resume=True`. Do not change the dataset or architecture when resuming.
''')
code('''
from google.colab import drive
drive.mount('/content/drive')
from pathlib import Path
from datetime import datetime
import subprocess
RUN_NAME = 'v18_manuscript_' + datetime.now().strftime('%Y%m%d_%H%M%S_%f')
OUTPUT_ROOT = Path('/content/drive/MyDrive/TerminalSight/training') / RUN_NAME
OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
with (OUTPUT_ROOT / 'training_environment.txt').open('w') as target:
    subprocess.run([sys.executable, '-m', 'pip', 'freeze'], stdout=target, check=True)
print('SAVE THIS RUN NAME for resuming:', RUN_NAME)
print('Checkpoint folder:', OUTPUT_ROOT)
''')
markdown('''
## 4. Upload the COCO dataset ZIP
Click **Choose Files** when prompted and select the complete Roboflow ZIP from your
computer. For a large ZIP, upload it to Google Drive first, set `DRIVE_ZIP` to its
`/content/drive/MyDrive/...zip` path, and skip the browser upload. No Roboflow API key
is needed. Upload the dataset once; both models use it.
''')
code('''
from google.colab import files
DRIVE_ZIP = ''  # Optional: '/content/drive/MyDrive/terminalsight-coco.zip'
if DRIVE_ZIP:
    ZIP_PATH = Path(DRIVE_ZIP)
else:
    uploaded = files.upload()
    if len(uploaded) != 1 or not next(iter(uploaded)).lower().endswith('.zip'):
        raise ValueError('Choose exactly one COCO dataset ZIP.')
    ZIP_PATH = Path(next(iter(uploaded))).resolve()
    del uploaded
assert ZIP_PATH.is_file(), f'ZIP not found: {ZIP_PATH}'
print('Dataset ZIP:', ZIP_PATH)
''')
markdown('''
## 5. Extract and validate the dataset
Wait for this cell to finish. It checks images, boxes, class names, and exact duplicate
images across splits. If it reports an unexpected class, fix/confirm your annotation
labels before training. COCO category ID 0 is supported: the loader remaps by class name.

If it reports **Identical image occurs in both...**, set `REPAIR_EXACT_DUPLICATES = True`
at the top of this cell and rerun it. This creates a separate cleaned copy, retaining
test copies first, then validation, then training. It removes matching annotation
records with each duplicate image. Original ZIP/files are untouched. Conflicting
annotations stop the repair for manual review by default. To exclude every copy of
these ambiguous images, also set `EXCLUDE_CONFLICTING_IMAGES = True`. This may shrink
any split, including test; loss of a class or an empty split still stops the repair. A removal report
and cleaned ZIP are saved to your run folder in Drive. Use that same cleaned dataset
for both models and any new YOLO comparison; previous scores are not directly comparable.
''')
code('REPAIR_EXACT_DUPLICATES = True\nEXCLUDE_CONFLICTING_IMAGES = True\n\n' + (ROOT / 'scripts/repair_coco_splits.py').read_text(encoding='utf-8') + '''

import tempfile
from train_colab_detectors import extract_dataset, inspect_dataset
DATA_ROOT = extract_dataset(ZIP_PATH, Path(tempfile.mkdtemp(prefix='terminalsight_coco_')))
# Fail early if the uploaded export does not match the selected experiment.
import json, hashlib
from train_colab_detectors import find_splits
EXPECTED_EXPORT_SIZE = 416  # Use 640 only for a deliberately separate experiment.
for split, annotation_path in find_splits(DATA_ROOT).items():
    records = json.loads(annotation_path.read_text(encoding='utf-8-sig'))['images']
    dimensions = {(record['width'], record['height']) for record in records}
    assert dimensions == {(EXPECTED_EXPORT_SIZE, EXPECTED_EXPORT_SIZE)}, (split, dimensions)
if REPAIR_EXACT_DUPLICATES:
    cleaned = repair_dataset(DATA_ROOT, Path(tempfile.mkdtemp(prefix='terminalsight_clean_')),
                             conflict_policy='exclude' if EXCLUDE_CONFLICTING_IMAGES else 'error')
    inspect_dataset(cleaned)
    DATA_ROOT = cleaned
    shutil.copy2(cleaned / 'deduplication_report.json', OUTPUT_ROOT / 'deduplication_report.json')
    print('Saving the cleaned dataset ZIP to Drive for reuse/resume...')
    shutil.make_archive(str(OUTPUT_ROOT / 'cleaned_dataset'), 'zip', cleaned)
SPLITS = inspect_dataset(DATA_ROOT)
manifest = {}
from train_colab_detectors import CocoVehicles
for split, annotation_path in SPLITS.items():
    ds = CocoVehicles(annotation_path)
    manifest[split] = {'images': len(ds), 'boxes': dict(ds.counts),
                       'annotation_sha256': hashlib.sha256(annotation_path.read_bytes()).hexdigest()}
(OUTPUT_ROOT / 'dataset_manifest.json').write_text(json.dumps(manifest, indent=2))
print('Actual cleaned counts (use these in the manuscript):', manifest)
print('Data ready:', DATA_ROOT)
''')
markdown('## 6. Check the labels visually\nConfirm the boxes surround the correct buses and vans before proceeding.')
code('''
import matplotlib.pyplot as plt
from PIL import ImageDraw
from torchvision.transforms.functional import to_pil_image
from train_colab_detectors import CocoVehicles, CLASS_NAMES
preview = CocoVehicles(SPLITS['train'])
indices = [i for i, record in enumerate(preview.images) if preview.annotations[record['id']]][:3]
fig, axes = plt.subplots(1, len(indices), figsize=(6 * len(indices), 5), squeeze=False)
for axis, index in zip(axes[0], indices):
    tensor, target = preview[index]
    image = to_pil_image(tensor)
    draw = ImageDraw.Draw(image)
    for box, label in zip(target['boxes'].tolist(), target['labels'].tolist()):
        draw.rectangle(box, outline='lime', width=3)
        draw.text((box[0], box[1]), CLASS_NAMES[label], fill='red', stroke_width=1)
    axis.imshow(image); axis.axis('off')
plt.show()
''')
markdown('''
## 7. Set training options
Start with batch size **2**. If CUDA runs out of memory, use **1** and rerun the relevant
training cell with `resume=True` if a completed epoch was saved. A disconnect during
an epoch resumes from the previous completed epoch. No completed epoch means start
that model again with `resume=False`. Epochs means the total target, including resumed epochs.
''')
code('''
EPOCHS = 50
BATCH_SIZE = 2
SEED = 42
FRCNN_SIZE = 416  # For square v18 images; the FPN may pad tensors to stride boundaries.
DATASET_VERSION = 'Roboflow v18; stretch 416; 3 outputs; horizontal flip'
ONLINE_FLIP = False  # Export already includes augmented images.
CONFIDENCE = 0.50  # Prespecified P/R/F1 threshold; never tune on the test set.
MATCH_IOU = 0.50
MODELS = ('fasterrcnn_resnet50_fpn', 'ssd300_vgg16')
def run_training(model_name, learning_rate, optimizer, resume=False):
    output = OUTPUT_ROOT / model_name
    command = [sys.executable, '-u', '/content/train_colab_detectors.py',
               '--dataset', str(DATA_ROOT), '--model', model_name, '--output', str(output),
               '--epochs', str(EPOCHS), '--batch-size', str(BATCH_SIZE),
               '--lr', str(learning_rate), '--seed', str(SEED),
               '--frcnn-size', str(FRCNN_SIZE), '--optimizer', optimizer,
               '--dataset-version', DATASET_VERSION]
    if not ONLINE_FLIP:
        command += ['--no-online-flip']
    if resume:
        last = output / 'last.pth'
        assert last.is_file(), f'No completed epoch to resume: {last}'
        command += ['--resume', str(last)]
    subprocess.run(command, check=True)
''')
markdown('''
## 8. Train Faster R-CNN (ResNet-50-FPN)
The first run downloads pretrained COCO weights. The classifier is replaced for
background/Bus/UV. Watch training loss and validation mAP; wait until **Finished**.
''')
code("run_training('fasterrcnn_resnet50_fpn', learning_rate=0.002, optimizer='sgd', resume=False)")
markdown('## 9. Train SSD300 (VGG16)\nRun after Faster R-CNN finishes. Uses AdamW and StepLR; 0.0001 is a starting learning rate to validate, not an exact reconstruction of the old experiment. Internal input stays 300x300.')
code("run_training('ssd300_vgg16', learning_rate=0.0001, optimizer='adamw', resume=False)")
markdown('''
## 10. Review validation curves
`map_50` is mAP@0.50; `map_50_95` averages IoU 0.50 through 0.95. Values are fractions:
0.80 means 80%. The best checkpoint is selected by validation `map_50_95`, not training
loss and not test results. The two metrics are not interchangeable with your YOLO figure.
''')
code('''
import json
MODELS = ('fasterrcnn_resnet50_fpn', 'ssd300_vgg16')
fig, axes = plt.subplots(1, 3, figsize=(16, 4))
for model_name in MODELS:
    history = json.loads((OUTPUT_ROOT / model_name / 'history.json').read_text())
    for axis, key in zip(axes, ('train_loss', 'map_50', 'map_50_95')):
        axis.plot([row['epoch'] for row in history], [row[key] for row in history], label=model_name)
        axis.set_title(key); axis.set_xlabel('Epoch'); axis.legend()
plt.tight_layout(); plt.show()
''')
markdown('''
## 11. Final held-out test evaluation
Run when your model/hyperparameter choices are final. Do not tune on these test results.
If your ZIP has no test split, this cell reports that final evaluation is missing; it
does not reuse validation as test data.
''')
code('''
if 'test' not in SPLITS:
    print('No held-out test split. Re-export with a separate test split for final evaluation.')
else:
    for model_name in MODELS:
        checkpoint = OUTPUT_ROOT / model_name / 'best.pth'
        subprocess.run([sys.executable, '-u', '/content/train_colab_detectors.py',
                        '--dataset', str(DATA_ROOT), '--evaluate', str(checkpoint),
                        '--batch-size', str(BATCH_SIZE), '--confidence', str(CONFIDENCE),
                        '--match-iou', str(MATCH_IOU)], check=True)
        print(model_name, (checkpoint.parent / 'test_metrics.json').read_text())
''')
markdown('''
## 11b. Manuscript metrics, confusion matrices, and speed
P/R/F1 use prespecified confidence and IoU thresholds, score-ordered one-to-one
class-agnostic matching. Wrong classes count as an FP and FN. COCO AP is computed
separately with its standard class-wise matching and is not fixed-threshold precision.
Matrices use rows=true, columns=predicted, with background for unmatched detections
or labels (not a vehicle class or measured true negative). Report micro and macro
averages explicitly. All metric fractions are converted to percentages in CSV.
Timing uses batch 1, ten warm-up calls and three passes over the test set, with GPU
synchronization. It includes model resizing and postprocessing, but excludes disk I/O,
CPU-to-GPU transfer, OCR, tracking, and UI. FPS is 1000/mean_ms. Compare speed on the
same device and software; these are NOT complete TerminalSight pipeline FPS.
''')
code('''
import csv, numpy as np
if 'test' in SPLITS:
    rows = []
    for model_name in MODELS:
        result = json.loads((OUTPUT_ROOT / model_name / 'test_metrics.json').read_text())
        for group, metrics in {**result['per_class'], 'micro': result['micro'], 'macro': result['macro']}.items():
            rows.append({'model': model_name, 'class_or_average': group,
                         **{key + '_percent': 100 * metrics[key] for key in ('precision', 'recall', 'f1')},
                         'overall_map50_percent': 100 * result['map_50'],
                         'overall_map50_95_percent': 100 * result['map_50_95'],
                         'mean_ms': result['timing']['mean_ms'], 'fps': result['timing']['fps'],
                         'confidence': CONFIDENCE, 'iou': MATCH_IOU})
        raw = np.array(result['confusion_matrix'])
        normalized = raw / np.maximum(raw.sum(axis=1, keepdims=True), 1)
        fig, axes = plt.subplots(1, 2, figsize=(11, 4))
        for axis, matrix, title in zip(axes, (raw, normalized), ('Counts', 'Normalized by true class')):
            axis.imshow(matrix, cmap='Blues')
            axis.set_xticks(range(3), result['matrix_labels'], rotation=30)
            axis.set_yticks(range(3), result['matrix_labels'])
            axis.set_xlabel('Predicted'); axis.set_ylabel('True'); axis.set_title(title)
            for i in range(3):
                for j in range(3):
                    label = 'N/A' if i == j == 0 else (str(raw[i,j]) if title == 'Counts' else f'{matrix[i,j]:.2f}')
                    axis.text(j, i, label, ha='center', va='center', color='darkorange')
        fig.suptitle(model_name); fig.tight_layout()
        fig.savefig(OUTPUT_ROOT / model_name / 'confusion_matrix.png', dpi=180)
        plt.show()
    with (OUTPUT_ROOT / 'manuscript_metrics.csv').open('w', newline='') as target:
        writer = csv.DictWriter(target, fieldnames=list(rows[0]))
        writer.writeheader(); writer.writerows(rows)
    for row in rows:
        print(row)
else:
    print('No test split; no final metrics generated.')
''')
markdown('''
## 12. Download the model package
Downloads **TerminalSight_trained_models.zip** with both best checkpoints, class maps,
metadata, training source, history and any test metrics. The larger `last.pth` files
remain in Drive for resuming, and are intentionally excluded from the download.

Extract this ZIP locally and give Codex its path to integrate the models. These are
complete detection models, not only backbone weights. ONNX/OpenVINO exports and actual
AMD/Intel/NVIDIA runtime checks come next; this notebook does not claim those GPU paths
are already working. Never replace the existing YOLO `best.pt` with these checkpoints.
''')
code('''
import shutil
package = Path(tempfile.mkdtemp(prefix='terminalsight_models_'))
for model_name in MODELS:
    source = OUTPUT_ROOT / model_name
    destination = package / model_name
    destination.mkdir()
    for name in ('best.pth', 'metadata.json', 'history.json', 'train_colab_detectors.py'):
        if not (source / name).is_file():
            raise FileNotFoundError(f'Training output is incomplete: {source / name}')
        shutil.copy2(source / name, destination / name)
    if (source / 'test_metrics.json').is_file():
        shutil.copy2(source / 'test_metrics.json', destination / 'test_metrics.json')
    if (source / 'confusion_matrix.png').is_file():
        shutil.copy2(source / 'confusion_matrix.png', destination / 'confusion_matrix.png')
    (destination / 'class_names.json').write_text(json.dumps(CLASS_NAMES, indent=2))
shutil.copy2(OUTPUT_ROOT / 'training_environment.txt', package / 'training_environment.txt')
for name in ('dataset_manifest.json', 'deduplication_report.json', 'manuscript_metrics.csv'):
    if (OUTPUT_ROOT / name).is_file():
        shutil.copy2(OUTPUT_ROOT / name, package / name)
archive = Path(shutil.make_archive('/content/TerminalSight_trained_models', 'zip', package))
shutil.copy2(archive, OUTPUT_ROOT / archive.name)
print('Backup in Google Drive:', OUTPUT_ROOT / archive.name)
files.download(str(archive))
''')
markdown('''
## References and local validation
- [Torchvision detection fine-tuning](https://docs.pytorch.org/tutorials/intermediate/torchvision_tutorial.html)
- [Faster R-CNN](https://docs.pytorch.org/vision/stable/models/generated/torchvision.models.detection.fasterrcnn_resnet50_fpn.html)
- [SSD300-VGG16](https://docs.pytorch.org/vision/stable/models/generated/torchvision.models.detection.ssd300_vgg16.html)
- [Colab FAQ](https://research.google.com/colaboratory/faq.html)

The notebook has no saved training results. Local checks cover dataset handling,
notebook syntax and model construction/inference. Your actual dataset training and
accuracy must be validated in your Colab GPU session.
''')

if __name__ == '__main__':
    destination = ROOT / 'notebooks' / 'TerminalSight_Train_Detectors.ipynb'
    destination.parent.mkdir(parents=True, exist_ok=True)
    notebook = {'cells': cells, 'metadata': {'accelerator': 'GPU', 'colab': {'name': destination.name},
                'kernelspec': {'display_name': 'Python 3', 'language': 'python', 'name': 'python3'},
                'language_info': {'name': 'python'}}, 'nbformat': 4, 'nbformat_minor': 5}
    for index, cell in enumerate(cells):
        cell['id'] = f'terminalsight-{index:02d}'
    destination.write_text(json.dumps(notebook, indent=2), encoding='utf-8')
    print(destination)
