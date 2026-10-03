"""
desktop_app.py — Native Desktop Executable Entrypoint for DocuConvert Pro
Starts local Flask backend and launches native desktop window using pywebview.
Exposes a JS API so the frontend can trigger native Windows Save As dialogs.
"""

import sys
import os
import socket
import threading
import time
import webbrowser
import urllib.request
from pathlib import Path

# ── Resolve project root ──────────────────────────────────────────────────────
if getattr(sys, "frozen", False):
    # Inside PyInstaller bundle — executable is in dist/DocuConvert Pro/
    ROOT = Path(sys.executable).resolve().parent
    INTERNAL = Path(sys._MEIPASS).resolve()
    # Make sure backend package is importable from _internal
    if str(INTERNAL) not in sys.path:
        sys.path.insert(0, str(INTERNAL))
else:
    ROOT = Path(__file__).resolve().parent
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))

from backend.app import app as flask_app

# Flask runs on a dynamically chosen free port
_flask_port: int = 0


def get_free_port() -> int:
    """Finds an unused local TCP port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def run_flask(port: int) -> None:
    """Run Flask in daemon thread (no reloader, no debug)."""
    flask_app.run(
        host="127.0.0.1",
        port=port,
        debug=False,
        use_reloader=False,
        threaded=True,
    )


def wait_for_server(port: int, timeout: float = 15.0) -> bool:
    """Block until Flask is accepting connections, or until timeout."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return True
        except (OSError, ConnectionRefusedError):
            time.sleep(0.1)
    return False


# ── pywebview JS API class ────────────────────────────────────────────────────

def _windows_save_dialog(filename: str, ext: str) -> str:
    """
    Show a native Windows Save-As dialog using ctypes + comdlg32.
    No tkinter required — works inside PyInstaller frozen bundle.
    Returns the chosen path string, or empty string if cancelled.
    """
    import ctypes
    import ctypes.wintypes as wt

    # lpstrFile / lpstrFileTitle must be c_void_p so we can pass a buffer address
    class OPENFILENAMEW(ctypes.Structure):
        _fields_ = [
            ("lStructSize",       wt.DWORD),
            ("hwndOwner",         wt.HWND),
            ("hInstance",         wt.HINSTANCE),
            ("lpstrFilter",       ctypes.c_wchar_p),
            ("lpstrCustomFilter", ctypes.c_wchar_p),
            ("nMaxCustFilter",    wt.DWORD),
            ("nFilterIndex",      wt.DWORD),
            ("lpstrFile",         ctypes.c_void_p),   # pointer to mutable buffer
            ("nMaxFile",          wt.DWORD),
            ("lpstrFileTitle",    ctypes.c_void_p),   # pointer to mutable buffer
            ("nMaxFileTitle",     wt.DWORD),
            ("lpstrInitialDir",   ctypes.c_wchar_p),
            ("lpstrTitle",        ctypes.c_wchar_p),
            ("Flags",             wt.DWORD),
            ("nFileOffset",       wt.WORD),
            ("nFileExtension",    wt.WORD),
            ("lpstrDefExt",       ctypes.c_wchar_p),
            ("lCustData",         wt.LPARAM),
            ("lpfnHook",          ctypes.c_void_p),
            ("lpTemplateName",    ctypes.c_wchar_p),
            ("pvReserved",        ctypes.c_void_p),
            ("dwReserved",        wt.DWORD),
            ("FlagsEx",           wt.DWORD),
        ]

    ext_filters = {
        ".pdf":  "PDF Document\0*.pdf\0All Files\0*.*\0\0",
        ".docx": "Word Document\0*.docx\0All Files\0*.*\0\0",
        ".doc":  "Word Document\0*.doc\0All Files\0*.*\0\0",
        ".zip":  "ZIP Archive\0*.zip\0All Files\0*.*\0\0",
    }
    filter_str = ext_filters.get(ext.lower(), "All Files\0*.*\0\0")

    # Writable buffer — Windows writes the chosen path back into this
    buf = ctypes.create_unicode_buffer(filename, 32767)

    OFN_OVERWRITEPROMPT = 0x00000002
    OFN_PATHMUSTEXIST   = 0x00000800
    OFN_NOCHANGEDIR     = 0x00000008

    ofn = OPENFILENAMEW()
    ofn.lStructSize  = ctypes.sizeof(OPENFILENAMEW)
    ofn.lpstrFilter  = filter_str
    ofn.lpstrFile    = ctypes.addressof(buf)   # pass raw address of buffer
    ofn.nMaxFile     = 32767
    ofn.lpstrTitle   = "Save File — DocuConvert Pro"
    ofn.lpstrDefExt  = ext.lstrip(".")
    ofn.Flags        = OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR

    ok = ctypes.windll.comdlg32.GetSaveFileNameW(ctypes.byref(ofn))
    return buf.value if ok else ""


class DesktopApi:
    """Methods exposed to JavaScript via window.pywebview.api.*"""

    def save_file(self, filename: str, download_path: str) -> dict:
        """
        Show a native Windows Save-As dialog (pure ctypes, NO tkinter),
        then fetch the file from Flask and write it to the chosen location.
        """
        try:
            ext = Path(filename).suffix.lower()
            save_path = _windows_save_dialog(filename, ext)

            if not save_path:
                return {"success": False, "cancelled": True}

            url = f"http://127.0.0.1:{_flask_port}{download_path}"
            with urllib.request.urlopen(url, timeout=60) as response:
                file_bytes = response.read()

            Path(save_path).write_bytes(file_bytes)
            return {"success": True, "saved_to": save_path}

        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def get_port(self) -> int:
        """Return the Flask port so JS can construct full URLs if needed."""
        return _flask_port


# ── Zoom injection helper ─────────────────────────────────────────────────────

ZOOM_JS = """
(function() {
    var style = document.getElementById('__dcpro_zoom__');
    if (!style) {
        style = document.createElement('style');
        style.id = '__dcpro_zoom__';
        document.head.appendChild(style);
    }
    style.textContent = 'html { zoom: 88% !important; }';
    document.documentElement.style.scrollBehavior = 'smooth';
})();
"""


def main() -> None:
    global _flask_port

    _flask_port = get_free_port()
    server_url = f"http://127.0.0.1:{_flask_port}"

    # ── Start Flask server ────────────────────────────────────────────────────
    server_thread = threading.Thread(
        target=run_flask, args=(_flask_port,), daemon=True
    )
    server_thread.start()

    if not wait_for_server(_flask_port):
        print(f"[ERROR] Flask server did not start on port {_flask_port}. Exiting.")
        sys.exit(1)

    print(f"[OK] Flask server running on {server_url}")

    # ── Try pywebview native window ───────────────────────────────────────────
    try:
        import webview

        api = DesktopApi()

        window = webview.create_window(
            title="DocuConvert Pro",
            url=server_url,
            js_api=api,
            width=1400,
            height=920,
            min_size=(1024, 680),
            text_select=True,
            confirm_close=False,
        )

        def on_loaded():
            """Inject zoom CSS + mark the app as running inside pywebview."""
            try:
                # Tell JS it's in desktop mode
                window.evaluate_js(
                    "window.__DCPRO_DESKTOP__ = true; "
                    "window.__DCPRO_PORT__ = " + str(_flask_port) + ";"
                )
                window.evaluate_js(ZOOM_JS)
            except Exception:
                pass

        # Re-apply zoom on every navigation
        window.events.loaded += on_loaded

        webview.start(func=on_loaded)

    except Exception as exc:
        # ── Browser fallback ──────────────────────────────────────────────────
        print(f"[WARN] pywebview failed ({exc}). Opening in default browser...")
        webbrowser.open(server_url)
        print("DocuConvert Pro is running in your browser.")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
