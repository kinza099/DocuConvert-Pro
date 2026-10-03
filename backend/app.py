import os
import traceback
from pathlib import Path
from flask import Flask, request, jsonify, send_file, render_template, abort
from flask_cors import CORS
from werkzeug.exceptions import RequestEntityTooLarge

from backend.config import (
    BASE_DIR, BUNDLE_DIR, UPLOAD_DIR, OUTPUT_DIR, SECRET_KEY,
    MAX_CONTENT_LENGTH, ALLOWED_EXTENSIONS
)
from backend.utils.validation import sanitize_filename, validate_extension, validate_pdf_header
from backend.utils.file_helper import generate_unique_filename, format_file_size
from backend.services.word_to_pdf import convert_word_to_pdf
from backend.services.pdf_to_word import convert_pdf_to_word
from backend.services.merge_split import merge_pdfs, split_pdf
from backend.services.compressor import compress_pdf
from backend.services.page_manager import get_pdf_page_thumbnails, apply_page_modifications, rotate_pdf_pages
from backend.services.metadata_extractor import extract_pdf_metadata
from backend.services.pdf_editor import apply_editor_edits
from backend.services.zip_service import create_zip_archive
from backend.services.history_service import add_history_entry, get_history_entries, clear_history
from backend.services.cleanup_service import cleanup_expired_files

app = Flask(
    __name__,
    template_folder=str(BUNDLE_DIR / "frontend" / "templates"),
    static_folder=str(BUNDLE_DIR / "frontend" / "static")
)
app.config["SECRET_KEY"] = SECRET_KEY
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH

CORS(app)

@app.errorhandler(RequestEntityTooLarge)
def handle_file_too_large(e):
    return jsonify({
        "success": False,
        "error": f"File is too large. Maximum allowable size is {MAX_CONTENT_LENGTH // (1024*1024)} MB."
    }), 413

@app.errorhandler(500)
def handle_internal_error(e):
    return jsonify({
        "success": False,
        "error": "An unexpected server error occurred during processing."
    }), 500

# ----------------- Frontend Views -----------------

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/editor")
def editor_view():
    return render_template("index.html")

@app.route("/page-manager")
def page_manager_view():
    return render_template("page_manager.html")

@app.route("/preview")
def preview_view():
    return render_template("index.html")

# ----------------- File Upload Endpoint -----------------

@app.route("/api/upload", methods=["POST"])
def upload_file():
    """Handles single or multiple file uploads securely."""
    if "files" not in request.files and "file" not in request.files:
        return jsonify({"success": False, "error": "No file uploaded."}), 400

    uploaded_files = request.files.getlist("files") or [request.files["file"]]
    category = request.form.get("category", "all_convert")
    results = []

    for f in uploaded_files:
        if not f or f.filename == "":
            continue

        raw_filename = f.filename
        if not validate_extension(raw_filename, category=category):
            return jsonify({
                "success": False,
                "error": f"File '{raw_filename}' has an unsupported file format."
            }), 400

        clean_name = sanitize_filename(raw_filename)
        saved_filename = generate_unique_filename(clean_name, prefix="up")
        save_path = UPLOAD_DIR / saved_filename

        try:
            f.save(str(save_path))
            file_size = save_path.stat().st_size

            results.append({
                "original_name": raw_filename,
                "saved_filename": saved_filename,
                "file_path": str(save_path),
                "file_size": file_size,
                "formatted_size": format_file_size(file_size),
                "extension": Path(clean_name).suffix.lower().lstrip(".")
            })
        except Exception as e:
            return jsonify({
                "success": False,
                "error": f"Failed to save uploaded file '{raw_filename}': {str(e)}"
            }), 500

    return jsonify({"success": True, "files": results})

# ----------------- Conversion Endpoints -----------------

@app.route("/api/convert/word-to-pdf", methods=["POST"])
def handle_word_to_pdf():
    data = request.get_json() or {}
    file_items = data.get("files", [])
    if not file_items and "file_path" in data:
        file_items = [{"file_path": data["file_path"], "original_name": data.get("original_name", "document.docx")}]

    if not file_items:
        return jsonify({"success": False, "error": "No files provided for conversion."}), 400

    converted_files = []
    errors = []

    for item in file_items:
        fpath = item.get("file_path")
        orig_name = item.get("original_name", Path(fpath).name if fpath else "document")
        try:
            out_path, out_name = convert_word_to_pdf(fpath, output_name=orig_name)
            out_size = Path(out_path).stat().st_size

            add_history_entry(
                operation="Word → PDF",
                original_filename=orig_name,
                output_filename=out_name,
                output_filepath=out_path,
                file_size=out_size,
                status="Completed"
            )

            converted_files.append({
                "original_name": orig_name,
                "output_filename": out_name,
                "output_path": out_path,
                "download_url": f"/api/download/{out_name}",
                "file_size": out_size,
                "formatted_size": format_file_size(out_size),
                "status": "success"
            })
        except Exception as e:
            traceback.print_exc()
            err_msg = str(e)
            add_history_entry(
                operation="Word → PDF",
                original_filename=orig_name,
                output_filename="",
                output_filepath="",
                file_size=0,
                status="Failed",
                error_message=err_msg
            )
            errors.append({"original_name": orig_name, "error": err_msg})

    return jsonify({
        "success": len(converted_files) > 0,
        "converted": converted_files,
        "errors": errors
    })

@app.route("/api/convert/pdf-to-word", methods=["POST"])
def handle_pdf_to_word():
    data = request.get_json() or {}
    file_items = data.get("files", [])
    enable_ocr = data.get("enable_ocr", False)

    if not file_items and "file_path" in data:
        file_items = [{"file_path": data["file_path"], "original_name": data.get("original_name", "document.pdf")}]

    if not file_items:
        return jsonify({"success": False, "error": "No files provided for conversion."}), 400

    converted_files = []
    errors = []

    for item in file_items:
        fpath = item.get("file_path")
        orig_name = item.get("original_name", Path(fpath).name if fpath else "document.pdf")
        try:
            out_path, out_name = convert_pdf_to_word(fpath, output_name=orig_name, enable_ocr=enable_ocr)
            out_size = Path(out_path).stat().st_size

            add_history_entry(
                operation="PDF → Word",
                original_filename=orig_name,
                output_filename=out_name,
                output_filepath=out_path,
                file_size=out_size,
                status="Completed"
            )

            converted_files.append({
                "original_name": orig_name,
                "output_filename": out_name,
                "output_path": out_path,
                "download_url": f"/api/download/{out_name}",
                "file_size": out_size,
                "formatted_size": format_file_size(out_size),
                "status": "success"
            })
        except Exception as e:
            traceback.print_exc()
            err_msg = str(e)
            add_history_entry(
                operation="PDF → Word",
                original_filename=orig_name,
                output_filename="",
                output_filepath="",
                file_size=0,
                status="Failed",
                error_message=err_msg
            )
            errors.append({"original_name": orig_name, "error": err_msg})

    return jsonify({
        "success": len(converted_files) > 0,
        "converted": converted_files,
        "errors": errors
    })

# ----------------- Merge & Split Endpoints -----------------

@app.route("/api/pdf/merge", methods=["POST"])
def handle_merge():
    data = request.get_json() or {}
    file_paths = data.get("file_paths", [])
    output_name = data.get("output_name", "Merged_Document.pdf")

    if not file_paths or len(file_paths) < 2:
        return jsonify({"success": False, "error": "Please provide at least 2 PDF files to merge."}), 400

    try:
        out_path, out_name, total_pages = merge_pdfs(file_paths, output_name=output_name)
        out_size = Path(out_path).stat().st_size

        add_history_entry(
            operation="Merge PDF",
            original_filename=f"{len(file_paths)} files",
            output_filename=out_name,
            output_filepath=out_path,
            file_size=out_size,
            status="Completed"
        )

        return jsonify({
            "success": True,
            "output_filename": out_name,
            "output_path": out_path,
            "download_url": f"/api/download/{out_name}",
            "file_size": out_size,
            "formatted_size": format_file_size(out_size),
            "total_pages": total_pages
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/pdf/split", methods=["POST"])
def handle_split():
    data = request.get_json() or {}
    file_path = data.get("file_path")
    mode = data.get("mode", "individual")  # ranges, every_n, individual, extract
    param = data.get("param", "")
    orig_name = data.get("original_name", "document.pdf")

    if not file_path:
        return jsonify({"success": False, "error": "No file specified for splitting."}), 400

    try:
        results = split_pdf(file_path, mode=mode, param=param)
        file_paths_for_zip = []

        for item in results:
            item["download_url"] = f"/api/download/{item['filename']}"
            f_size = Path(item["path"]).stat().st_size
            item["file_size"] = f_size
            item["formatted_size"] = format_file_size(f_size)
            file_paths_for_zip.append(item["path"])

        zip_url = ""
        zip_filename = ""
        if len(results) > 1:
            zip_path, zip_filename = create_zip_archive(file_paths_for_zip, zip_base_name=f"{Path(orig_name).stem}_split")
            zip_url = f"/api/download/{zip_filename}"

        add_history_entry(
            operation=f"Split PDF ({mode})",
            original_filename=orig_name,
            output_filename=f"{len(results)} parts" if len(results) > 1 else results[0]["filename"],
            output_filepath=results[0]["path"] if results else "",
            file_size=sum(r["file_size"] for r in results),
            status="Completed"
        )

        return jsonify({
            "success": True,
            "files": results,
            "zip_url": zip_url,
            "zip_filename": zip_filename,
            "total_parts": len(results)
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

# ----------------- Compress PDF Endpoint -----------------

@app.route("/api/pdf/compress", methods=["POST"])
def handle_compress():
    data = request.get_json() or {}
    file_path = data.get("file_path")
    level = data.get("level", "medium")  # low, medium, high
    orig_name = data.get("original_name", "document.pdf")

    if not file_path:
        return jsonify({"success": False, "error": "No file specified for compression."}), 400

    try:
        stats = compress_pdf(file_path, level=level)
        stats["download_url"] = f"/api/download/{stats['output_filename']}"

        add_history_entry(
            operation=f"Compress PDF ({level.capitalize()})",
            original_filename=orig_name,
            output_filename=stats["output_filename"],
            output_filepath=stats["output_path"],
            file_size=stats["compressed_size"],
            status="Completed"
        )

        return jsonify({"success": True, "stats": stats})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

# ----------------- Page Manager Endpoints -----------------

@app.route("/api/pdf/pages/thumbnails", methods=["POST"])
def handle_page_thumbnails():
    data = request.get_json() or {}
    file_path = data.get("file_path")
    if not file_path:
        return jsonify({"success": False, "error": "File path is required."}), 400

    try:
        thumbnails = get_pdf_page_thumbnails(file_path)
        return jsonify({"success": True, "pages": thumbnails, "total_pages": len(thumbnails)})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/pdf/pages/modify", methods=["POST"])
def handle_page_modify():
    data = request.get_json() or {}
    file_path = data.get("file_path")
    page_operations = data.get("operations", [])
    output_name = data.get("output_name")
    orig_name = data.get("original_name", "document.pdf")

    if not file_path or not page_operations:
        return jsonify({"success": False, "error": "File path and page operations are required."}), 400

    try:
        out_path, out_name, total_pages = apply_page_modifications(file_path, page_operations, output_name=output_name)
        out_size = Path(out_path).stat().st_size

        add_history_entry(
            operation="Page Manager Reorganization",
            original_filename=orig_name,
            output_filename=out_name,
            output_filepath=out_path,
            file_size=out_size,
            status="Completed"
        )

        return jsonify({
            "success": True,
            "output_filename": out_name,
            "output_path": out_path,
            "download_url": f"/api/download/{out_name}",
            "file_size": out_size,
            "formatted_size": format_file_size(out_size),
            "total_pages": total_pages
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/pdf/rotate", methods=["POST"])
def handle_pdf_rotate():
    data = request.get_json() or {}
    file_path = data.get("file_path")
    angle = int(data.get("angle", 90))
    target_pages = str(data.get("target_pages", "all"))
    orig_name = data.get("original_name", "document.pdf")

    if not file_path:
        return jsonify({"success": False, "error": "File path is required."}), 400

    try:
        out_path, out_name = rotate_pdf_pages(file_path, angle, target_pages=target_pages)
        out_size = Path(out_path).stat().st_size

        add_history_entry(
            operation=f"Rotate PDF ({angle}°)",
            original_filename=orig_name,
            output_filename=out_name,
            output_filepath=out_path,
            file_size=out_size,
            status="Completed"
        )

        return jsonify({
            "success": True,
            "output_filename": out_name,
            "output_path": out_path,
            "download_url": f"/api/download/{out_name}",
            "file_size": out_size,
            "formatted_size": format_file_size(out_size)
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

# ----------------- PDF Metadata Endpoint -----------------

@app.route("/api/pdf/metadata", methods=["POST"])
def handle_pdf_metadata():
    data = request.get_json() or {}
    file_path = data.get("file_path")
    if not file_path:
        return jsonify({"success": False, "error": "File path is required."}), 400

    try:
        metadata = extract_pdf_metadata(file_path)
        return jsonify({"success": True, "metadata": metadata})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

# ----------------- PDF Editor Save Endpoint -----------------

@app.route("/api/editor/save", methods=["POST"])
def handle_editor_save():
    data = request.get_json() or {}
    file_path = data.get("file_path")
    page_overlays = data.get("overlays", {})  # { "0": "data:image/png;base64,...", ... }
    redactions = data.get("redactions", [])
    orig_name = data.get("original_name", "document.pdf")

    if not file_path:
        return jsonify({"success": False, "error": "File path is required."}), 400

    try:
        out_path, out_name = apply_editor_edits(
            original_pdf_path=file_path,
            page_overlays=page_overlays,
            redactions=redactions,
            output_name=orig_name
        )
        out_size = Path(out_path).stat().st_size

        add_history_entry(
            operation="PDF Editor Edits",
            original_filename=orig_name,
            output_filename=out_name,
            output_filepath=out_path,
            file_size=out_size,
            status="Completed"
        )

        return jsonify({
            "success": True,
            "output_filename": out_name,
            "output_path": out_path,
            "download_url": f"/api/download/{out_name}",
            "file_size": out_size,
            "formatted_size": format_file_size(out_size)
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

# ----------------- Downloads & ZIP Endpoints -----------------

@app.route("/api/download/zip", methods=["POST"])
def handle_download_zip():
    data = request.get_json() or {}
    file_paths = data.get("file_paths", [])
    bundle_name = data.get("bundle_name", "DocuConvert_Bundle")

    if not file_paths:
        return jsonify({"success": False, "error": "No files provided for ZIP archive."}), 400

    try:
        zip_path, zip_filename = create_zip_archive(file_paths, zip_base_name=bundle_name)
        zip_size = Path(zip_path).stat().st_size

        return jsonify({
            "success": True,
            "zip_filename": zip_filename,
            "download_url": f"/api/download/{zip_filename}",
            "file_size": zip_size,
            "formatted_size": format_file_size(zip_size)
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/download/<filename>", methods=["GET"])
def download_file(filename: str):
    clean_name = sanitize_filename(filename)
    target_path = OUTPUT_DIR / clean_name

    # Check upload dir as fallback if user requests preview of uploaded file
    if not target_path.exists():
        target_path = UPLOAD_DIR / clean_name

    if not target_path.exists() or not target_path.is_file():
        abort(404, description="Requested file was not found or has expired.")

    as_attachment = request.args.get("view", "false").lower() != "true"
    return send_file(
        str(target_path),
        as_attachment=as_attachment,
        download_name=clean_name
    )

# ----------------- History Endpoints -----------------

@app.route("/api/history", methods=["GET"])
def get_history():
    entries = get_history_entries(limit=50)
    return jsonify({"success": True, "history": entries})

@app.route("/api/history", methods=["DELETE"])
def delete_history():
    cleared = clear_history()
    return jsonify({"success": cleared})

# ----------------- System & Cleanup -----------------

@app.route("/api/cleanup", methods=["POST"])
def trigger_cleanup():
    count = cleanup_expired_files()
    return jsonify({"success": True, "cleaned_files": count})

if __name__ == "__main__":
    print("Starting DocuConvert Pro server on http://127.0.0.1:5000 ...")
    app.run(host="0.0.0.0", port=5000, debug=True)
