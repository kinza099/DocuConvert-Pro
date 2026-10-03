from pathlib import Path
import datetime
import pymupdf
from backend.utils.file_helper import format_file_size

def parse_pdf_date(date_str: str) -> str:
    """Parses PDF date format D:YYYYMMDDHHmmSSOHH'mm' to human readable string."""
    if not date_str:
        return ""
    try:
        clean = date_str.replace("D:", "").replace("'", "")
        if len(clean) >= 14:
            dt = datetime.datetime.strptime(clean[:14], "%Y%m%d%H%M%S")
            return dt.strftime("%B %d, %Y, %I:%M %p")
        elif len(clean) >= 8:
            dt = datetime.datetime.strptime(clean[:8], "%Y%m%d")
            return dt.strftime("%B %d, %Y")
    except Exception:
        pass
    return date_str

def extract_pdf_metadata(file_path: str) -> dict:
    """
    Extracts comprehensive metadata and physical document characteristics from a PDF file.
    """
    path_obj = Path(file_path)
    if not path_obj.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    file_size = path_obj.stat().st_size
    doc = pymupdf.open(str(path_obj))

    meta = doc.metadata or {}
    total_pages = len(doc)

    # First page dimensions
    page_w, page_h = 0, 0
    if total_pages > 0:
        first_page = doc[0]
        page_w = round(first_page.rect.width, 1)
        page_h = round(first_page.rect.height, 1)

    # Format dimensions in inches (72 points per inch)
    width_in = round(page_w / 72.0, 2)
    height_in = round(page_h / 72.0, 2)
    dimensions_str = f"{width_in} x {height_in} in ({int(page_w)} x {int(page_h)} pt)"

    creation_date = parse_pdf_date(meta.get("creationDate", ""))
    mod_date = parse_pdf_date(meta.get("modDate", ""))

    result = {
        "filename": path_obj.name,
        "file_size": file_size,
        "file_size_formatted": format_file_size(file_size),
        "page_count": total_pages,
        "pdf_version": meta.get("format", "1.7"),
        "title": meta.get("title") or "",
        "author": meta.get("author") or "",
        "subject": meta.get("subject") or "",
        "keywords": meta.get("keywords") or "",
        "creator": meta.get("creator") or "",
        "producer": meta.get("producer") or "",
        "creation_date": creation_date,
        "modification_date": mod_date,
        "is_encrypted": doc.is_encrypted,
        "page_dimensions": dimensions_str,
        "width_pt": page_w,
        "height_pt": page_h
    }

    doc.close()
    return result
