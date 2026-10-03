<div align="center">

<img src="app_icon.ico" alt="DocuConvert Pro Logo" width="80"/>

# DocuConvert Pro

**A professional, offline document conversion and management tool for Windows**

[![Python](https://img.shields.io/badge/Python-3.10%2B-blue?logo=python)](https://python.org)
[![Flask](https://img.shields.io/badge/Flask-3.x-black?logo=flask)](https://flask.palletsprojects.com)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows)](https://www.microsoft.com/windows)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

[Features](#-features) • [Installation](#-installation) • [Run from Source](#-run-from-source) • [Build EXE](#-build-the-exe-yourself) • [Screenshots](#-screenshots)

</div>

---

## ✨ Features

| Tool | Description |
|------|-------------|
| 📄 **Word → PDF** | Convert `.docx`/`.doc` to PDF with 100% layout fidelity using Microsoft Word (silent, no popup) |
| 📝 **PDF → Word** | Convert PDF to editable `.docx` preserving tables, fonts, and images |
| 🔗 **Merge PDF** | Combine multiple PDFs into one — output named `original_merged.pdf` |
| ✂️ **Split PDF** | Split by page ranges, every N pages, extract pages, or split into individual files |
| 🔄 **Rotate PDF** | Rotate all or specific pages by 90°, 180°, or 270° |
| 📋 **Page Manager** | Visual drag-and-drop page reordering, duplicate, delete, and rotate pages |
| 🔍 **PDF Metadata** | Inspect PDF version, author, creation date, page count, dimensions, and encryption |
| 🌙 **Dark / Light Mode** | Toggle with the sun icon in the top bar |
| 💾 **Native Save Dialog** | Every download opens Windows Save As — you choose exactly where to save |
| 🔒 **100% Offline** | No internet required, no data leaves your computer |

---

## 🖥️ Installation

### Option 1 — Download Ready-to-Use EXE (Easiest)

> No Python, no setup. Just download and run.

1. Go to the [**Releases**](https://github.com/kinza099/DocuConvert-Pro/releases) page
2. Download `DocuConvert-Pro.zip` from the latest release
3. Extract the ZIP anywhere on your PC (e.g. `C:\DocuConvert Pro\`)
4. Double-click **`DocuConvert Pro.exe`** to launch

> **Note:** Microsoft Word must be installed for Word → PDF conversion. PDF → Word works without Word.

---

### Option 2 — Run from Source Code

#### Prerequisites

| Requirement | Version |
|-------------|---------|
| Python | 3.10 or newer |
| pip | Latest |
| Microsoft Word | For Word→PDF only (optional) |

#### Step-by-Step

**1. Clone the repository**
```bash
git clone https://github.com/kinza099/DocuConvert-Pro.git
cd DocuConvert-Pro
```

**2. Create a virtual environment**
```bash
python -m venv venv
```

**3. Activate the virtual environment**

- **Windows (Command Prompt):**
  ```cmd
  venv\Scripts\activate
  ```
- **Windows (PowerShell):**
  ```powershell
  venv\Scripts\Activate.ps1
  ```

**4. Install all dependencies**
```bash
pip install -r requirements.txt
```

**5. Run the application**
```bash
python desktop_app.py
```

The app will open automatically as a desktop window.

---

## 📦 Requirements

All dependencies are listed in `requirements.txt`. Key packages:

```
flask
pywebview
pdf2docx
pymupdf
python-docx
reportlab
pywin32
pillow
pypdf
```

Install them all at once:
```bash
pip install -r requirements.txt
```

---

## 🔨 Build the EXE Yourself

Want to create your own standalone `.exe`?

**1. Install PyInstaller**
```bash
pip install pyinstaller
```

**2. Build using the included spec file**
```bash
pyinstaller --noconfirm DocuConvertPro.spec
```

**3. Find your EXE**
```
dist\DocuConvert Pro\DocuConvert Pro.exe
```

> The `_internal/` folder next to the EXE is required — do not delete it.

---

## 📁 Project Structure

```
DocuConvert-Pro/
│
├── desktop_app.py              # Main entry point (Flask + pywebview)
├── DocuConvertPro.spec         # PyInstaller build spec
├── requirements.txt            # Python dependencies
│
├── backend/
│   ├── app.py                  # Flask routes & API
│   ├── config.py               # Paths, upload/output dirs
│   ├── services/
│   │   ├── word_to_pdf.py      # Word → PDF conversion
│   │   ├── pdf_to_word.py      # PDF → Word conversion
│   │   ├── merge_split.py      # Merge & Split
│   │   ├── page_manager.py     # Page reorder / rotate
│   │   ├── compressor.py       # PDF compression
│   │   └── ...
│   └── utils/
│       ├── file_helper.py      # Smart filename generator
│       └── validation.py       # File validation
│
└── frontend/
    ├── templates/
    │   ├── base.html           # Base layout + dark mode
    │   ├── index.html          # Home dashboard
    │   └── page_manager.html   # Visual page manager
    └── static/
        ├── js/
        │   ├── tools-modal.js  # All tool modals & conversions
        │   ├── page_manager.js # Page manager UI logic
        │   └── app.js          # Dark mode, history, toasts
        └── css/
            └── style.css
```

---

## 🔒 Privacy

- All file processing happens **100% locally** on your machine
- No files are uploaded to any server
- Uploaded and generated files are automatically cleaned up after **2 hours**
- No telemetry, no analytics, no internet connection needed

---

## 🐛 Known Issues / Requirements

- **Word → PDF** requires **Microsoft Word** to be installed (Office 2016 or later recommended)
- **PDF → Word** works without Word using the `pdf2docx` library
- On first launch, Windows Defender / SmartScreen may warn about the EXE — click **"More info" → "Run anyway"** (this is normal for unsigned apps)

---

## 🤝 Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you'd like to change.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<div align="center">
Made with ❤️ — DocuConvert Pro
</div>
