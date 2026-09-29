import ast
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from PIL import Image
import torch
from scripts.train_colab_detectors import CocoVehicles, extract_dataset, find_splits, inspect_dataset
from scripts.repair_coco_splits import repair_dataset


class TrainingDatasetTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def make_split(self, name, bus=0, uv=7, color='red'):
        folder = self.root / name
        folder.mkdir()
        Image.new('RGB', (100, 80), color).save(folder / 'vehicle.png')
        Image.new('RGB', (100, 80), 'white').save(folder / 'empty.png')
        data = {'images': [{'id': 10, 'file_name': 'vehicle.png', 'width': 100, 'height': 80},
                           {'id': 11, 'file_name': 'empty.png', 'width': 100, 'height': 80}],
                'categories': [{'id': bus, 'name': 'bus'}, {'id': uv, 'name': 'UV Express'},
                               {'id': 99, 'name': 'unused-parent-category'}],
                'annotations': [{'id': 1, 'image_id': 10, 'category_id': bus, 'bbox': [-2, 5, 32, 20]},
                                {'id': 2, 'image_id': 10, 'category_id': uv, 'bbox': [60, 30, 20, 40]}]}
        path = folder / '_annotations.coco.json'
        path.write_text(json.dumps(data))
        return path

    def test_background_remapping_boxes_and_empty_images(self):
        dataset = CocoVehicles(self.make_split('train'))
        image, target = dataset[0]
        self.assertEqual(target['labels'].tolist(), [1, 2])
        self.assertEqual(target['boxes'].tolist(), [[0, 5, 30, 25], [60, 30, 80, 70]])
        self.assertEqual(image.shape, (3, 80, 100))
        self.assertEqual(image.dtype, torch.float32)
        self.assertEqual(dataset[1][1]['boxes'].shape, (0, 4))
        valid = CocoVehicles(self.make_split('valid', bus=12, uv=8, color='blue'))
        self.assertEqual(valid[0][1]['labels'].tolist(), [1, 2])
        self.assertEqual(valid.label_to_category, {1: 12, 2: 8})

    def test_horizontal_flip_updates_boxes(self):
        dataset = CocoVehicles(self.make_split('train'), augment=True)
        with patch('scripts.train_colab_detectors.random.random', return_value=0):
            _, target = dataset[0]
        self.assertEqual(target['boxes'].tolist(), [[70, 5, 100, 25], [20, 30, 40, 70]])

    def test_duplicate_images_across_splits_are_rejected(self):
        self.make_split('train')
        self.make_split('valid')
        with self.assertRaisesRegex(ValueError, 'Identical image'):
            inspect_dataset(self.root)

    def add_unique_image(self, path, color):
        data = json.loads(path.read_text())
        Image.new('RGB', (100, 80), color).save(path.parent / 'unique.png')
        data['images'].append({'id': 12, 'file_name': 'unique.png', 'width': 100, 'height': 80})
        data['annotations'].extend([{**item, 'id': item['id'] + 2, 'image_id': 12}
                                    for item in list(data['annotations'])])
        path.write_text(json.dumps(data))

    def test_repair_keeps_test_then_validation_and_updates_annotations_without_touching_original(self):
        for name, color in [('train', 'green'), ('valid', 'blue'), ('test', 'yellow')]:
            self.add_unique_image(self.make_split(name), color)
        original = {str(path.relative_to(self.root)): path.read_bytes() for path in self.root.rglob('*') if path.is_file()}
        with tempfile.TemporaryDirectory() as destination:
            repair_dataset(self.root, destination)
            splits = inspect_dataset(destination)
            self.assertEqual(len(CocoVehicles(splits['test'])), 3)
            for name in ('valid', 'train'):
                dataset = CocoVehicles(splits[name])
                self.assertEqual([record['id'] for record in dataset.images], [12])
                self.assertEqual({item['image_id'] for item in dataset.data['annotations']}, {12})
            report = json.loads((Path(destination) / 'deduplication_report.json').read_text())
            self.assertEqual(len(report['removed']), 4)
            self.assertEqual(report['status'], 'complete')
        self.assertEqual(original, {str(path.relative_to(self.root)): path.read_bytes()
                                    for path in self.root.rglob('*') if path.is_file()})

    def test_repair_blocks_annotation_conflicts_and_class_loss(self):
        train = self.make_split('train')
        valid = self.make_split('valid')
        with tempfile.TemporaryDirectory() as destination:
            with self.assertRaisesRegex(ValueError, 'split-coverage issue'):
                repair_dataset(self.root, destination)
            self.assertFalse((Path(destination) / 'train').exists())
        self.add_unique_image(train, 'green')
        self.add_unique_image(valid, 'blue')
        data = json.loads(train.read_text())
        data['annotations'][0]['bbox'][2] = 25
        train.write_text(json.dumps(data))
        with tempfile.TemporaryDirectory() as destination:
            with self.assertRaisesRegex(ValueError, 'conflicting annotation'):
                repair_dataset(self.root, destination)
            self.assertFalse((Path(destination) / 'train').exists())
            report = json.loads((Path(destination) / 'deduplication_report.json').read_text())
            self.assertEqual(len(report['annotation_conflicts']), 1)

    def test_repair_rejects_output_inside_source(self):
        self.make_split('train')
        self.make_split('valid')
        with self.assertRaisesRegex(ValueError, 'separate folder'):
            repair_dataset(self.root, self.root / 'cleaned')

    def test_exclude_conflicts_removes_every_copy_including_same_split_aliases(self):
        for name, color in [('train', 'green'), ('valid', 'blue'), ('test', 'yellow')]:
            self.add_unique_image(self.make_split(name), color)
        train = self.root / 'train/_annotations.coco.json'
        data = json.loads(train.read_text())
        data['annotations'][0]['bbox'][2] = 25
        train.write_text(json.dumps(data))
        test = self.root / 'test/_annotations.coco.json'
        data = json.loads(test.read_text())
        (test.parent / 'alias.png').write_bytes((test.parent / 'vehicle.png').read_bytes())
        data['images'].append({**data['images'][0], 'id': 13, 'file_name': 'alias.png'})
        data['annotations'].extend([{**item, 'id': item['id'] + 10, 'image_id': 13}
                                    for item in list(data['annotations']) if item['image_id'] == 10])
        test.write_text(json.dumps(data))
        original = {str(path.relative_to(self.root)): path.read_bytes()
                    for path in self.root.rglob('*') if path.is_file()}
        with tempfile.TemporaryDirectory() as destination:
            repair_dataset(self.root, destination, conflict_policy='exclude')
            splits = inspect_dataset(destination)
            for name, path in splits.items():
                dataset = CocoVehicles(path)
                self.assertEqual({item['id'] for item in dataset.images}, {11, 12} if name == 'test' else {12})
                self.assertEqual({item['image_id'] for item in dataset.data['annotations']}, {12})
            report = json.loads((Path(destination) / 'deduplication_report.json').read_text())
            self.assertEqual(report['status'], 'complete')
            self.assertEqual(report['excluded_conflicting_groups'], 1)
            excluded = [item for item in report['removed'] if item['reason'] == 'annotation_conflict']
            self.assertEqual(len(excluded), 4)
            self.assertTrue(all('kept_file' not in item for item in excluded))
            self.assertEqual(len(report['annotation_conflicts'][0]['members']), 4)
        self.assertEqual(original, {str(path.relative_to(self.root)): path.read_bytes()
                                    for path in self.root.rglob('*') if path.is_file()})

    def test_exclusion_rechecks_class_coverage_in_previously_retained_split(self):
        train = self.make_split('train')
        valid = self.make_split('valid')
        self.add_unique_image(train, 'green')
        data = json.loads(train.read_text())
        data['annotations'][0]['bbox'][2] = 25
        train.write_text(json.dumps(data))
        with tempfile.TemporaryDirectory() as destination:
            with self.assertRaisesRegex(ValueError, 'split-coverage issue'):
                repair_dataset(self.root, destination, conflict_policy='exclude')
            self.assertFalse((Path(destination) / 'valid').exists())
            report = json.loads((Path(destination) / 'deduplication_report.json').read_text())
            self.assertEqual(report['status'], 'blocked')
            self.assertTrue(any(failure.startswith('valid:') for failure in report['failures']))

    def test_invalid_conflict_policy_is_rejected(self):
        with tempfile.TemporaryDirectory() as destination:
            with self.assertRaisesRegex(ValueError, 'conflict_policy'):
                repair_dataset(self.root, destination, conflict_policy='guess')

    def test_unexpected_classes_and_invalid_boxes_stop_before_training(self):
        path = self.make_split('train')
        original = json.loads(path.read_text())
        data = json.loads(path.read_text())
        data['categories'][0]['name'] = 'truck'
        path.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, 'Unexpected annotated class'):
            CocoVehicles(path)
        original['annotations'][0]['bbox'] = [0, 0, 0, 30]
        path.write_text(json.dumps(original))
        with self.assertRaisesRegex(ValueError, 'Invalid bounding box'):
            CocoVehicles(path)

    def test_zip_path_traversal_and_wrong_export_format_rejected(self):
        archive = self.root / 'unsafe.zip'
        with zipfile.ZipFile(archive, 'w') as bundle:
            bundle.writestr('../outside.txt', 'bad')
        with self.assertRaisesRegex(ValueError, 'unsafe path'):
            extract_dataset(archive, self.root / 'extracted')
        self.assertFalse((self.root / 'outside.txt').exists())
        with self.assertRaisesRegex(ValueError, 'COCO JSON ZIP'):
            find_splits(self.root)

    def test_notebook_code_is_complete_and_embeds_current_training_program(self):
        root = Path(__file__).resolve().parents[1]
        notebook = json.loads((root / 'notebooks/TerminalSight_Train_Detectors.ipynb').read_text())
        embedded = None
        for cell in notebook['cells']:
            if cell['cell_type'] != 'code':
                continue
            source = cell['source']
            if source.startswith('%%writefile'):
                embedded = source.split('\n', 1)[1]
                ast.parse(embedded)
            else:
                ast.parse('\n'.join(line for line in source.splitlines() if not line.startswith('%')))
        self.assertEqual(embedded.strip(), (root / 'scripts/train_colab_detectors.py').read_text().strip())
        repair_source = (root / 'scripts/repair_coco_splits.py').read_text().strip()
        self.assertTrue(any(repair_source in cell['source'] for cell in notebook['cells']))
        ast.parse((root / 'notebooks/Repair_Duplicate_Splits_Cell.py').read_text())


if __name__ == '__main__':
    unittest.main()
