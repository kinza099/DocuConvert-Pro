import sys
import os
from pathlib import Path

# Base & Bundle Paths
if getattr(sys, "frozen", False):
    # Running inside PyInstaller executable
    BUNDLE_DIR = Path(sys._MEIPASS).resolve()
    BASE_DIR = Path(sys.executable).resolve().parent
else:
    BUNDLE_DIR = Path(__file__).resolve().parent.parent
    BASE_DIR = BUNDLE_DIR

UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"
DATA_DIR = BASE_DIR / "data"

for directory in (UPLOAD_DIR, OUTPUT_DIR, DATA_DIR):
    directory.mkdir(parents=True, exist_ok=True)

# App Configuration
SECRET_KEY = os.environ.get("SECRET_KEY", "docuconvert-pro-secret-key-2026")
MAX_CONTENT_LENGTH = 150 * 1024 * 1024  # 150 MB max upload limit

# Supported formats and extensions
ALLOWED_EXTENSIONS = {
    "pdf": ["pdf"],
    "word": ["doc", "docx"],
    "images": ["png", "jpg", "jpeg", "webp", "bmp"],
    "all_convert": ["doc", "docx", "pdf", "png", "jpg", "jpeg"]
}

# Cleanup settings
FILE_EXPIRATION_HOURS = 2  # Temp files older than 2 hours are deleted
CLEANUP_INTERVAL_MINUTES = 30
