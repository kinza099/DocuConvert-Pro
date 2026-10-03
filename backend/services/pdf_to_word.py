import os
import sys
import traceback
from pathlib import Path
from backend.config import OUTPUT_DIR
from backend.utils.file_helper import smart_output_name


def convert_pdf_to_word(input_path: str, output_name: str = None, enable_ocr: bool = False) -> tuple[str, str]:
    """
    Converts PDF to .docx. Output: original_stem.docx (e.g. lab_01.pdf → lab_01.docx)
    """
    input_file = Path(input_path).resolve()
    if not input_file.exists():
        raise FileNotFoundError(f"Input PDF not found: {input_path}")

    base_name = output_name or input_file.name
    output_filename = smart_output_name(base_name, ".docx")
    output_file = (OUTPUT_DIR / output_filename).resolve()

    # ── Strategy 1: pdf2docx (High Structural & Layout Preservation) ──────────
    if not enable_ocr:
        try:
            from pdf2docx import Converter

            cv = Converter(str(input_file))
            cv.convert(
                str(output_file),
                start=0,
                end=None,
                multi_processing=False,  # Single-process avoids Windows IPC errors
                cpu_count=1,
            )
            cv.close()

            if output_file.exists() and output_file.stat().st_size > 0:
                return str(output_file), output_filename
        except Exception as e:
            print(f"[pdf2docx] conversion failed: {e}. Trying robust PyMuPDF fallback...")

    # ── Strategy 2: PyMuPDF + python-docx High-Fidelity Silent Extractor ───────
    try:
        import pymupdf
        import io
        from docx import Document
        from docx.shared import Pt, Inches, RGBColor
        from docx.enum.text import WD_ALIGN_PARAGRAPH

        doc_out = Document()
        # Set standard 1-inch margins
        for section in doc_out.sections:
            section.top_margin = Inches(1)
            section.bottom_margin = Inches(1)
            section.left_margin = Inches(1)
            section.right_margin = Inches(1)

        pdf_doc = pymupdf.open(str(input_file))
        total_pages = len(pdf_doc)
        extracted_anything = False

        for page_idx, page in enumerate(pdf_doc):
            # Extract text blocks with layout info
            blocks = page.get_text("blocks")
            
            # Sort blocks by vertical position then horizontal
            blocks = sorted(blocks, key=lambda b: (b[1], b[0]))

            for b in blocks:
                text = b[4].strip()
                if not text:
                    continue
                extracted_anything = True

                # Determine if block looks like a heading
                lines = [l.strip() for l in text.split("\n") if l.strip()]
                full_text = " ".join(lines)

                # Heading detection (short text, title-case or uppercase)
                p = doc_out.add_paragraph()
                if len(full_text) < 60 and not full_text.endswith((".", ",", ";")):
                    run = p.add_run(full_text)
                    run.bold = True
                    run.font.size = Pt(13)
                    p.paragraph_format.space_before = Pt(6)
                    p.paragraph_format.space_after = Pt(4)
                else:
                    run = p.add_run(full_text)
                    run.font.size = Pt(10.5)
                    p.paragraph_format.space_after = Pt(4)

            # Also extract embedded images from the page
            image_list = page.get_images(full=True)
            for img_info in image_list[:5]:  # Limit to 5 largest images per page to avoid bloat
                try:
                    xref = img_info[0]
                    base_img = pdf_doc.extract_image(xref)
                    img_bytes = base_img["image"]
                    img_ext = base_img["ext"]
                    if img_ext in ("png", "jpeg", "jpg", "bmp") and len(img_bytes) > 2048:
                        img_stream = io.BytesIO(img_bytes)
                        # Add image centered
                        img_p = doc_out.add_paragraph()
                        img_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                        img_p.add_run().add_picture(img_stream, width=Inches(4))
                except Exception:
                    pass

            if page_idx < total_pages - 1 and extracted_anything:
                doc_out.add_page_break()

        pdf_doc.close()

        if extracted_anything:
            doc_out.save(str(output_file))
            if output_file.exists() and output_file.stat().st_size > 0:
                return str(output_file), output_filename
    except Exception as e:
        print(f"[PyMuPDF Extractor] failed: {e}")

    # ── Strategy 3: Scanned / OCR text fallback ──────────────────────────────
    if enable_ocr:
        try:
            import pytesseract
            from PIL import Image
            import pymupdf
            from docx import Document

            doc_out = Document()
            pdf_doc = pymupdf.open(str(input_file))

            for page_idx, page in enumerate(pdf_doc):
                pix = page.get_pixmap(dpi=150)
                img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                ocr_text = pytesseract.image_to_string(img)
                if ocr_text.strip():
                    doc_out.add_paragraph(ocr_text.strip())
                if page_idx < len(pdf_doc) - 1:
                    doc_out.add_page_break()

            pdf_doc.close()
            doc_out.save(str(output_file))
            if output_file.exists() and output_file.stat().st_size > 0:
                return str(output_file), output_filename
        except Exception as ocr_err:
            print(f"[OCR mode] failed: {ocr_err}")

    raise RuntimeError(
        f"Could not convert PDF '{input_file.name}' to Word format. "
        "Please ensure the PDF is not password-protected."
    )
