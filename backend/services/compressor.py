import io
from pathlib import Path
from PIL import Image
import pymupdf
from backend.config import OUTPUT_DIR
from backend.utils.file_helper import smart_output_name, format_file_size


def compress_pdf(input_path: str, level: str = "medium") -> dict:
    """
    Compresses a PDF while PRESERVING all images visually.
    Images are re-encoded at lower JPEG quality — they stay in the PDF,
    just smaller. They are NEVER removed.

    Levels:
    - 'low':    Quality 85, minor stream compression only, images untouched
    - 'medium': Quality 72, moderate JPEG recompression, preserves visual quality
    - 'high':   Quality 55, stronger JPEG recompression, noticeable but acceptable

    Output filename: original_stem_compressed.pdf  (e.g. lab_01_compressed.pdf)
    """
    input_file = Path(input_path)
    if not input_file.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    original_size = input_file.stat().st_size
    output_filename = smart_output_name(input_file.name, ".pdf", "_compressed")
    output_path = OUTPUT_DIR / output_filename

    doc = pymupdf.open(str(input_file))

    # Settings per level — quality kept high enough to preserve visible images
    if level == "high":
        img_quality    = 55
        garbage_level  = 4
        max_dimension  = 1600   # px — never crop, just downsample if huge
        recompress     = True
    elif level == "medium":
        img_quality    = 72
        garbage_level  = 3
        max_dimension  = 2400
        recompress     = True
    else:  # low
        img_quality    = 85
        garbage_level  = 2
        max_dimension  = 9999   # effectively no downsample
        recompress     = False

    if recompress:
        for page_idx in range(len(doc)):
            page = doc[page_idx]
            for img_info in page.get_images(full=True):
                xref = img_info[0]
                try:
                    base_image   = doc.extract_image(xref)
                    image_bytes  = base_image["image"]
                    colorspace   = base_image.get("colorspace", 3)

                    # Skip tiny images (icons, lines) — not worth recompressing
                    if len(image_bytes) < 8192:
                        continue

                    pil_img = Image.open(io.BytesIO(image_bytes))

                    # Preserve transparency by compositing on white before JPEG
                    if pil_img.mode in ("RGBA", "LA"):
                        bg = Image.new("RGB", pil_img.size, (255, 255, 255))
                        bg.paste(pil_img, mask=pil_img.split()[-1])
                        pil_img = bg
                    elif pil_img.mode == "P":
                        pil_img = pil_img.convert("RGB")
                    elif pil_img.mode not in ("RGB", "L"):
                        pil_img = pil_img.convert("RGB")

                    # Gentle downsample only if image is unreasonably large
                    w, h = pil_img.size
                    if max(w, h) > max_dimension:
                        pil_img.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)

                    out_buf = io.BytesIO()
                    pil_img.save(out_buf, format="JPEG", quality=img_quality, optimize=True)
                    new_bytes = out_buf.getvalue()

                    # Only replace if we actually saved space
                    if len(new_bytes) < len(image_bytes):
                        doc.update_stream(xref, new_bytes)

                except Exception:
                    # Non-fatal: leave image unchanged if anything fails
                    continue

    # Save with stream compression; never drop pages or content
    doc.save(
        str(output_path),
        garbage=garbage_level,
        deflate=True,
        clean=True,
        linear=False,
    )
    doc.close()

    compressed_size = output_path.stat().st_size

    # Safety: if compressed is somehow larger, just copy original unchanged
    if compressed_size > original_size:
        import shutil
        shutil.copyfile(input_file, output_path)
        compressed_size = original_size

    reduction_pct = 0.0
    if original_size > 0:
        reduction_pct = round(((original_size - compressed_size) / original_size) * 100, 1)

    return {
        "output_path":         str(output_path),
        "output_filename":     output_filename,
        "original_size":       original_size,
        "original_size_str":   format_file_size(original_size),
        "compressed_size":     compressed_size,
        "compressed_size_str": format_file_size(compressed_size),
        "reduction_percentage": reduction_pct,
        "reduction_str":       f"{reduction_pct}%",
    }
