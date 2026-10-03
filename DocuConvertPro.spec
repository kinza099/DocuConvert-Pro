# -*- mode: python ; coding: utf-8 -*-
import sys
from pathlib import Path

block_cipher = None

ROOT = Path.cwd()

datas = [
    (str(ROOT / 'frontend' / 'templates'), 'frontend/templates'),
    (str(ROOT / 'frontend' / 'static'), 'frontend/static'),
    (str(ROOT / 'backend'), 'backend'),
    (str(ROOT / 'app_icon.ico'), '.'),
]

hiddenimports = [
    # Flask & Web
    'jinja2',
    'jinja2.ext',
    'markupsafe',
    'werkzeug',
    'werkzeug.serving',
    'werkzeug.routing',
    'werkzeug.exceptions',
    'werkzeug.middleware',
    'werkzeug.middleware.proxy_fix',
    'flask',
    'flask.templating',
    'flask_cors',
    'itsdangerous',
    'click',
    # PDF
    'pymupdf',
    'pymupdf.utils',
    'fitz',
    'pypdf',
    'pypdf._reader',
    'pypdf.filters',
    'pypdf.generic',
    # PDF to Word
    'pdf2docx',
    'pdf2docx.converter',
    'pdf2docx.page',
    'pdf2docx.shape',
    'pdf2docx.text',
    'pdf2docx.common',
    # Word to PDF
    'docx',
    'docx.document',
    'docx.oxml',
    'docx.shared',
    'docx.enum.text',
    'docx.enum.style',
    # COM
    'win32com',
    'win32com.client',
    'win32com.server',
    'pythoncom',
    'pywintypes',
    'win32api',
    'win32con',
    'win32process',
    # PDF generation
    'reportlab',
    'reportlab.lib',
    'reportlab.lib.pagesizes',
    'reportlab.lib.styles',
    'reportlab.lib.colors',
    'reportlab.platypus',
    'reportlab.platypus.doctemplate',
    'reportlab.platypus.paragraph',
    'reportlab.platypus.tables',
    # Images
    'PIL',
    'PIL.Image',
    'PIL.ImageDraw',
    'PIL.ImageFont',
    # pywebview
    'webview',
    'webview.platforms',
    'webview.platforms.winforms',
    # clr / pythonnet
    'clr',
    # Misc
    'io',
    'uuid',
    'json',
    'threading',
    'socket',
    'pathlib',
    'shutil',
    'zipfile',
    'hashlib',
    'mimetypes',
    'datetime',
    'logging',
]

a = Analysis(
    ['desktop_app.py'],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'unittest', 'test', '_tkinter'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='DocuConvert Pro',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='app_icon.ico',
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='DocuConvert Pro',
)
