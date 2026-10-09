"""Train TerminalSight detectors from a Roboflow COCO export (local or Colab).

This module is embedded in the companion notebook; it is not imported by Flask.
"""
import argparse
from collections import Counter, defaultdict
import contextlib
import hashlib
import io
import json
import math
from pathlib import Path
import random
import shutil
import time
import zipfile

import PIL
from PIL import Image
import torch
from torch.utils.data import DataLoader, Dataset
import torchvision
from torchvision.transforms import functional as TF

CLASS_NAMES = {0: '__background__', 1: 'bus', 2: 'uv'}
CLASS_ALIASES = {'bus': 1, 'buses': 1, 'uv': 2, 'uv express': 2, 'uvexpress': 2}
MODEL_NAMES = ('fasterrcnn_resnet50_fpn', 'ssd300_vgg16')


def extract_dataset(archive, destination):
    destination = Path(destination).resolve()
    if destination.exists() and any(destination.iterdir()):
        raise ValueError('Use an empty extraction directory to avoid mixing dataset versions.')
    with zipfile.ZipFile(archive) as bundle:
        for item in bundle.infolist():
            target = (destination / item.filename.replace('\\', '/')).resolve()
            if not target.is_relative_to(destination) or (item.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('ZIP contains an unsafe path or symbolic link.')
        destination.mkdir(parents=True, exist_ok=True)
        bundle.extractall(destination)
    return destination


def find_splits(root):
    result = {}
    for path in Path(root).rglob('_annotations.coco.json'):
        name = {'val': 'valid', 'validation': 'valid'}.get(path.parent.name.lower(), path.parent.name.lower())
        if name in ('train', 'valid', 'test'):
            if name in result:
                raise ValueError(f'Multiple {name} splits found. Extract just one dataset version.')
            result[name] = path
    if not {'train', 'valid'} <= result.keys():
        raise ValueError('Expected train/valid folders with _annotations.coco.json. Upload the COCO JSON ZIP, including images.')
    return result


def canonical_label(name):
    normalized = ' '.join(str(name).lower().replace('_', ' ').replace('-', ' ').split())
    if normalized not in CLASS_ALIASES:
        raise ValueError(f'Unexpected annotated class {name!r}. Confirm it is Bus or UV before editing CLASS_ALIASES.')
    return CLASS_ALIASES[normalized]


class CocoVehicles(Dataset):
    def __init__(self, annotation_path, augment=False):
        self.path = Path(annotation_path)
        self.augment = augment
        self.data = json.loads(self.path.read_text(encoding='utf-8-sig'))
        self.images = self.data['images']
        if not self.images:
            raise ValueError(f'{self.path}: empty image split')
        ids = [image['id'] for image in self.images]
        if len(set(ids)) != len(ids):
            raise ValueError('Duplicate COCO image IDs')
        categories = {category['id']: category['name'] for category in self.data['categories']}
        self.category_to_label = {}
        self.label_to_category = {}
        self.annotations = defaultdict(list)
        self.counts = Counter()
        image_ids = set(ids)
        for annotation in self.data['annotations']:
            if annotation['image_id'] not in image_ids:
                raise ValueError('Annotation refers to a missing image ID')
            category = annotation['category_id']
            label = canonical_label(categories[category])
            if label in self.label_to_category and self.label_to_category[label] != category:
                raise ValueError('Two annotated categories map to one vehicle class. Merge those labels in Roboflow.')
            self.category_to_label[category] = label
            self.label_to_category[label] = category
            if annotation.get('iscrowd', 0):
                raise ValueError('Crowd/group boxes found. Use individual vehicle bounding boxes for this notebook.')
            self.annotations[annotation['image_id']].append(annotation)
            self.counts[CLASS_NAMES[label]] += 1
        if set(self.label_to_category) != {1, 2}:
            raise ValueError(f'{self.path.parent.name}: needs annotated Bus AND UV examples; found {dict(self.counts)}')
        self.paths = []
        for record in self.images:
            path = (self.path.parent / record['file_name']).resolve()
            if not path.is_relative_to(self.path.parent.resolve()) or not path.is_file():
                raise ValueError(f'Missing image or invalid file_name: {record["file_name"]}')
            with Image.open(path) as image:
                if image.size != (record['width'], record['height']):
                    raise ValueError(f'Image size and annotations disagree: {path.name}')
                image.verify()
            # Validate every box now, before starting an expensive training run.
            self._boxes(record)
            self.paths.append(path)

    def _boxes(self, record):
        boxes, labels = [], []
        for annotation in self.annotations[record['id']]:
            x, y, width, height = annotation['bbox']
            if not all(math.isfinite(v) for v in (x, y, width, height)) or width <= 0 or height <= 0:
                raise ValueError(f'Invalid bounding box in image {record["id"]}')
            x1, y1 = max(0, x), max(0, y)
            x2, y2 = min(record['width'], x + width), min(record['height'], y + height)
            if x2 <= x1 or y2 <= y1:
                raise ValueError(f'Bounding box outside image {record["id"]}')
            boxes.append([x1, y1, x2, y2])
            labels.append(self.category_to_label[annotation['category_id']])
        return torch.tensor(boxes, dtype=torch.float32).reshape(-1, 4), torch.tensor(labels, dtype=torch.int64)

    def __len__(self):
        return len(self.images)

    def __getitem__(self, index):
        record = self.images[index]
        with Image.open(self.paths[index]) as original:
            image = original.convert('RGB')
        boxes, labels = self._boxes(record)
        if self.augment and random.random() < .5:
            image = TF.hflip(image)
            boxes[:, [0, 2]] = image.width - boxes[:, [2, 0]]
        target = {'boxes': boxes, 'labels': labels, 'image_id': torch.tensor(record['id'], dtype=torch.int64)}
        # Models apply their own normalization/resizing; preserve original coordinates here.
        return TF.to_tensor(image), target


def inspect_dataset(root):
    splits = find_splits(root)
    fingerprints = {}
    for name, path in splits.items():
        dataset = CocoVehicles(path)
        print(f'{name}: {len(dataset)} images, boxes={dict(dataset.counts)}', flush=True)
        for image in dataset.paths:
            digest = hashlib.sha256(image.read_bytes()).hexdigest()
            if digest in fingerprints and fingerprints[digest] != name:
                raise ValueError(f'Identical image occurs in both {fingerprints[digest]} and {name}: {image.name}')
            fingerprints[digest] = name
    print('Class IDs for training: 0=background, 1=bus, 2=uv. COCO IDs are remapped by NAME.')
    if 'test' not in splits:
        print('No test split found. Create a held-out test split before final model comparison.')
    return splits


def build_model(name, pretrained=True, resize=None):
    from torchvision.models.detection import (
        fasterrcnn_resnet50_fpn, FasterRCNN_ResNet50_FPN_Weights,
        ssd300_vgg16, SSD300_VGG16_Weights,
    )
    if name == 'fasterrcnn_resnet50_fpn':
        resize = resize or {'min_size': 512, 'max_size': 768}  # Legacy checkpoint default.
        from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
        model = fasterrcnn_resnet50_fpn(
            weights=FasterRCNN_ResNet50_FPN_Weights.COCO_V1 if pretrained else None,
            weights_backbone=None, **resize,
        )
        features = model.roi_heads.box_predictor.cls_score.in_features
        model.roi_heads.box_predictor = FastRCNNPredictor(features, len(CLASS_NAMES))
        # Torchvision otherwise uses ordinary BatchNorm when weights=None, which
        # would change the architecture on offline reload/resume of a COCO model.
        from torchvision.ops.misc import FrozenBatchNorm2d

        def freeze_norm(module):
            for child_name, child in list(module.named_children()):
                if isinstance(child, torch.nn.BatchNorm2d):
                    frozen = FrozenBatchNorm2d(child.num_features, eps=child.eps)
                    frozen.load_state_dict(child.state_dict())
                    setattr(module, child_name, frozen)
                else:
                    freeze_norm(child)
        freeze_norm(model.backbone)
        for module in model.modules():
            if isinstance(module, FrozenBatchNorm2d):
                module.eps = 0.0  # Matches Torchvision's COCO_V1 checkpoint on offline reload.
    elif name == 'ssd300_vgg16':
        from torchvision.models.detection.ssd import SSDClassificationHead
        model = ssd300_vgg16(weights=SSD300_VGG16_Weights.COCO_V1 if pretrained else None, weights_backbone=None)
        channels = [layer.in_channels for layer in model.head.classification_head.module_list]
        anchors = model.anchor_generator.num_anchors_per_location()
        model.head.classification_head = SSDClassificationHead(channels, anchors, len(CLASS_NAMES))
    else:
        raise ValueError(f'Unknown model: {name}')
    # Same fine-tuning policy on initial training and checkpoint resume.
    for parameter in model.parameters():
        parameter.requires_grad_(True)
    return model


def detection_counts(prediction, target, confidence=.5, iou_threshold=.5):
    """Class-agnostic, score-ordered, one-to-one matching for a diagnostic matrix.

    Rows=true, columns=predicted; 0 is unmatched/background, never a measured TN.
    Cross-class matches count as both an FP for predicted and FN for true class.
    This fixed-threshold protocol is separate from COCO's class-wise AP matching.
    """
    from torchvision.ops import box_iou
    matrix = torch.zeros((3, 3), dtype=torch.int64)
    keep = torch.where(prediction['scores'].cpu() >= confidence)[0]
    keep = keep[torch.argsort(prediction['scores'].cpu()[keep], descending=True, stable=True)]
    boxes = prediction['boxes'].cpu()[keep]
    labels = prediction['labels'].cpu()[keep]
    truth = target['labels'].cpu()
    overlaps = box_iou(boxes, target['boxes'].cpu())
    used = set()
    for row, label in enumerate(labels.tolist()):
        candidates = [j for j in range(len(truth)) if j not in used and overlaps[row, j] >= iou_threshold]
        if candidates:
            match = max(candidates, key=lambda j: float(overlaps[row, j]))
            used.add(match)
            matrix[int(truth[match]), label] += 1
        else:
            matrix[0, label] += 1
    for j, label in enumerate(truth.tolist()):
        if j not in used:
            matrix[label, 0] += 1
    return matrix


def summarize_counts(matrix):
    def metrics(tp, fp, fn):
        return {'tp': tp, 'fp': fp, 'fn': fn,
                'precision': tp / (tp + fp) if tp + fp else 0.0,
                'recall': tp / (tp + fn) if tp + fn else 0.0,
                'f1': 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else 0.0}
    classes = {}
    for label in (1, 2):
        tp = int(matrix[label, label])
        classes[CLASS_NAMES[label]] = metrics(tp, int(matrix[:, label].sum()) - tp,
                                            int(matrix[label, :].sum()) - tp)
    totals = [sum(item[key] for item in classes.values()) for key in ('tp', 'fp', 'fn')]
    return {'per_class': classes, 'micro': metrics(*totals),
            'macro': {key: sum(item[key] for item in classes.values()) / 2
                      for key in ('precision', 'recall', 'f1')},
            'confusion_matrix': matrix.tolist(), 'matrix_labels': ['background', 'bus', 'uv'],
            'matrix_orientation': 'rows=true, columns=predicted; background/background unused'}


@torch.inference_mode()
def benchmark_model(model, dataset, device, repeats=3, warmup=10):
    """Batch-1 model calls: includes model resize/NMS; excludes file I/O and transfer."""
    model.eval()
    def synchronize():
        if device.type == 'cuda':
            torch.cuda.synchronize(device)
    first = dataset[0][0].to(device)
    for _ in range(warmup):
        model([first])
    synchronize()
    elapsed = []
    for _ in range(repeats):
        for index in range(len(dataset)):
            image = dataset[index][0].to(device)
            synchronize()
            start = time.perf_counter()
            model([image])
            synchronize()
            elapsed.append((time.perf_counter() - start) * 1000)
    values = torch.tensor(elapsed, dtype=torch.float64)
    mean = float(values.mean())
    return {'mean_ms': mean, 'median_ms': float(values.quantile(.5)),
            'p95_ms': float(values.quantile(.95)), 'fps': 1000 / mean,
            'samples': len(elapsed), 'warmup_calls': warmup, 'batch_size': 1,
            'device': str(device), 'hardware': torch.cuda.get_device_name(device) if device.type == 'cuda' else 'CPU',
            'scope': 'Model call including internal resize and postprocessing; excludes disk I/O, host-to-device transfer, OCR, UI.'}


def collate(batch):
    return tuple(zip(*batch))


def loader(dataset, batch_size, shuffle=False):
    return DataLoader(dataset, batch_size=batch_size, shuffle=shuffle, num_workers=0,
                      pin_memory=torch.cuda.is_available(), collate_fn=collate)


@torch.inference_mode()
def evaluate(model, dataset, device, batch_size=2, detailed=False, confidence=.5, iou_threshold=.5):
    from pycocotools.coco import COCO
    from pycocotools.cocoeval import COCOeval
    model.eval()
    detections = []
    matrix = torch.zeros((3, 3), dtype=torch.int64)
    for images, targets in loader(dataset, batch_size):
        predictions = model([image.to(device) for image in images])
        for prediction, target in zip(predictions, targets):
            if detailed:
                matrix += detection_counts(prediction, target, confidence, iou_threshold)
            for box, label, score in zip(prediction['boxes'].cpu().tolist(), prediction['labels'].cpu().tolist(),
                                         prediction['scores'].cpu().tolist()):
                if label not in dataset.label_to_category:
                    continue
                x1, y1, x2, y2 = box
                detections.append({'image_id': int(target['image_id']),
                                   'category_id': dataset.label_to_category[label],
                                   'bbox': [x1, y1, x2-x1, y2-y1], 'score': score})
    details = summarize_counts(matrix) if detailed else {}
    if detailed:
        details['protocol'] = {'confidence': confidence, 'iou_threshold': iou_threshold,
                               'matching': 'class-agnostic score-ordered greedy one-to-one',
                               'zero_denominator': 'reported as zero; consult tp/fp/fn counts'}
    if not detections:
        return {'map_50_95': 0.0, 'map_50': 0.0, **details}
    with contextlib.redirect_stdout(io.StringIO()):
        truth = COCO(str(dataset.path))
        truth.dataset.setdefault('info', {})
        # Some Roboflow exports omit these optional COCO fields.
        for annotation in truth.dataset['annotations']:
            annotation.setdefault('area', annotation['bbox'][2] * annotation['bbox'][3])
            annotation.setdefault('iscrowd', 0)
        scorer = COCOeval(truth, truth.loadRes(detections), 'bbox')
        scorer.params.imgIds = [record['id'] for record in dataset.images]
        scorer.params.catIds = list(dataset.label_to_category.values())
        scorer.evaluate()
        scorer.accumulate()
        scorer.summarize()
    return {'map_50_95': float(scorer.stats[0]), 'map_50': float(scorer.stats[1]), **details}


def save_checkpoint(payload, path):
    path = Path(path)
    temporary = path.with_suffix('.tmp')
    torch.save(payload, temporary)
    temporary.replace(path)


def checkpoint_metadata(name, train, seed, resize=None):
    return {
        'format_version': 1, 'architecture': name, 'class_names': CLASS_NAMES,
        'category_to_label': train.category_to_label, 'seed': seed,
        'torch_version': str(torch.__version__), 'torchvision_version': str(torchvision.__version__),
        'pillow_version': str(PIL.__version__),
        'training_annotation_sha256': hashlib.sha256(train.path.read_bytes()).hexdigest(),
        'input': 'RGB float32 [0,1]; model performs internal normalization and resize',
        'resize': (resize or {'min_size': 512, 'max_size': 768}) if name == MODEL_NAMES[0] else {'size': [300, 300]},
    }


def train_model(args):
    if not torch.cuda.is_available():
        raise RuntimeError('No CUDA GPU. In Colab: Runtime > Change runtime type > GPU, then rerun setup cells.')
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.cuda.manual_seed_all(args.seed)
    splits = inspect_dataset(args.dataset)
    train = CocoVehicles(splits['train'], augment=not args.no_online_flip)
    valid = CocoVehicles(splits['valid'])
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    if (output / 'last.pth').exists() and not args.resume:
        raise ValueError('This folder already has a run. Use --resume with its last.pth or choose a new output folder.')
    device = torch.device('cuda')
    resize = {'min_size': args.frcnn_size, 'max_size': args.frcnn_size}
    model = build_model(args.model, pretrained=not bool(args.resume), resize=resize).to(device)
    parameters = [p for p in model.parameters() if p.requires_grad]
    if args.optimizer == 'adamw':
        optimizer = torch.optim.AdamW(parameters, lr=args.lr, weight_decay=.0005)
    else:
        optimizer = torch.optim.SGD(parameters, lr=args.lr, momentum=.9, weight_decay=.0005)
    scheduler = torch.optim.lr_scheduler.StepLR(optimizer, step_size=8, gamma=.2)
    metadata = checkpoint_metadata(args.model, train, args.seed, resize)
    metadata.update(batch_size=args.batch_size, initial_lr=args.lr, planned_epochs=args.epochs)
    metadata.update(framework='torchvision', optimizer=args.optimizer, online_flip=not args.no_online_flip,
                    dataset_version=args.dataset_version, scheduler={'name': 'StepLR', 'step_size': 8, 'gamma': .2},
                    weight_decay=.0005,
                    dataset_splits={name: {'images': len((ds := CocoVehicles(path))), 'boxes': dict(ds.counts),
                                          'dimensions': sorted({(im['width'], im['height']) for im in ds.images}),
                                          'annotation_sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
                                    for name, path in splits.items()})
    metadata['validation_annotation_sha256'] = hashlib.sha256(valid.path.read_bytes()).hexdigest()
    start, best_score, history = 0, -1.0, []
    if args.resume:
        previous = torch.load(args.resume, map_location='cpu', weights_only=True)
        for field in ('architecture', 'class_names', 'training_annotation_sha256',
                      'validation_annotation_sha256', 'initial_lr', 'seed', 'resize', 'optimizer', 'online_flip', 'dataset_version'):
            if previous['metadata'].get(field) != metadata[field]:
                raise ValueError(f'Resume mismatch in {field}')
        if not (output / 'best.pth').is_file():
            raise ValueError('Resume into the same output folder containing best.pth and last.pth.')
        model.load_state_dict(previous['state_dict'])
        optimizer.load_state_dict(previous['optimizer'])
        scheduler.load_state_dict(previous['scheduler'])
        start, best_score, history = previous['epoch'], previous['best_map_50_95'], previous['history']
        random.setstate(previous['random_state'])
        torch.set_rng_state(previous['torch_rng'])
        torch.cuda.set_rng_state_all(previous['cuda_rng'])
    train_loader = loader(train, args.batch_size, shuffle=True)
    for epoch in range(start, args.epochs):
        model.train()
        total = 0.0
        for step, (images, targets) in enumerate(train_loader, 1):
            images = [image.to(device) for image in images]
            targets = [{key: value.to(device) for key, value in target.items()} for target in targets]
            loss = sum(model(images, targets).values())
            if not torch.isfinite(loss):
                raise RuntimeError('Non-finite training loss. Check annotations and lower the learning rate.')
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 10)
            optimizer.step()
            total += float(loss.detach())
            if step % 25 == 0:
                print(f'Epoch {epoch+1}/{args.epochs} batch {step}/{len(train_loader)} loss={total/step:.4f}', flush=True)
        metrics = evaluate(model, valid, device, args.batch_size)
        scheduler.step()
        history.append({'epoch': epoch+1, 'train_loss': total/len(train_loader), **metrics})
        print(json.dumps(history[-1]), flush=True)
        payload = {'metadata': metadata, 'epoch': epoch+1, 'state_dict': model.state_dict(), 'validation': metrics}
        if metrics['map_50_95'] > best_score:
            best_score = metrics['map_50_95']
            save_checkpoint(payload, output / 'best.pth')
            print('Saved new best validation checkpoint.', flush=True)
        save_checkpoint({**payload, 'optimizer': optimizer.state_dict(), 'scheduler': scheduler.state_dict(),
                         'best_map_50_95': best_score, 'history': history,
                         'random_state': random.getstate(), 'torch_rng': torch.get_rng_state(),
                         'cuda_rng': torch.cuda.get_rng_state_all()}, output / 'last.pth')
        (output / 'metadata.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
        (output / 'history.json').write_text(json.dumps(history, indent=2), encoding='utf-8')
        if Path(__file__).resolve() != (output / 'train_colab_detectors.py').resolve():
            shutil.copyfile(__file__, output / 'train_colab_detectors.py')
    print(f'Finished. Best validation mAP@0.50:0.95: {best_score:.4f}; files: {output}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset', required=True)
    parser.add_argument('--inspect', action='store_true')
    parser.add_argument('--model', choices=MODEL_NAMES)
    parser.add_argument('--output')
    parser.add_argument('--epochs', type=int, default=50)
    parser.add_argument('--batch-size', type=int, default=2)
    parser.add_argument('--lr', type=float, default=.002)
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--resume')
    parser.add_argument('--frcnn-size', type=int, default=416)
    parser.add_argument('--optimizer', choices=('sgd', 'adamw'), default='sgd')
    parser.add_argument('--no-online-flip', action='store_true')
    parser.add_argument('--dataset-version', default='unspecified')
    parser.add_argument('--confidence', type=float, default=.5)
    parser.add_argument('--match-iou', type=float, default=.5)
    parser.add_argument('--evaluate', help='best.pth to evaluate on the held-out test split')
    args = parser.parse_args()
    if not (0 < args.confidence <= 1 and 0 < args.match_iou <= 1) or args.frcnn_size < 32 or args.batch_size < 1:
        parser.error('Require thresholds in (0,1], frcnn-size >=32 and batch-size >=1.')
    if args.inspect:
        inspect_dataset(args.dataset)
    elif args.evaluate:
        splits = inspect_dataset(args.dataset)
        if 'test' not in splits:
            raise ValueError('No test split: do not substitute validation for held-out testing.')
        checkpoint = torch.load(args.evaluate, map_location='cpu', weights_only=True)
        for split, key in (('train', 'training_annotation_sha256'), ('valid', 'validation_annotation_sha256')):
            expected = checkpoint['metadata'].get(key)
            if expected and hashlib.sha256(splits[split].read_bytes()).hexdigest() != expected:
                raise ValueError(f'{split} split differs from checkpoint: use its saved cleaned dataset.')
        expected_test = checkpoint['metadata'].get('dataset_splits', {}).get('test', {}).get('annotation_sha256')
        if expected_test and hashlib.sha256(splits['test'].read_bytes()).hexdigest() != expected_test:
            raise ValueError('Test split differs from the recorded experiment.')
        model = build_model(checkpoint['metadata']['architecture'], pretrained=False,
                            resize=checkpoint['metadata'].get('resize'))
        model.load_state_dict(checkpoint['state_dict'])
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        dataset = CocoVehicles(splits['test'])
        scores = evaluate(model.to(device), dataset, device, args.batch_size, detailed=True,
                          confidence=args.confidence, iou_threshold=args.match_iou)
        scores['timing'] = benchmark_model(model, dataset, device)
        scores['test_images'] = len(dataset)
        scores['test_boxes'] = dict(dataset.counts)
        scores['test_annotation_sha256'] = hashlib.sha256(dataset.path.read_bytes()).hexdigest()
        scores['checkpoint_epoch'] = checkpoint['epoch']
        scores['torch_version'] = str(torch.__version__)
        scores['torchvision_version'] = str(torchvision.__version__)
        path = Path(args.evaluate).parent / 'test_metrics.json'
        path.write_text(json.dumps(scores, indent=2), encoding='utf-8')
        print('Held-out TEST:', scores, flush=True)
    else:
        if not args.model or not args.output or args.epochs < 1 or args.batch_size < 1 or args.lr <= 0:
            parser.error('Training requires --model, --output, and positive epochs/batch-size/lr.')
        train_model(args)


if __name__ == '__main__':
    main()
