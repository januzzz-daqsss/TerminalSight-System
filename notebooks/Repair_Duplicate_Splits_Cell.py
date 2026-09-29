# Paste this into a NEW Colab cell directly below failed cell 5.
# When prompted, upload scripts/repair_coco_splits.py from the project.
# All copies of images with conflicting labels/boxes are excluded from this copy.
from google.colab import files
from pathlib import Path
import runpy
import re
import shutil
import tempfile
from train_colab_detectors import inspect_dataset

uploaded = files.upload()
if len(uploaded) != 1 or not re.fullmatch(r'repair_coco_splits(?: \(\d+\))?\.py', Path(next(iter(uploaded))).name):
    raise ValueError('Upload only repair_coco_splits.py, not the dataset ZIP.')
# Read the newly uploaded bytes even if Colab renamed a repeated upload.
with tempfile.TemporaryDirectory(prefix='terminalsight_repair_') as helper_folder:
    helper_path = Path(helper_folder) / 'repair_coco_splits.py'
    helper_path.write_bytes(next(iter(uploaded.values())))
    repair = runpy.run_path(str(helper_path))['repair_dataset']
del uploaded

cleaned = repair(DATA_ROOT, Path(tempfile.mkdtemp(prefix='terminalsight_clean_')),
                 conflict_policy='exclude')
cleaned_splits = inspect_dataset(cleaned)
shutil.copy2(cleaned / 'deduplication_report.json', OUTPUT_ROOT / 'deduplication_report.json')
print('Saving cleaned dataset ZIP to Google Drive...')
shutil.make_archive(str(OUTPUT_ROOT / 'cleaned_dataset'), 'zip', cleaned)
DATA_ROOT, SPLITS = cleaned, cleaned_splits
print('Data ready:', DATA_ROOT)
print('Backup:', OUTPUT_ROOT / 'cleaned_dataset.zip')
print('Continue with cell 6. Do not rerun the old cell 5: it reloads the original ZIP.')
