import uuid
import time
from pathlib import Path
from backend.utils.validation import sanitize_filename
from backend.config import OUTPUT_DIR


def clean_stem(filename: str) -> str:
    """Return a clean, sanitized filename stem (no extension, no leading dots)."""
    name = sanitize_filename(filename)
    stem = Path(name).stem
    return stem if stem else "document"


def smart_output_name(original_filename: str, new_extension: str, suffix: str = "") -> str:
    """
    Build a clean output filename:
    - Keeps original stem  (lab_01.docx  →  lab_01)
    - Appends optional suffix  (_merged, _compressed, _part1 …)
    - Changes extension   (.docx → .pdf)
    - Adds NO random hash — if a file with same name already exists,
      appends a short numeric counter (_1, _2 …) to avoid overwriting.

    Examples:
        smart_output_name("lab_01.docx", ".pdf")            → "lab_01.pdf"
        smart_output_name("lab_01.pdf",  ".pdf", "_merged") → "lab_01_merged.pdf"
        smart_output_name("lab_01.pdf",  ".pdf", "_part1")  → "lab_01_part1.pdf"
    """
    stem = clean_stem(original_filename)
    if not new_extension.startswith("."):
        new_extension = f".{new_extension}"

    base = f"{stem}{suffix}"
    candidate = OUTPUT_DIR / f"{base}{new_extension}"

    # Only add counter if that exact file already exists
    counter = 1
    while candidate.exists():
        candidate = OUTPUT_DIR / f"{base}_{counter}{new_extension}"
        counter += 1

    return candidate.name


def unique_path(filename: str) -> Path:
    """Return full OUTPUT_DIR path for a given output filename."""
    return OUTPUT_DIR / filename


# ── Legacy helper — kept so existing callers don't break ─────────────────────

def generate_unique_filename(original_filename: str, prefix: str = "", extension_override: str = None) -> str:
    """Legacy helper — prefer smart_output_name() for new code."""
    clean_name = sanitize_filename(original_filename)
    stem = Path(clean_name).stem
    ext = extension_override if extension_override else Path(clean_name).suffix
    if not ext.startswith("."):
        ext = f".{ext}"
    timestamp = int(time.time())
    unique_id = uuid.uuid4().hex[:8]
    if prefix:
        return f"{prefix}_{stem}_{timestamp}_{unique_id}{ext}"
    return f"{stem}_{timestamp}_{unique_id}{ext}"


def format_file_size(size_in_bytes: int) -> str:
    if size_in_bytes is None or size_in_bytes < 0:
        return "0 B"
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size_in_bytes < 1024.0:
            return f"{size_in_bytes:.2f} {unit}" if unit != 'B' else f"{size_in_bytes} B"
        size_in_bytes /= 1024.0
    return f"{size_in_bytes:.2f} PB"
