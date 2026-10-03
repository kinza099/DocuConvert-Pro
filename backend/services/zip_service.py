import os
import zipfile
from pathlib import Path
from backend.config import OUTPUT_DIR
from backend.utils.file_helper import generate_unique_filename

def create_zip_archive(file_paths: list[str], zip_base_name: str = "DocuConvert_Pro_Bundle") -> tuple[str, str]:
    """
    Creates a ZIP archive containing the provided files.
    Returns (zip_filepath, zip_filename).
    """
    zip_filename = generate_unique_filename(f"{zip_base_name}.zip", prefix="bundle")
    zip_path = OUTPUT_DIR / zip_filename

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        added_names = set()
        for fpath_str in file_paths:
            fpath = Path(fpath_str)
            if fpath.exists() and fpath.is_file():
                # Avoid duplicate names inside the zip archive
                base_name = fpath.name
                arcname = base_name
                counter = 1
                while arcname in added_names:
                    stem = fpath.stem
                    suffix = fpath.suffix
                    arcname = f"{stem}_{counter}{suffix}"
                    counter += 1
                added_names.add(arcname)
                zipf.write(fpath, arcname=arcname)

    return str(zip_path), zip_filename
