"""Repository resources, independent of module location or working directory."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = ROOT / 'config'
MODELS_DIR = ROOT / 'trained_models'
SAMPLE_VIDEO_DIR = ROOT / 'public' / 'sample-videos'
DATABASE_PATH = ROOT / 'terminalsight.db'
