import time
import os
from pathlib import Path
from backend.config import UPLOAD_DIR, OUTPUT_DIR, FILE_EXPIRATION_HOURS

def cleanup_expired_files():
    """Deletes temporary files older than FILE_EXPIRATION_HOURS in uploads and outputs."""
    current_time = time.time()
    expiration_seconds = FILE_EXPIRATION_HOURS * 3600
    cleaned_count = 0

    for folder in [UPLOAD_DIR, OUTPUT_DIR]:
        if not folder.exists():
            continue
        for item in folder.glob("*"):
            if item.is_file():
                try:
                    file_age = current_time - item.stat().st_mtime
                    if file_age > expiration_seconds:
                        item.unlink(missing_ok=True)
                        cleaned_count += 1
                except Exception as e:
                    print(f"Failed to delete {item}: {e}")
    return cleaned_count
