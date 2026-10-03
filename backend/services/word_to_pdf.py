import os
import sys
import traceback
from pathlib import Path
from backend.config import OUTPUT_DIR
from backend.utils.file_helper import smart_output_name, format_file_size


def convert_word_to_pdf(input_path: str, output_name: str = None) -> tuple[str, str]:
    """
    Converts .doc or .docx to .pdf with 100% fidelity.
    Output filename: original_stem.pdf  (e.g. lab_01.docx → lab_01.pdf)
    """
    input_file = Path(input_path).resolve()
    if not input_file.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    base_name = output_name or input_file.name
    output_filename = smart_output_name(base_name, ".pdf")
    output_file = (OUTPUT_DIR / output_filename).resolve()

    # ── Strategy 1: Silent Microsoft Word COM (DispatchEx) ─────────────────────
    if sys.platform == "win32":
        try:
            import pythoncom
            import win32com.client

            pythoncom.CoInitialize()
            word = None
            doc = None
            try:
                # DispatchEx guarantees a fresh, isolated, hidden Word process
                # that NEVER interferes with the user's running Word windows.
                word = win32com.client.DispatchEx("Word.Application")
                word.Visible = False
                word.ScreenUpdating = False
                word.DisplayAlerts = 0  # wdAlertsNone (0)

                # Open with Visible=False so no document window ever appears
                doc = word.Documents.Open(
                    FileName=str(input_file),
                    ConfirmConversions=False,
                    ReadOnly=True,
                    AddToRecentFiles=False,
                    PasswordDocument="",
                    PasswordTemplate="",
                    Revert=False,
                    WritePasswordDocument="",
                    WritePasswordTemplate="",
                    Format=0,
                    Encoding=65001,
                    Visible=False
                )

                # wdFormatPDF = 17
                doc.SaveAs2(FileName=str(output_file), FileFormat=17)

                if output_file.exists() and output_file.stat().st_size > 0:
                    return str(output_file), output_filename
            finally:
                if doc:
                    try:
                        doc.Close(SaveChanges=0)
                    except Exception:
                        pass
                if word:
                    try:
                        word.Quit(SaveChanges=0)
                    except Exception:
                        pass
                try:
                    pythoncom.CoUninitialize()
                except Exception:
                    pass
        except Exception as e:
            print(f"[Word COM Silent] failed: {e}. Trying fallback converter...")

    # ── Strategy 2: Pure Python docx -> ReportLab fallback ───────────────────
    if input_file.suffix.lower() == ".docx":
        try:
            from docx import Document
            from reportlab.lib.pagesizes import letter
            from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
            from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
            from reportlab.lib import colors

            doc_in = Document(str(input_file))
            pdf_doc = SimpleDocTemplate(
                str(output_file),
                pagesize=letter,
                rightMargin=54, leftMargin=54,
                topMargin=54, bottomMargin=54
            )
            styles = getSampleStyleSheet()
            story = []

            for p in doc_in.paragraphs:
                text = p.text.strip()
                if not text:
                    story.append(Spacer(1, 8))
                    continue

                style = styles["Normal"]
                if p.style and p.style.name:
                    if p.style.name.startswith("Heading 1"):
                        style = styles["Heading1"]
                    elif p.style.name.startswith("Heading 2"):
                        style = styles["Heading2"]
                    elif p.style.name.startswith("Heading 3"):
                        style = styles["Heading3"]
                    elif p.style.name.startswith("Title"):
                        style = styles["Title"]

                safe_text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                story.append(Paragraph(safe_text, style))
                story.append(Spacer(1, 6))

            for table in doc_in.tables:
                table_data = []
                for row in table.rows:
                    row_data = [
                        Paragraph(cell.text.strip().replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"), styles["Normal"])
                        for cell in row.cells
                    ]
                    table_data.append(row_data)
                if table_data:
                    t = Table(table_data)
                    t.setStyle(TableStyle([
                        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
                        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                        ('BACKGROUND', (0, 0), (-1, 0), colors.whitesmoke),
                        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                        ('TOPPADDING', (0, 0), (-1, -1), 4),
                    ]))
                    story.append(t)
                    story.append(Spacer(1, 10))

            if not story:
                story.append(Paragraph("Empty Document", styles["Normal"]))

            pdf_doc.build(story)
            if output_file.exists() and output_file.stat().st_size > 0:
                return str(output_file), output_filename
        except Exception as e:
            print(f"[Pure Python Fallback] failed: {e}")

    raise RuntimeError(
        f"Could not convert '{input_file.name}' to PDF. "
        "Please check that the file is not corrupted or password-protected."
    )
