import re
from pathlib import Path
import pymupdf
from backend.config import OUTPUT_DIR
from backend.utils.file_helper import smart_output_name

def merge_pdfs(file_paths: list[str], output_name: str = "Merged_Document.pdf") -> tuple[str, str, int]:
    """
    Merges multiple PDF files into one.
    Output: first_file_merged.pdf  (e.g. lab_01_merged.pdf)
    Returns (output_path, output_filename, total_pages).
    """
    if not file_paths:
        raise ValueError("No files provided for merging.")

    merged_doc = pymupdf.open()
    total_pages = 0

    for path_str in file_paths:
        fpath = Path(path_str)
        if not fpath.exists():
            continue
        try:
            sub_doc = pymupdf.open(str(fpath))
            merged_doc.insert_pdf(sub_doc)
            total_pages += len(sub_doc)
            sub_doc.close()
        except Exception as e:
            print(f"Error reading PDF {fpath.name}: {e}")
            raise RuntimeError(f"Could not merge '{fpath.name}': file may be corrupted.")

    if total_pages == 0:
        raise ValueError("Could not read any pages from the provided files.")

    # Name after the first file  →  lab_01_merged.pdf
    first_name = Path(file_paths[0]).name if file_paths else output_name
    output_filename = smart_output_name(first_name, ".pdf", "_merged")
    output_path = OUTPUT_DIR / output_filename
    merged_doc.save(str(output_path))
    merged_doc.close()

    return str(output_path), output_filename, total_pages

def parse_page_ranges(range_str: str, max_pages: int) -> list[list[int]]:
    """
    Parses strings like '1-3, 4, 5-7' into lists of 0-based page indices.
    e.g. [[0, 1, 2], [3], [4, 5, 6]]
    """
    groups = []
    parts = [p.strip() for p in range_str.split(",") if p.strip()]

    for part in parts:
        if "-" in part:
            sub = part.split("-")
            if len(sub) == 2:
                try:
                    start = max(1, int(sub[0].strip()))
                    end = min(max_pages, int(sub[1].strip()))
                    if start <= end:
                        groups.append(list(range(start - 1, end)))
                except ValueError:
                    continue
        else:
            try:
                page_num = int(part.strip())
                if 1 <= page_num <= max_pages:
                    groups.append([page_num - 1])
            except ValueError:
                continue
    return groups

def split_pdf(input_path: str, mode: str, param: str = "") -> list[dict]:
    """
    Splits a PDF by different modes:
    - 'ranges': param="1-5, 6-10" or "1, 3, 5"
    - 'every_n': param="2" (every 2 pages)
    - 'individual': 1 file per page
    - 'extract': param="1, 3, 5" (creates a single PDF with only these extracted pages)

    Returns list of dicts: [{"path": str, "filename": str, "pages_label": str}]
    """
    input_file = Path(input_path)
    if not input_file.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    doc = pymupdf.open(str(input_file))
    total_pages = len(doc)
    results = []

    if mode == "extract":
        # Create a single PDF with extracted pages
        extracted_pages = []
        for part in param.split(","):
            part = part.strip()
            if "-" in part:
                s, e = part.split("-")
                extracted_pages.extend(range(int(s) - 1, int(e)))
            elif part.isdigit():
                extracted_pages.append(int(part) - 1)

        # Filter valid and remove duplicates while preserving order
        valid_pages = []
        seen = set()
        for p in extracted_pages:
            if 0 <= p < total_pages and p not in seen:
                valid_pages.append(p)
                seen.add(p)

        if not valid_pages:
            raise ValueError("No valid pages selected for extraction.")

        new_doc = pymupdf.open()
        for p in valid_pages:
            new_doc.insert_pdf(doc, from_page=p, to_page=p)

        output_filename = smart_output_name(input_file.name, ".pdf", "_extracted")
        output_path = OUTPUT_DIR / output_filename
        new_doc.save(str(output_path))
        new_doc.close()

        page_str = ", ".join(str(p + 1) for p in valid_pages)
        results.append({
            "path": str(output_path),
            "filename": output_filename,
            "pages_label": f"Pages {page_str}"
        })

    elif mode == "ranges":
        groups = parse_page_ranges(param, total_pages)
        if not groups:
            raise ValueError("No valid page ranges specified.")

        for idx, grp in enumerate(groups):
            new_doc = pymupdf.open()
            for p in grp:
                new_doc.insert_pdf(doc, from_page=p, to_page=p)
            label = f"Pages {grp[0]+1}-{grp[-1]+1}" if len(grp) > 1 else f"Page {grp[0]+1}"
            output_filename = smart_output_name(input_file.name, ".pdf", f"_part{idx+1}")
            output_path = OUTPUT_DIR / output_filename
            new_doc.save(str(output_path))
            new_doc.close()
            results.append({
                "path": str(output_path),
                "filename": output_filename,
                "pages_label": label
            })

    elif mode == "every_n":
        try:
            n = max(1, int(param))
        except ValueError:
            n = 1

        for i in range(0, total_pages, n):
            end_page = min(i + n - 1, total_pages - 1)
            new_doc = pymupdf.open()
            new_doc.insert_pdf(doc, from_page=i, to_page=end_page)
            label = f"Pages {i+1}-{end_page+1}" if i != end_page else f"Page {i+1}"
            part_num = (i // n) + 1
            output_filename = smart_output_name(input_file.name, ".pdf", f"_part{part_num}")
            output_path = OUTPUT_DIR / output_filename
            new_doc.save(str(output_path))
            new_doc.close()
            results.append({
                "path": str(output_path),
                "filename": output_filename,
                "pages_label": label
            })

    elif mode == "individual":
        for i in range(total_pages):
            new_doc = pymupdf.open()
            new_doc.insert_pdf(doc, from_page=i, to_page=i)
            label = f"Page {i+1}"
            output_filename = smart_output_name(input_file.name, ".pdf", f"_page{i+1}")
            output_path = OUTPUT_DIR / output_filename
            new_doc.save(str(output_path))
            new_doc.close()
            results.append({
                "path": str(output_path),
                "filename": output_filename,
                "pages_label": label
            })

    else:
        raise ValueError(f"Unknown split mode: {mode}")

    doc.close()
    return results
