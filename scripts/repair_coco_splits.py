"""Make a separate COCO copy without byte-identical images across splits.

Retain test before validation before training. Original files are never modified.
Only exact file duplicates are detected, not related frames or augmented copies.
"""
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import shutil


def _class_name(name):
    name = ''.join(str(name).lower().replace('_', ' ').replace('-', ' ').split())
    return {'buses': 'bus', 'uvexpress': 'uv'}.get(name, name)


def _signature(data, annotations):
    categories = {category['id']: _class_name(category['name']) for category in data['categories']}
    return sorted((categories[item['category_id']], tuple(float(v) for v in item['bbox']),
                   int(item.get('iscrowd', 0))) for item in annotations)


def repair_dataset(source, destination, *, conflict_policy='error'):
    """Optionally exclude every copy of ambiguously annotated images.

    The default stops for review. 'exclude' never chooses an annotation as correct;
    it drops the entire conflicting file-hash group, including held-out copies.
    """
    if conflict_policy not in ('error', 'exclude'):
        raise ValueError("conflict_policy must be 'error' or 'exclude'.")
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if destination == source or destination.is_relative_to(source) or source.is_relative_to(destination):
        raise ValueError('The cleaned dataset must use a separate folder outside the original dataset.')
    if destination.exists() and any(destination.iterdir()):
        raise ValueError('Choose an empty output folder; existing files will not be overwritten.')
    splits = {}
    for path in sorted(source.rglob('_annotations.coco.json')):
        name = {'val': 'valid', 'validation': 'valid'}.get(path.parent.name.lower(), path.parent.name.lower())
        if name in ('test', 'valid', 'train'):
            if name in splits:
                raise ValueError(f'Multiple {name} splits found; use just one exported dataset version.')
            splits[name] = path
    if not {'train', 'valid'} <= splits.keys():
        raise ValueError('Expected train and valid COCO annotation files.')

    groups, originals = defaultdict(list), {}
    plans, removals, conflicts, failures = {}, [], [], []
    for name in ('test', 'valid', 'train'):
        if name not in splits:
            continue
        path = splits[name]
        data = json.loads(path.read_text(encoding='utf-8-sig'))
        by_image = defaultdict(list)
        for annotation in data['annotations']:
            by_image[annotation['image_id']].append(annotation)
        originals[name] = data
        for record in data['images']:
            image_path = (path.parent / record['file_name']).resolve()
            if not image_path.is_relative_to(path.parent.resolve()) or not image_path.is_file():
                raise ValueError(f'Missing image or unsafe image path: {record["file_name"]}')
            digest = hashlib.sha256(image_path.read_bytes()).hexdigest()
            signature = _signature(data, by_image[record['id']])
            groups[digest].append({'split': name, 'record': record, 'path': image_path,
                                   'signature': signature})

    kept_by_split = defaultdict(list)
    excluded_groups = 0
    for digest, entries in groups.items():
        first = entries[0]
        members = [{'split': entry['split'], 'image_id': entry['record']['id'],
                    'file_name': entry['record']['file_name'], 'signature': entry['signature']}
                   for entry in entries]
        ambiguous = any(entry['signature'] != first['signature'] for entry in entries[1:])
        if ambiguous:
            conflicts.append({'sha256': digest, 'members': members})
        if ambiguous and conflict_policy == 'exclude':
            excluded_groups += 1
            removals.extend({**member, 'sha256': digest, 'reason': 'annotation_conflict'}
                            for member in members)
            continue
        for entry, member in zip(entries, members):
            if entry['split'] != first['split']:
                removals.append({**member, 'sha256': digest, 'reason': 'cross_split_duplicate',
                                 'kept_split': first['split'], 'kept_file': first['record']['file_name']})
            else:
                kept_by_split[entry['split']].append(entry)

    for name, data in originals.items():
        kept = [entry['record'] for entry in kept_by_split[name]]
        kept_paths = [entry['path'] for entry in kept_by_split[name]]
        keep_ids = {record['id'] for record in kept}
        annotations = [item for item in data['annotations'] if item['image_id'] in keep_ids]
        before_classes = {item['category_id'] for item in data['annotations']}
        after_classes = {item['category_id'] for item in annotations}
        if not kept or before_classes != after_classes:
            failures.append(f'{name}: removing duplicates would empty the split or remove all examples of a class.')
        plans[name] = {'data': {**data, 'images': kept, 'annotations': annotations}, 'paths': kept_paths,
                       'original_images': len(data['images']), 'original_annotations': len(data['annotations'])}

    blocked = bool(failures or (conflicts and conflict_policy == 'error'))
    report = {'policy': 'Keep test, then valid, then train; optionally exclude all copies with conflicting annotations.',
              'conflict_policy': conflict_policy, 'excluded_conflicting_groups': excluded_groups,
              'source': str(source), 'removed': removals, 'annotation_conflicts': conflicts,
              'failures': failures, 'status': 'blocked' if blocked else 'complete',
              'splits': {name: {'before_images': plan['original_images'], 'after_images': len(plan['data']['images']),
                                'before_annotations': plan['original_annotations'],
                                'after_annotations': len(plan['data']['annotations'])} for name, plan in plans.items()}}
    destination.mkdir(parents=True, exist_ok=True)
    report_path = destination / 'deduplication_report.json'
    report_path.write_text(json.dumps(report, indent=2), encoding='utf-8')
    if blocked:
        raise ValueError(f'Repair stopped: {len(conflicts)} conflicting annotation group(s); {len(failures)} split-coverage issue(s). '
                         f'Review {report_path}. No cleaned image splits were written.')

    for name, plan in plans.items():
        folder = destination / name
        folder.mkdir()
        for record, image_path in zip(plan['data']['images'], plan['paths']):
            target = folder / record['file_name']
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(image_path, target)
        (folder / '_annotations.coco.json').write_text(json.dumps(plan['data'], indent=2), encoding='utf-8')
        print(f'{name}: kept {len(plan["data"]["images"])}/{plan["original_images"]} images')
    print(f'Excluded {excluded_groups} conflicting image group(s) from every split.')
    print(f'Removed {len(removals)} image records from the cleaned copy. Report: {report_path}')
    return destination
