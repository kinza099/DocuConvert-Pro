import base64
import io
from pathlib import Path
from PIL import Image
import pymupdf
from backend.config import OUTPUT_DIR
from backend.utils.file_helper import generate_unique_filename

def apply_editor_edits(
    original_pdf_path: str,
    page_overlays: dict,  # { "0": "data:image/png;base64,...", "1": "..." }
    redactions: list = None,  # [ {"page": 0, "rect": [x0, y0, x1, y1]} ]
    output_name: str = None
) -> tuple[str, str]:
    """
    Applies interactive editor modifications to a PDF:
    1. If permanent redactions are specified, permanently strips the underlying content using PyMuPDF redaction engine.
    2. Inserts high-resolution overlays containing new text, shapes, signatures, drawings, images, and whiteout.
    Returns (output_path, output_filename).
    """
    input_file = Path(original_pdf_path)
    if not input_file.exists():
        raise FileNotFoundError(f"Original PDF not found: {original_pdf_path}")

    doc = pymupdf.open(str(input_file))
    total_pages = len(doc)

    # Step 1: Apply genuine permanent redactions if provided
    if redactions:
        for red in redactions:
            p_num = red.get("page", 0)
            if 0 <= p_num < total_pages:
                page = doc[p_num]
                r_coords = red.get("rect")  # [x0, y0, x1, y1] in PDF points
                if r_coords and len(r_coords) == 4:
                    rect = pymupdf.Rect(r_coords[0], r_coords[1], r_coords[2], r_coords[3])
                    # Add redaction annotation and apply it
                    page.add_redact_annot(rect, fill=(0, 0, 0))
                    page.apply_redactions()

    # Step 2: Apply page visual overlays (text boxes, drawings, signatures, shapes, images)
    if page_overlays:
        for page_idx_str, data_url in page_overlays.items():
            try:
                page_idx = int(page_idx_str)
                if not (0 <= page_idx < total_pages):
                    continue
                if not data_url or not isinstance(data_url, str):
                    continue

                # Strip base64 prefix
                if "," in data_url:
                    base64_data = data_url.split(",", 1)[1]
                else:
                    base64_data = data_url

                img_bytes = base64.b64decode(base64_data)
                if not img_bytes:
                    continue

                page = doc[page_idx]
                page_rect = page.rect  # Current page dimensions (e.g. 612 x 792)

                # Insert overlay image covering the exact page rectangle
                page.insert_image(
                    page_rect,
                    stream=img_bytes,
                    overlay=True,  # Draw in front of existing content
                    keep_proportion=False
                )
            except Exception as e:
                print(f"Error applying overlay to page {page_idx_str}: {e}")

    stem = Path(output_name).stem if output_name else f"{input_file.stem}_edited"
    output_filename = generate_unique_filename(f"{stem}.pdf", prefix="edit")
    output_path = OUTPUT_DIR / output_filename

    doc.save(str(output_path), garbage=3, deflate=True)
    doc.close()

    return str(output_path), output_filename
