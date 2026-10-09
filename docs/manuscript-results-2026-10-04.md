# Verified results for the next manuscript revision

Saved October 4, 2026 at the user's request. These numbers were read from the
submitted training outputs, not independently reproduced by local inference.

## Source and experiment

- Source archive: `C:\Users\Januzz\Downloads\TerminalSight_trained_models (1).zip`.
- Authoritative files inside: each model's `test_metrics.json`, `metadata.json`,
  and `history.json`, plus `dataset_manifest.json` and `manuscript_metrics.csv`.
- Manuscript to revise later: `D:\Documents\CAPSTONE\TERMINALSIGHT-REVISION_FINAL-2.docx.pdf`.
- Roboflow v18: stretch to 416x416, three exported outputs per training example,
  horizontal flipping. Additional online flipping disabled.
- Both models completed 50 epochs, seed 42, training batch size 2.
- Framework: Torchvision, not Detectron2.
- Faster R-CNN ResNet-50-FPN: internal min/max resize 416; SGD, initial LR 0.002.
- SSD300-VGG16: internal 300x300; AdamW, initial LR 0.0001.
- Both: weight decay 0.0005, StepLR every 8 epochs with gamma 0.2.
- Validation mAP@0.50:0.95 selected best checkpoints: Faster R-CNN epoch 9;
  SSD epoch 17. Test data did not select checkpoints.

## Actual cleaned dataset

| Split | Images | Bus boxes | UV boxes |
|---|---:|---:|---:|
| Train | 864 | 756 | 534 |
| Validation | 103 | 66 | 70 |
| Test | 109 | 102 | 65 |

Both models record the same test annotation SHA-256:
`ad9685b5d8a1f2e316bb40a0d5fcb3cedf6ce59580a9b582bdd09a5f6396db4c`.

## Held-out test metrics

Values below are percentages except latency/FPS. P/R/F1 are micro averages
(pooled counts), at confidence 0.50 and matching IoU 0.50. The diagnostic
matching protocol is class-agnostic, score-ordered greedy one-to-one matching.
Wrong-class matches count as an FP for the predicted class and FN for the true
class. COCO mAP is calculated separately using its standard matching protocol.

| Metric | Faster R-CNN | SSD300-VGG16 |
|---|---:|---:|
| mAP@0.50 | 85.96 | 79.65 |
| mAP@0.50:0.95 | 75.41 | 68.65 |
| Micro precision | 86.88 | 93.89 |
| Micro recall | 83.23 | 73.65 |
| Micro F1 | 85.02 | 82.55 |
| Macro precision | 87.02 | 93.71 |
| Macro recall | 84.32 | 75.92 |
| Macro F1 | 85.60 | 83.28 |
| Mean latency (ms) | 45.11 | 29.75 |
| Median latency (ms) | 44.71 | 29.72 |
| p95 latency (ms) | 48.25 | 31.28 |
| FPS | 22.17 | 33.61 |

Macro metrics average each class's metric equally; macro F1 is the mean of
class F1 values, not F1 recalculated from macro precision/recall.

| Model | Class | Precision (%) | Recall (%) | F1 (%) | TP | FP | FN |
|---|---|---:|---:|---:|---:|---:|---:|
| Faster R-CNN | Bus | 86.17 | 79.41 | 82.65 | 81 | 13 | 21 |
| Faster R-CNN | UV | 87.88 | 89.23 | 88.55 | 58 | 8 | 7 |
| SSD300 | Bus | 97.10 | 65.69 | 78.36 | 67 | 2 | 35 |
| SSD300 | UV | 90.32 | 86.15 | 88.19 | 56 | 6 | 9 |

## Confusion matrices

Rows = true, columns = predicted. Order: background, Bus, UV. Background is
unmatched labels/detections, not a vehicle class. Top-left is unused, not a
measured true-negative count.

```text
Faster R-CNN              SSD300
[[ 0, 12,  6],           [[ 0,  2,  1],
 [19, 81,  2],            [30, 67,  5],
 [ 6,  1, 58]]            [ 9,  0, 56]]
```

Faster R-CNN: 139 TP, 21 FP, 28 FN. There are 25 unmatched ground-truth
vehicles plus 3 misclassified vehicles. SSD: 123 TP, 8 FP, 44 FN, consisting
of 39 unmatched ground-truth vehicles plus 5 misclassified vehicles.

## Timing conditions and interpretation

- Tesla T4 CUDA; PyTorch 2.11.0+cu130, Torchvision 0.26.0+cu130.
- Batch 1; ten warm-up calls; three test passes (327 timed calls).
- CUDA synchronization used. FPS = 1000 / mean latency in milliseconds.
- Timing includes model resize/inference/postprocessing; excludes disk I/O,
  host-to-device transfer, OCR, and UI. It is NOT end-to-end TerminalSight FPS
  or a measurement of the user's local laptop.
- In this experiment Faster R-CNN has higher mAP, recall, and F1. SSD has
  higher precision and speed. Do not claim statistical significance from one run.

## Manuscript revision reminders

1. Update Table 6, narrative metrics, confusion matrices, actual split counts,
   and experiment settings consistently using this run's outputs.
2. Name Torchvision accurately instead of Detectron2 for these experiments.
3. Label micro versus macro averaging and thresholds explicitly. Do not merge
   old manuscript metrics or earlier 20-epoch v17 results into this experiment.
4. Do not declare a winner among all three algorithms yet: YOLO requires the
   same clean splits and comparable evaluation protocol. Retrain YOLO if its
   training set overlaps the held-out test set. Compare speed on the same hardware.
5. v17 versus v18 changes image membership as well as resolution; these results
   do not prove that 416x416 is the optimal size.
6. Detector metrics do not establish OCR accuracy, slot occupancy accuracy,
   usability, or queue/congestion improvements; those need separate evaluations.
7. The user requested preservation now and manuscript editing later. No
   manuscript edits were authorized or performed by this save operation.
