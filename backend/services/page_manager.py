import base64
from pathlib import Path
import pymupdf
from backend.config import OUTPUT_DIR
from backend.utils.file_helper import smart_output_name

def get_pdf_page_thumbnails(input_path: str, max_dimension: int = 300) -> list[dict]:
    """
    Renders each page of a PDF as a thumbnail base64 image.
    Returns list of {page_index, page_number, thumbnail, width, height, rotation}
    """
    input_file = Path(input_path)
    if not input_file.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    doc = pymupdf.open(str(input_file))
    pages_data = []

    for idx, page in enumerate(doc):
        rect = page.rect
        scale = max_dimension / max(rect.width, rect.height)
        matrix = pymupdf.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        img_bytes = pix.tobytes("jpeg")
        base64_str = base64.b64encode(img_bytes).decode("utf-8")
        data_url = f"data:image/jpeg;base64,{base64_str}"

        pages_data.append({
            "page_index": idx,
            "page_number": idx + 1,
            "thumbnail": data_url,
            "width": int(rect.width),
            "height": int(rect.height),
            "rotation": page.rotation
        })

    doc.close()
    return pages_data


def apply_page_modifications(input_path: str, page_operations: list[dict], output_name: str = None) -> tuple[str, str, int]:
    """
    Applies page manager operations (reorder, rotate, delete, duplicate).
    Output: original_stem_organized.pdf  (e.g. lab_01_organized.pdf)
    Returns (output_path, output_filename, total_pages).
    """
    input_file = Path(input_path)
    if not input_file.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    if not page_operations:
        raise ValueError("At least one page must be kept in the document.")

    src_doc = pymupdf.open(str(input_file))
    new_doc = pymupdf.open()

    for op in page_operations:
        src_idx = op.get("source_page")
        if 0 <= src_idx < len(src_doc):
            new_doc.insert_pdf(src_doc, from_page=src_idx, to_page=src_idx)
            new_page_idx = len(new_doc) - 1
            additional_rotation = op.get("rotation", 0)
            if additional_rotation:
                current_rot = new_doc[new_page_idx].rotation
                new_doc[new_page_idx].set_rotation((current_rot + additional_rotation) % 360)

    # Smart name: use original PDF name as base → lab_01_organized.pdf
    base_name = output_name or input_file.name
    output_filename = smart_output_name(base_name, ".pdf", "_organized")
    output_path = OUTPUT_DIR / output_filename

    new_doc.save(str(output_path), garbage=3, deflate=True)
    total_pages = len(new_doc)
    new_doc.close()
    src_doc.close()

    return str(output_path), output_filename, total_pages


def rotate_pdf_pages(input_path: str, rotation_angle: int, target_pages: str = "all") -> tuple[str, str]:
    """
    Rotates all or specific pages. Output: original_stem_rotated.pdf
    Returns (output_path, output_filename).
    """
    input_file = Path(input_path)
    doc = pymupdf.open(str(input_file))
    total_pages = len(doc)

    pages_to_rotate = set()
    if target_pages == "all":
        pages_to_rotate = set(range(total_pages))
    else:
        for p in target_pages.split(","):
            p = p.strip()
            if p.isdigit():
                idx = int(p) - 1
                if 0 <= idx < total_pages:
                    pages_to_rotate.add(idx)

    for idx in pages_to_rotate:
        page = doc[idx]
        page.set_rotation((page.rotation + rotation_angle) % 360)

    output_filename = smart_output_name(input_file.name, ".pdf", "_rotated")
    output_path = OUTPUT_DIR / output_filename
    doc.save(str(output_path), garbage=3, deflate=True)
    doc.close()

    return str(output_path), output_filename
