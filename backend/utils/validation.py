import os
import re
from pathlib import Path
from werkzeug.utils import secure_filename
from backend.config import MAX_CONTENT_LENGTH, ALLOWED_EXTENSIONS

def sanitize_filename(filename: str) -> str:
    """Sanitizes filename and replaces dangerous characters."""
    base_name = os.path.basename(filename)
    clean_name = secure_filename(base_name)
    if not clean_name:
        clean_name = "document"
    # Ensure reasonable length
    clean_name = re.sub(r'[^a-zA-Z0-9_.-]', '_', clean_name)
    if len(clean_name) > 100:
        stem = Path(clean_name).stem[:90]
        ext = Path(clean_name).suffix
        clean_name = f"{stem}{ext}"
    return clean_name

def validate_extension(filename: str, category: str = "all_convert") -> bool:
    """Checks if the file extension is allowed."""
    ext = Path(filename).suffix.lower().lstrip(".")
    allowed = ALLOWED_EXTENSIONS.get(category, ALLOWED_EXTENSIONS["all_convert"])
    return ext in allowed

def validate_file_size(file_storage) -> bool:
    """Checks if the uploaded file is within allowable limits."""
    # Seek to end to check size, then seek back
    file_storage.seek(0, os.SEEK_END)
    size = file_storage.tell()
    file_storage.seek(0)
    return size <= MAX_CONTENT_LENGTH

def validate_pdf_header(file_path: str) -> bool:
    """Validates that a file starts with PDF signature bytes."""
    try:
        with open(file_path, "rb") as f:
            header = f.read(5)
            return header.startswith(b"%PDF-")
    except Exception:
        return False
