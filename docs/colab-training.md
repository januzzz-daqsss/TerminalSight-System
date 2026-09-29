# Train the two additional TerminalSight detectors in Google Colab

## Files you upload

1. Open [Google Colab](https://colab.research.google.com/), choose **File > Upload notebook**,
   and select `notebooks/TerminalSight_Train_Detectors.ipynb` from this repository.
2. Inside the notebook, cell 4 asks for your **complete Roboflow COCO JSON dataset ZIP**.
   Upload that ZIP, containing the images and `_annotations.coco.json` in each split.
   Both models use the same ZIP; you do not need separate Faster R-CNN and SSD exports.

Example input structure (an extra outer folder is fine):

```text
your_dataset.zip
  train/
    _annotations.coco.json
    image files...
  valid/
    _annotations.coco.json
    image files...
  test/
    _annotations.coco.json
    image files...
```

Do not upload only the JSON, an existing YOLO `best.pt`, or the whole TerminalSight
project. If the export has `data.yaml` and image/label TXT folders, it is a YOLO export:
return to Roboflow's dataset version and download **COCO JSON** instead.

## Run the notebook

1. **Runtime > Change runtime type > GPU**, selecting T4 if offered. Save.
2. Run cell 1. It installs only `pycocotools` and checks Colab's PyTorch/Torchvision
   CUDA detection operators. It does not replace Colab's GPU-enabled PyTorch build.
3. Run cell 2, which writes the complete training program. No separate Python-file
   upload or code copying is required.
4. Run cell 3 and authorize your Google Drive. Copy the printed `RUN_NAME` somewhere
   permanent; checkpoints are saved under `MyDrive/TerminalSight/training/<RUN_NAME>`.
5. Run cell 4 and select your ZIP. For a large ZIP, upload it to Drive first and put
   its `/content/drive/MyDrive/...zip` path in `DRIVE_ZIP`.
6. Run cell 5 to extract and validate. Resolve reported annotation/image problems first.
7. Run cell 6 to display labeled example images. Check Bus and UV boxes visually.
8. Run cell 7 with the initial `EPOCHS = 20` and `BATCH_SIZE = 2`. These are starting
   settings, not a guaranteed sufficient training budget or accuracy.
9. Run cell 8 and wait for Faster R-CNN to finish. Then run cell 9 for SSD-VGG16.
10. Cell 10 plots training loss and validation mAP. After model choices are final,
    cell 11 evaluates the saved best models on the held-out test split.
11. Cell 12 downloads **TerminalSight_trained_models.zip** and also saves it to Drive.
    Extract that ZIP locally and provide its path for application integration.

Colab trains on its NVIDIA GPU regardless of the graphics card in your Windows PC.
GPU availability and session limits vary. Setup and pretrained-weight download require
internet; the resulting weights can later be used by the offline application.

## What the notebook trains

- **Faster R-CNN with ResNet-50-FPN**, starting from COCO pretrained weights, with a
  new three-class predictor. Images are internally resized with short side 512 and
  maximum long side 768. Frozen batch normalization is preserved on offline reload.
- **SSD300 with VGG16**, starting from COCO pretrained detection weights, keeping its
  pretrained backbone/regression head and replacing its classification head. Internal
  image size is 300 x 300.
- Training labels are `0=background`, `1=bus`, `2=uv`. Roboflow category IDs can differ
  across splits: IDs are mapped by category names, not assumed to equal model labels.
- All model parameters are fine-tuned; Faster R-CNN's normalization statistics stay
  frozen. Both models use SGD, horizontal flips during training, and a learning-rate
  schedule. Validation/test images are not augmented by the loader.
- Best checkpoint selection uses **validation mAP@0.50:0.95**. mAP@0.50 is also reported.
  Values are fractions, so 0.80 means 80%. These metrics must not be interchanged when
  comparing against the existing YOLO mAP@0.50 result.
- Use the same version and train/validation/test membership for model comparison.
  Similar frames from the same recording should remain in one split. The validation
  script detects identical files across splits, not visual near-duplicates.

The Faster R-CNN backbone is an explicit choice for this notebook. If your study
requires Faster R-CNN with VGG16 or another backbone, change the training architecture
before starting; renaming checkpoints cannot change their architecture.

## Output package

```text
TerminalSight_trained_models.zip
  fasterrcnn_resnet50_fpn/
    best.pth
    metadata.json
    class_names.json
    history.json
    test_metrics.json           # when a test split exists and cell 11 ran
    train_colab_detectors.py
  ssd300_vgg16/
    best.pth
    metadata.json
    class_names.json
    history.json
    test_metrics.json
    train_colab_detectors.py
  training_environment.txt
```

`best.pth` contains model parameters plus architecture/class/preprocessing metadata.
The larger `last.pth` in Drive also includes optimizer, scheduler, random-generator
state, and training history so interrupted training can resume. It is intentionally
excluded from the integration ZIP. Keep both Drive folders until training is finished.

The notebook does not create ONNX/OpenVINO exports or claim AMD/Intel inference works.
Those require separate export and runtime checks after the trained models are available.
Do not replace the working YOLO `best.pt` or point the existing YOLO-only detector
directly at these files. The application still needs the requested model-switching adapters.

## Resume after a disconnect

Reconnect to a GPU and rerun cells 1 and 2. In cell 3, replace the generated `RUN_NAME`
with the previous run's exact folder name. Re-upload/re-extract the same dataset and
rerun cells 4–7. Set `resume=True` in the interrupted model's cell. `EPOCHS` is the total
target, not an additional number of epochs. Skip a model that already finished.

If CUDA memory is exhausted, use `BATCH_SIZE = 1`. Resume only if `last.pth` exists;
otherwise no full epoch was saved, so start that model again. An epoch interrupted
before checkpointing must be repeated. Do not change the dataset or architecture.

## Cell 5: identical images in multiple splits

This error indicates exact image-file overlap between training/validation/test. Do not
disable the check: training on held-out images can inflate evaluation results.

In the updated notebook, set `REPAIR_EXACT_DUPLICATES = True` at the top of cell 5
and rerun that cell. It creates a separate cleaned copy, keeps test copies first,
then validation, then training, and removes associated annotation records for excluded
images. It saves `deduplication_report.json` and `cleaned_dataset.zip` to the run's
Google Drive folder. Original data and the original ZIP are not modified.

For an already-running older Colab notebook, add a new code cell below failed cell 5.
Paste the contents of `notebooks/Repair_Duplicate_Splits_Cell.py`. Run it and upload
only the **updated** `scripts/repair_coco_splits.py` when prompted. Replace any old
repair-cell code with the current file contents first. Repeated uploads renamed by
Colab are supported. This recovery cell excludes **all copies** of images with
conflicting annotations, including validation/test copies; it never guesses which
annotation is correct. It repairs the already-extracted
`DATA_ROOT`, validates the result, backs it up, and updates `DATA_ROOT` and `SPLITS`.
Continue at cell 6 after `Data ready` appears. Do not rerun the old cell 5 because it
would extract the original ZIP again. No dataset re-upload is required in that session.

By default, the helper and notebook stop with a report if identical images have
different annotation signatures (class names, boxes, or crowd flags). The count in
the updated report refers to unique conflicting image groups, not pairs. For the
updated notebook, set both `REPAIR_EXACT_DUPLICATES = True` and
`EXCLUDE_CONFLICTING_IMAGES = True` to exclude every member of those groups instead.
The standalone recovery cell already selects this exclusion policy. Its report
lists all conflicting members, their signatures, removals, and per-split counts.
Both modes still stop if removal would empty a split/remove every example of a
class; that requires manual annotation/split review. Originals remain untouched.
Non-conflicting duplicates are removed across splits, keeping test before valid
before train. Conflicting groups are excluded even when contained in one split;
near-duplicates, differently compressed copies and adjacent video frames need separate
review. Keep frames from the same recording together when creating splits in Roboflow.

Use the same cleaned data for both detectors and any new YOLO comparison. Earlier
YOLO scores measured on overlapping/different splits are not directly comparable.
For resume, select the saved `cleaned_dataset.zip` in cell 4; no further repair is needed.

## Source and validation

The self-contained notebook is generated from `scripts/train_colab_detectors.py` by
`scripts/build_training_notebook.py`. To regenerate after editing the trainer:

```powershell
.venv\Scripts\python.exe -B scripts/build_training_notebook.py
.venv\Scripts\python.exe -B -m unittest discover -s tests -p test_colab_training.py -v
```

No actual user dataset has been trained by Codex. No Colab GPU session was run here.
The notebook's cells are syntax checked, with local dataset-loader and model smoke
checks; actual training time and accuracy depend on the uploaded data and assigned GPU.

References: [PyTorch detection fine-tuning](https://docs.pytorch.org/tutorials/intermediate/torchvision_tutorial.html),
[SSD300-VGG16](https://docs.pytorch.org/vision/stable/models/generated/torchvision.models.detection.ssd300_vgg16.html),
[Faster R-CNN](https://docs.pytorch.org/vision/stable/models/generated/torchvision.models.detection.fasterrcnn_resnet50_fpn.html),
[Colab FAQ](https://research.google.com/colaboratory/faq.html).
