/**
 * DocuConvert Pro - Interactive Modal & Tool Controllers
 * Fully supports Light & Dark Modes
 */

// ── Universal Download Helper ─────────────────────────────────────────────────
// In pywebview (desktop EXE) mode, window.__DCPRO_DESKTOP__ is set to true.
// We call the Python JS-API (window.pywebview.api.save_file) which shows a
// native Windows Save-As dialog.  In browser mode we fall back to an <a> click.
// ─────────────────────────────────────────────────────────────────────────────

async function downloadFile(filename, downloadPath) {
    if (window.__DCPRO_DESKTOP__ && window.pywebview && window.pywebview.api) {
        try {
            showToast('Opening Save dialog…', 'info');
            const result = await window.pywebview.api.save_file(filename, downloadPath);
            if (result && result.success) {
                showToast('File saved successfully!', 'success');
            } else if (result && result.cancelled) {
                // User dismissed dialog — silently ignore
            } else {
                showToast('Save failed: ' + (result && result.error ? result.error : 'Unknown error'), 'error');
            }
        } catch (e) {
            showToast('Download error: ' + e, 'error');
        }
    } else {
        // Browser / web mode — standard anchor download
        const a = document.createElement('a');
        a.href = downloadPath;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
}

async function downloadZipFromPaths(filePaths, bundleName) {
    try {
        showToast('Preparing ZIP archive…', 'info');
        const res = await fetch('/api/download/zip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_paths: filePaths, bundle_name: bundleName })
        });
        const data = await res.json();
        if (data.success && data.download_url) {
            await downloadFile(data.zip_filename || bundleName + '.zip', data.download_url);
        } else {
            showToast('Failed to generate ZIP archive.', 'error');
        }
    } catch (e) {
        showToast('Error preparing ZIP download.', 'error');
    }
}

let currentTool = null;
let uploadedFiles = [];
let sortableInstance = null;

const toolConfigs = {
    wordToPdf: {
        title: "Word to PDF",
        subtitle: "Convert DOC and DOCX documents to standard PDF with 100% fidelity",
        icon: "file-type",
        colorClass: "bg-blue-600",
        accept: ".doc,.docx",
        multiple: true,
        category: "word"
    },
    pdfToWord: {
        title: "PDF to Word",
        subtitle: "Convert PDF documents to editable DOCX with layout, table, and image preservation",
        icon: "file-text",
        colorClass: "bg-indigo-600",
        accept: ".pdf",
        multiple: true,
        category: "pdf"
    },
    mergePdf: {
        title: "Merge PDF Files",
        subtitle: "Combine multiple PDF documents into a single file in your desired order",
        icon: "combine",
        colorClass: "bg-emerald-600",
        accept: ".pdf",
        multiple: true,
        category: "pdf"
    },
    splitPdf: {
        title: "Split PDF",
        subtitle: "Extract selected pages or split PDF by ranges or intervals",
        icon: "scissors",
        colorClass: "bg-amber-600",
        accept: ".pdf",
        multiple: false,
        category: "pdf"
    },
    compressPdf: {
        title: "Compress PDF",
        subtitle: "Shrink PDF file size while preserving high visual quality",
        icon: "minimize-2",
        colorClass: "bg-rose-600",
        accept: ".pdf",
        multiple: false,
        category: "pdf"
    },
    rotatePdf: {
        title: "Rotate PDF",
        subtitle: "Rotate all pages or specific pages clockwise or counter-clockwise",
        icon: "rotate-cw",
        colorClass: "bg-cyan-600",
        accept: ".pdf",
        multiple: false,
        category: "pdf"
    },
    metadataPdf: {
        title: "PDF Metadata & Inspector",
        subtitle: "Inspect file details, PDF version, author, dimensions, and creation dates",
        icon: "info",
        colorClass: "bg-slate-700 dark:bg-slate-600",
        accept: ".pdf",
        multiple: false,
        category: "pdf"
    }
};

function openToolModal(toolKey) {
    currentTool = toolKey;
    uploadedFiles = [];
    const cfg = toolConfigs[toolKey];
    if (!cfg) return;

    const modal = document.getElementById('toolModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalSubtitle = document.getElementById('modalSubtitle');
    const modalIconContainer = document.getElementById('modalIconContainer');
    const modalIcon = document.getElementById('modalIcon');
    const modalContent = document.getElementById('modalContent');
    const modalStatusText = document.getElementById('modalStatusText');
    const modalActions = document.getElementById('modalActions');

    modalTitle.textContent = cfg.title;
    modalSubtitle.textContent = cfg.subtitle;
    modalIconContainer.className = `w-10 h-10 rounded-xl flex items-center justify-center text-white ${cfg.colorClass}`;
    modalIcon.setAttribute('data-lucide', cfg.icon);
    modalStatusText.textContent = "Ready";
    modalActions.innerHTML = "";

    // Build initial upload view
    renderUploadZone(modalContent, cfg);

    modal.classList.remove('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeToolModal() {
    const modal = document.getElementById('toolModal');
    if (modal) modal.classList.add('hidden');
    uploadedFiles = [];
    currentTool = null;
    if (sortableInstance) {
        sortableInstance.destroy();
        sortableInstance = null;
    }
}

function renderUploadZone(container, cfg) {
    container.innerHTML = `
        <div id="dropzone" class="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-8 text-center hover:border-indigo-400 dark:hover:border-indigo-500 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-indigo-50/20 dark:hover:bg-indigo-950/20 transition-all cursor-pointer">
            <input type="file" id="fileInput" class="hidden" accept="${cfg.accept}" ${cfg.multiple ? 'multiple' : ''}>
            <div class="space-y-3 pointer-events-none">
                <div class="w-14 h-14 mx-auto rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shadow-sm">
                    <i data-lucide="upload-cloud" class="w-7 h-7"></i>
                </div>
                <div>
                    <p class="text-sm font-bold text-slate-800 dark:text-slate-200">
                        Click to select or drag and drop files here
                    </p>
                    <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Supported: ${cfg.accept} &bull; Up to 150 MB
                    </p>
                </div>
            </div>
        </div>

        <div id="fileListContainer" class="space-y-3 hidden">
            <div class="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300 pb-1">
                <span>Selected Documents (<span id="fileCountBadge">0</span>)</span>
                <button type="button" onclick="clearSelectedFiles()" class="text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300 hover:underline">Clear</button>
            </div>
            <div id="fileList" class="space-y-2 max-h-56 overflow-y-auto"></div>
        </div>

        <div id="toolSpecificOptions" class="space-y-4"></div>
        <div id="resultContainer" class="space-y-4 hidden"></div>
    `;

    if (typeof lucide !== 'undefined') lucide.createIcons();

    const dropzone = container.querySelector('#dropzone');
    const fileInput = container.querySelector('#fileInput');

    dropzone.addEventListener('click', () => fileInput.click());

    ['dragenter', 'dragover'].forEach(evt => {
        dropzone.addEventListener(evt, (e) => {
            e.preventDefault();
            dropzone.classList.add('dropzone-active');
        });
    });

    ['dragleave', 'drop'].forEach(evt => {
        dropzone.addEventListener(evt, (e) => {
            e.preventDefault();
            dropzone.classList.remove('dropzone-active');
        });
    });

    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = Array.from(dt.files);
        handleFilesSelected(files, cfg);
    });

    fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        handleFilesSelected(files, cfg);
    });

    // Populate tool-specific options
    renderToolOptions(container.querySelector('#toolSpecificOptions'));
}

function renderToolOptions(optionsContainer) {
    if (!optionsContainer) return;

    if (currentTool === 'pdfToWord') {
        optionsContainer.innerHTML = `
            <div class="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center space-x-3">
                <div class="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/60 flex items-center justify-center">
                    <i data-lucide="zap" class="w-4 h-4 text-indigo-600 dark:text-indigo-400"></i>
                </div>
                <div>
                    <h4 class="text-xs font-bold text-slate-900 dark:text-white">High-Fidelity Conversion</h4>
                    <p class="text-xs text-slate-500 dark:text-slate-400">Preserves layout, tables, fonts, and images automatically</p>
                </div>
            </div>
        `;
        if (typeof lucide !== 'undefined') lucide.createIcons();
    } else if (currentTool === 'compressPdf') {
        optionsContainer.innerHTML = `
            <div class="space-y-2">
                <label class="text-xs font-bold text-slate-700 dark:text-slate-300">Select Compression Level</label>
                <div class="grid grid-cols-3 gap-3">
                    <label class="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500 flex flex-col items-center text-center space-y-1">
                        <input type="radio" name="compressionLevel" value="low" class="text-indigo-600 focus:ring-indigo-500">
                        <span class="text-xs font-bold text-slate-800 dark:text-slate-200">Low</span>
                        <span class="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">High quality, slight reduction</span>
                    </label>
                    <label class="p-3 bg-indigo-50/50 dark:bg-indigo-950/40 border-2 border-indigo-500 rounded-xl cursor-pointer flex flex-col items-center text-center space-y-1">
                        <input type="radio" name="compressionLevel" value="medium" checked class="text-indigo-600 focus:ring-indigo-500">
                        <span class="text-xs font-bold text-indigo-900 dark:text-indigo-300">Medium</span>
                        <span class="text-[10px] text-indigo-700 dark:text-indigo-400 leading-tight">Recommended balance</span>
                    </label>
                    <label class="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500 flex flex-col items-center text-center space-y-1">
                        <input type="radio" name="compressionLevel" value="high" class="text-indigo-600 focus:ring-indigo-500">
                        <span class="text-xs font-bold text-slate-800 dark:text-slate-200">High</span>
                        <span class="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">Maximum size reduction</span>
                    </label>
                </div>
            </div>
        `;
    } else if (currentTool === 'splitPdf') {
        optionsContainer.innerHTML = `
            <div class="space-y-3">
                <label class="text-xs font-bold text-slate-700 dark:text-slate-300">Split Method</label>
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <button type="button" onclick="selectSplitMode('ranges')" id="splitModeBtn_ranges" class="p-2.5 text-xs font-bold rounded-xl border border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-center">Page Ranges</button>
                    <button type="button" onclick="selectSplitMode('extract')" id="splitModeBtn_extract" class="p-2.5 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 text-center hover:bg-slate-100 dark:hover:bg-slate-700">Extract Pages</button>
                    <button type="button" onclick="selectSplitMode('every_n')" id="splitModeBtn_every_n" class="p-2.5 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 text-center hover:bg-slate-100 dark:hover:bg-slate-700">Every N Pages</button>
                    <button type="button" onclick="selectSplitMode('individual')" id="splitModeBtn_individual" class="p-2.5 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 text-center hover:bg-slate-100 dark:hover:bg-slate-700">All Individual</button>
                </div>

                <div id="splitParamContainer" class="pt-2">
                    <label class="text-xs font-semibold text-slate-600 dark:text-slate-400" id="splitParamLabel">Page Ranges (e.g. 1-3, 4-6, 7-10)</label>
                    <input type="text" id="splitParamInput" value="1-2, 3-4" class="mt-1 block w-full rounded-xl border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:border-indigo-500 focus:ring-indigo-500" placeholder="e.g. 1-5, 6-10">
                </div>
            </div>
        `;
    } else if (currentTool === 'rotatePdf') {
        optionsContainer.innerHTML = `
            <div class="space-y-3">
                <label class="text-xs font-bold text-slate-700 dark:text-slate-300">Rotation Angle</label>
                <div class="grid grid-cols-3 gap-3">
                    <label class="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl cursor-pointer hover:border-cyan-400 dark:hover:border-cyan-500 flex flex-col items-center text-center space-y-1">
                        <input type="radio" name="rotateAngle" value="90" checked class="text-cyan-600 focus:ring-cyan-500">
                        <span class="text-xs font-bold text-slate-800 dark:text-slate-200">90° Clockwise</span>
                    </label>
                    <label class="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl cursor-pointer hover:border-cyan-400 dark:hover:border-cyan-500 flex flex-col items-center text-center space-y-1">
                        <input type="radio" name="rotateAngle" value="180" class="text-cyan-600 focus:ring-cyan-500">
                        <span class="text-xs font-bold text-slate-800 dark:text-slate-200">180° Flip</span>
                    </label>
                    <label class="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl cursor-pointer hover:border-cyan-400 dark:hover:border-cyan-500 flex flex-col items-center text-center space-y-1">
                        <input type="radio" name="rotateAngle" value="270" class="text-cyan-600 focus:ring-cyan-500">
                        <span class="text-xs font-bold text-slate-800 dark:text-slate-200">90° Counter-CW</span>
                    </label>
                </div>
                <div class="pt-2">
                    <label class="text-xs font-semibold text-slate-600 dark:text-slate-400">Apply to Pages</label>
                    <input type="text" id="rotatePagesInput" value="all" class="mt-1 block w-full rounded-xl border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:border-cyan-500 focus:ring-cyan-500" placeholder="'all' or comma-separated: 1, 3, 5">
                </div>
            </div>
        `;
    }
}

let activeSplitMode = 'ranges';
function selectSplitMode(mode) {
    activeSplitMode = mode;
    ['ranges', 'extract', 'every_n', 'individual'].forEach(m => {
        const btn = document.getElementById(`splitModeBtn_${m}`);
        if (btn) {
            if (m === mode) {
                btn.className = "p-2.5 text-xs font-bold rounded-xl border border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-center";
            } else {
                btn.className = "p-2.5 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 text-center hover:bg-slate-100 dark:hover:bg-slate-700";
            }
        }
    });

    const paramContainer = document.getElementById('splitParamContainer');
    const paramLabel = document.getElementById('splitParamLabel');
    const paramInput = document.getElementById('splitParamInput');

    if (mode === 'individual') {
        paramContainer.classList.add('hidden');
    } else {
        paramContainer.classList.remove('hidden');
        if (mode === 'ranges') {
            paramLabel.textContent = "Page Ranges (e.g. 1-3, 4-6, 7-10)";
            paramInput.placeholder = "1-2, 3-5";
            paramInput.value = "1-2, 3-4";
        } else if (mode === 'extract') {
            paramLabel.textContent = "Pages to Extract (e.g. 1, 3, 5 or 2-4)";
            paramInput.placeholder = "1, 3, 5";
            paramInput.value = "1, 2";
        } else if (mode === 'every_n') {
            paramLabel.textContent = "Split Every N Pages";
            paramInput.placeholder = "2";
            paramInput.value = "2";
        }
    }
}

async function handleFilesSelected(files, cfg) {
    if (!files || files.length === 0) return;

    if (!cfg.multiple && files.length > 1) {
        files = [files[0]];
    }

    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    formData.append('category', cfg.category);

    const modalStatusText = document.getElementById('modalStatusText');
    if (modalStatusText) modalStatusText.textContent = "Uploading & validating files...";

    try {
        const res = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();

        if (!data.success) {
            showToast(data.error || "Upload failed.", "error");
            if (modalStatusText) modalStatusText.textContent = "Upload failed";
            return;
        }

        if (cfg.multiple) {
            uploadedFiles = uploadedFiles.concat(data.files);
        } else {
            uploadedFiles = data.files;
        }

        renderUploadedFilesList();

        if (modalStatusText) modalStatusText.textContent = `${uploadedFiles.length} file(s) ready`;
        updateModalActionButtons();

        // If metadata tool, trigger inspection immediately
        if (currentTool === 'metadataPdf' && uploadedFiles.length > 0) {
            executeMetadataInspection();
        }

    } catch (e) {
        showToast("Error connecting to server for upload.", "error");
        if (modalStatusText) modalStatusText.textContent = "Connection error";
    }
}

function renderUploadedFilesList() {
    const container = document.getElementById('fileListContainer');
    const list = document.getElementById('fileList');
    const badge = document.getElementById('fileCountBadge');

    if (!container || !list) return;

    if (uploadedFiles.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    if (badge) badge.textContent = uploadedFiles.length;
    list.innerHTML = '';

    uploadedFiles.forEach((f, idx) => {
        const item = document.createElement('div');
        item.className = 'p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-between text-xs transition-colors hover:border-slate-300 dark:hover:border-slate-600';
        item.setAttribute('data-id', f.saved_filename);

        const isPdf = f.extension === 'pdf';
        item.innerHTML = `
            <div class="flex items-center space-x-3 truncate">
                ${currentTool === 'mergePdf' ? '<div class="cursor-grab text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"><i data-lucide="grip-vertical" class="w-4 h-4"></i></div>' : ''}
                <div class="p-2 rounded-lg ${isPdf ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-400' : 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-400'}">
                    <i data-lucide="${isPdf ? 'file' : 'file-text'}" class="w-4 h-4"></i>
                </div>
                <div class="truncate">
                    <p class="font-semibold text-slate-800 dark:text-slate-200 truncate">${f.original_name}</p>
                    <p class="text-[10px] text-slate-500 dark:text-slate-400">${f.formatted_size}</p>
                </div>
            </div>
            <button type="button" onclick="removeUploadedFile(${idx})" class="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
        `;
        list.appendChild(item);
    });

    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Enable drag-and-drop sorting for merge tool
    if (currentTool === 'mergePdf' && uploadedFiles.length > 1) {
        if (sortableInstance) sortableInstance.destroy();
        sortableInstance = new Sortable(list, {
            animation: 150,
            handle: '.cursor-grab',
            ghostClass: 'sortable-ghost',
            onEnd: function () {
                const newOrderIds = Array.from(list.children).map(el => el.getAttribute('data-id'));
                uploadedFiles.sort((a, b) => newOrderIds.indexOf(a.saved_filename) - newOrderIds.indexOf(b.saved_filename));
            }
        });
    }
}

function removeUploadedFile(index) {
    uploadedFiles.splice(index, 1);
    renderUploadedFilesList();
    updateModalActionButtons();
}

function clearSelectedFiles() {
    uploadedFiles = [];
    renderUploadedFilesList();
    updateModalActionButtons();
    const resultContainer = document.getElementById('resultContainer');
    if (resultContainer) resultContainer.classList.add('hidden');
}

function updateModalActionButtons() {
    const actions = document.getElementById('modalActions');
    if (!actions) return;
    actions.innerHTML = '';

    if (uploadedFiles.length === 0) return;

    if (currentTool === 'wordToPdf') {
        actions.innerHTML = `
            <button onclick="executeWordToPdf()" class="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm hover:shadow transition-all flex items-center space-x-1.5">
                <i data-lucide="refresh-cw" class="w-4 h-4"></i>
                <span>Convert to PDF</span>
            </button>
        `;
    } else if (currentTool === 'pdfToWord') {
        actions.innerHTML = `
            <button onclick="executePdfToWord()" class="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-sm hover:shadow transition-all flex items-center space-x-1.5">
                <i data-lucide="file-text" class="w-4 h-4"></i>
                <span>Convert to Word</span>
            </button>
        `;
    } else if (currentTool === 'mergePdf') {
        actions.innerHTML = `
            <button onclick="executeMergePdf()" ${uploadedFiles.length < 2 ? 'disabled class="opacity-50 cursor-not-allowed px-5 py-2 rounded-xl bg-emerald-600 text-white font-bold text-xs"' : 'class="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm hover:shadow transition-all"'} flex items-center space-x-1.5>
                <i data-lucide="combine" class="w-4 h-4 inline mr-1"></i>
                <span>Merge ${uploadedFiles.length} PDFs</span>
            </button>
        `;
    } else if (currentTool === 'splitPdf') {
        actions.innerHTML = `
            <button onclick="executeSplitPdf()" class="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-sm hover:shadow transition-all flex items-center space-x-1.5">
                <i data-lucide="scissors" class="w-4 h-4"></i>
                <span>Split Document</span>
            </button>
        `;
    } else if (currentTool === 'compressPdf') {
        actions.innerHTML = `
            <button onclick="executeCompressPdf()" class="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-sm hover:shadow transition-all flex items-center space-x-1.5">
                <i data-lucide="minimize-2" class="w-4 h-4"></i>
                <span>Compress PDF</span>
            </button>
        `;
    } else if (currentTool === 'rotatePdf') {
        actions.innerHTML = `
            <button onclick="executeRotatePdf()" class="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white font-bold text-xs shadow-sm hover:shadow transition-all flex items-center space-x-1.5">
                <i data-lucide="rotate-cw" class="w-4 h-4"></i>
                <span>Rotate & Save</span>
            </button>
        `;
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ----------------- Execution Handlers -----------------

async function executeWordToPdf() {
    if (uploadedFiles.length === 0) return;
    const modalStatusText = document.getElementById('modalStatusText');
    modalStatusText.textContent = "Converting Word documents to PDF...";

    const payload = {
        files: uploadedFiles.map(f => ({ file_path: f.file_path, original_name: f.original_name }))
    };

    try {
        const res = await fetch('/api/convert/word-to-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success && data.converted.length > 0) {
            showToast("Word conversion completed successfully!", "success");
            modalStatusText.textContent = "Conversion Complete";
            renderConversionResults(data.converted, "PDF Documents", "wordToPdfBundle");
        } else {
            const errMsg = data.errors && data.errors.length > 0 ? data.errors[0].error : (data.error || "Conversion failed.");
            showToast(errMsg, "error");
            modalStatusText.textContent = "Conversion Failed";
        }
    } catch (e) {
        showToast("Error processing Word to PDF.", "error");
        modalStatusText.textContent = "Server Error";
    }
}

async function executePdfToWord() {
    if (uploadedFiles.length === 0) return;
    const modalStatusText = document.getElementById('modalStatusText');
    modalStatusText.textContent = "Converting PDF to Word...";

    const ocrToggle = document.getElementById('ocrToggle');
    const enableOcr = ocrToggle ? ocrToggle.checked : false;

    const payload = {
        files: uploadedFiles.map(f => ({ file_path: f.file_path, original_name: f.original_name })),
        enable_ocr: enableOcr
    };

    try {
        const res = await fetch('/api/convert/pdf-to-word', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success && data.converted.length > 0) {
            showToast("PDF converted to Word successfully!", "success");
            modalStatusText.textContent = "Conversion Complete";
            renderConversionResults(data.converted, "Word Documents", "pdfToWordBundle");
        } else {
            const errMsg = data.errors && data.errors.length > 0 ? data.errors[0].error : (data.error || "Conversion failed.");
            showToast(errMsg, "error");
            modalStatusText.textContent = "Conversion Failed";
        }
    } catch (e) {
        showToast("Error processing PDF to Word.", "error");
        modalStatusText.textContent = "Server Error";
    }
}

async function executeMergePdf() {
    if (uploadedFiles.length < 2) return;
    const modalStatusText = document.getElementById('modalStatusText');
    modalStatusText.textContent = "Merging PDF documents...";

    const payload = {
        file_paths: uploadedFiles.map(f => f.file_path),
        output_name: "Merged_Document.pdf"
    };

    try {
        const res = await fetch('/api/pdf/merge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success) {
            showToast("PDFs merged successfully!", "success");
            modalStatusText.textContent = "Merge Complete";
            renderSingleResult({
                title: "Merged Document",
                filename: data.output_filename,
                size: data.formatted_size,
                extraInfo: `${data.total_pages} Total Pages`,
                downloadUrl: data.download_url
            });
        } else {
            showToast(data.error || "Merge failed.", "error");
            modalStatusText.textContent = "Merge Failed";
        }
    } catch (e) {
        showToast("Error merging PDFs.", "error");
    }
}

async function executeSplitPdf() {
    if (uploadedFiles.length === 0) return;
    const modalStatusText = document.getElementById('modalStatusText');
    modalStatusText.textContent = "Splitting PDF...";

    const paramInput = document.getElementById('splitParamInput');
    const param = paramInput ? paramInput.value.trim() : "";

    const payload = {
        file_path: uploadedFiles[0].file_path,
        original_name: uploadedFiles[0].original_name,
        mode: activeSplitMode,
        param: param
    };

    try {
        const res = await fetch('/api/pdf/split', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success && data.files.length > 0) {
            showToast(`Split into ${data.total_parts} part(s)!`, "success");
            modalStatusText.textContent = "Split Complete";
            renderSplitResults(data);
        } else {
            showToast(data.error || "Split failed.", "error");
            modalStatusText.textContent = "Split Failed";
        }
    } catch (e) {
        showToast("Error splitting PDF.", "error");
    }
}

async function executeCompressPdf() {
    if (uploadedFiles.length === 0) return;
    const modalStatusText = document.getElementById('modalStatusText');
    modalStatusText.textContent = "Compressing PDF...";

    const levelRadio = document.querySelector('input[name="compressionLevel"]:checked');
    const level = levelRadio ? levelRadio.value : "medium";

    const payload = {
        file_path: uploadedFiles[0].file_path,
        original_name: uploadedFiles[0].original_name,
        level: level
    };

    try {
        const res = await fetch('/api/pdf/compress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success) {
            showToast("Compressed successfully!", "success");
            modalStatusText.textContent = "Compression Complete";
            renderCompressionStats(data.stats);
        } else {
            showToast(data.error || "Compression failed.", "error");
            modalStatusText.textContent = "Compression Failed";
        }
    } catch (e) {
        showToast("Error compressing PDF.", "error");
    }
}

async function executeRotatePdf() {
    if (uploadedFiles.length === 0) return;
    const modalStatusText = document.getElementById('modalStatusText');
    modalStatusText.textContent = "Rotating PDF...";

    const angleRadio = document.querySelector('input[name="rotateAngle"]:checked');
    const angle = angleRadio ? parseInt(angleRadio.value) : 90;
    const pagesInput = document.getElementById('rotatePagesInput');
    const targetPages = pagesInput ? pagesInput.value.trim() : "all";

    const payload = {
        file_path: uploadedFiles[0].file_path,
        original_name: uploadedFiles[0].original_name,
        angle: angle,
        target_pages: targetPages
    };

    try {
        const res = await fetch('/api/pdf/rotate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success) {
            showToast("PDF rotated successfully!", "success");
            modalStatusText.textContent = "Rotation Complete";
            renderSingleResult({
                title: "Rotated Document",
                filename: data.output_filename,
                size: data.formatted_size,
                extraInfo: `Rotated by ${angle}°`,
                downloadUrl: data.download_url
            });
        } else {
            showToast(data.error || "Rotation failed.", "error");
            modalStatusText.textContent = "Rotation Failed";
        }
    } catch (e) {
        showToast("Error rotating PDF.", "error");
    }
}

async function executeMetadataInspection() {
    if (uploadedFiles.length === 0) return;
    const modalStatusText = document.getElementById('modalStatusText');
    modalStatusText.textContent = "Inspecting PDF metadata...";

    try {
        const res = await fetch('/api/pdf/metadata', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_path: uploadedFiles[0].file_path })
        });
        const data = await res.json();

        if (data.success && data.metadata) {
            modalStatusText.textContent = "Inspection Ready";
            renderMetadataDashboard(data.metadata);
        } else {
            showToast(data.error || "Could not read metadata.", "error");
            modalStatusText.textContent = "Metadata Read Error";
        }
    } catch (e) {
        showToast("Error extracting metadata.", "error");
    }
}

// ----------------- Output Renderers -----------------

function renderConversionResults(convertedList, label, bundleName) {
    const container = document.getElementById('resultContainer');
    if (!container) return;
    container.classList.remove('hidden');

    const paths = convertedList.map(c => c.output_path);

    let zipBtnHtml = '';
    if (convertedList.length > 1) {
        const pathsJson = encodeURIComponent(JSON.stringify(paths));
        zipBtnHtml = `
            <button onclick="downloadZipFromPaths(JSON.parse(decodeURIComponent('${pathsJson}')), '${bundleName}')" class="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-bold text-xs shadow-sm hover:shadow flex items-center space-x-1.5 transition-all">
                <i data-lucide="archive" class="w-4 h-4"></i>
                <span>Download All as ZIP</span>
            </button>
        `;
    }

    container.innerHTML = `
        <div class="p-4 bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl space-y-3">
            <div class="flex items-center justify-between">
                <div class="flex items-center space-x-2 text-emerald-800 dark:text-emerald-300 font-bold text-sm">
                    <i data-lucide="check-circle-2" class="w-5 h-5 text-emerald-600 dark:text-emerald-400"></i>
                    <span>${convertedList.length} ${label} Generated</span>
                </div>
                ${zipBtnHtml}
            </div>

            <div class="space-y-2 max-h-56 overflow-y-auto">
                ${convertedList.map(item => `
                    <div class="p-3 bg-white dark:bg-slate-800 border border-emerald-100 dark:border-emerald-900/60 rounded-xl flex items-center justify-between text-xs">
                        <div class="truncate pr-2">
                            <p class="font-semibold text-slate-800 dark:text-slate-200 truncate">${item.output_filename}</p>
                            <p class="text-[10px] text-slate-500 dark:text-slate-400">${item.formatted_size}</p>
                        </div>
                        <button onclick="downloadFile('${item.output_filename}', '${item.download_url}')" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center space-x-1 shadow-sm transition-colors cursor-pointer">
                            <i data-lucide="download" class="w-3.5 h-3.5"></i>
                            <span>Download</span>
                        </button>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderSingleResult({ title, filename, size, extraInfo, downloadUrl }) {
    const container = document.getElementById('resultContainer');
    if (!container) return;
    container.classList.remove('hidden');

    container.innerHTML = `
        <div class="p-6 bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl space-y-4 text-center">
            <div class="w-12 h-12 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <i data-lucide="check" class="w-6 h-6"></i>
            </div>
            <div>
                <h4 class="text-base font-bold text-slate-900 dark:text-white">${title}</h4>
                <p class="text-xs text-slate-600 dark:text-slate-300 mt-1">${filename} &bull; ${size} ${extraInfo ? `&bull; ${extraInfo}` : ''}</p>
            </div>
            <div class="flex justify-center pt-2">
                <button onclick="downloadFile('${filename}', '${downloadUrl}')" class="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow hover:shadow-md transition-all flex items-center space-x-2 cursor-pointer">
                    <i data-lucide="download" class="w-4 h-4"></i>
                    <span>Download File</span>
                </button>
            </div>
        </div>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderSplitResults(data) {
    const container = document.getElementById('resultContainer');
    if (!container) return;
    container.classList.remove('hidden');

    const zipButton = data.zip_url ? `
        <button onclick="downloadFile('${data.zip_filename || 'split_pages.zip'}', '${data.zip_url}')" class="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-bold text-xs shadow-sm flex items-center space-x-1.5 transition-colors cursor-pointer">
            <i data-lucide="archive" class="w-4 h-4"></i>
            <span>Download All as ZIP</span>
        </button>
    ` : '';

    container.innerHTML = `
        <div class="p-4 bg-amber-50/70 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl space-y-3">
            <div class="flex items-center justify-between">
                <span class="font-bold text-xs text-amber-900 dark:text-amber-300">${data.total_parts} Split PDF Part(s)</span>
                ${zipButton}
            </div>
            <div class="space-y-2 max-h-56 overflow-y-auto">
                ${data.files.map(f => `
                    <div class="p-3 bg-white dark:bg-slate-800 border border-amber-100 dark:border-amber-900/60 rounded-xl flex items-center justify-between text-xs">
                        <div class="truncate pr-2">
                            <span class="font-bold text-slate-800 dark:text-slate-200">${f.pages_label}</span>
                            <p class="text-[10px] text-slate-500 dark:text-slate-400 truncate">${f.filename} &bull; ${f.formatted_size}</p>
                        </div>
                        <button onclick="downloadFile('${f.filename}', '${f.download_url}')" class="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs flex items-center space-x-1 transition-colors cursor-pointer">
                            <i data-lucide="download" class="w-3.5 h-3.5"></i>
                            <span>Download</span>
                        </button>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderCompressionStats(stats) {
    const container = document.getElementById('resultContainer');
    if (!container) return;
    container.classList.remove('hidden');

    container.innerHTML = `
        <div class="p-6 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl space-y-5">
            <div class="grid grid-cols-3 gap-4 text-center">
                <div class="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                    <p class="text-[11px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Original Size</p>
                    <p class="text-base font-bold text-slate-800 dark:text-slate-200 mt-1">${stats.original_size_str}</p>
                </div>
                <div class="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                    <p class="text-[11px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Compressed Size</p>
                    <p class="text-base font-bold text-emerald-600 dark:text-emerald-400 mt-1">${stats.compressed_size_str}</p>
                </div>
                <div class="p-3 bg-emerald-50 dark:bg-emerald-950/60 rounded-xl border border-emerald-200 dark:border-emerald-800">
                    <p class="text-[11px] text-emerald-700 dark:text-emerald-400 uppercase font-semibold">Reduction</p>
                    <p class="text-base font-extrabold text-emerald-700 dark:text-emerald-300 mt-1">-${stats.reduction_str}</p>
                </div>
            </div>

            <div class="flex justify-center pt-2">
                <button onclick="downloadFile('${stats.output_filename || 'compressed.pdf'}', '${stats.download_url}')" class="px-6 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm shadow hover:shadow-md transition-all flex items-center space-x-2 cursor-pointer">
                    <i data-lucide="download" class="w-4 h-4"></i>
                    <span>Download Compressed PDF</span>
                </button>
            </div>
        </div>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderMetadataDashboard(meta) {
    const container = document.getElementById('resultContainer');
    if (!container) return;
    container.classList.remove('hidden');

    const fields = [
        { label: "File Name", val: meta.filename },
        { label: "File Size", val: meta.file_size_formatted },
        { label: "Total Pages", val: meta.page_count },
        { label: "PDF Format Version", val: meta.pdf_version },
        { label: "Page Dimensions", val: meta.page_dimensions },
        { label: "Author", val: meta.author || "—" },
        { label: "Creator / Producer", val: meta.creator || meta.producer || "—" },
        { label: "Creation Date", val: meta.creation_date || "—" },
        { label: "Modification Date", val: meta.modification_date || "—" },
        { label: "Encrypted", val: meta.is_encrypted ? "Yes" : "No" }
    ];

    container.innerHTML = `
        <div class="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl space-y-3">
            <h4 class="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">PDF Document Properties</h4>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                ${fields.map(f => `
                    <div class="p-2.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 flex flex-col justify-between">
                        <span class="text-slate-400 dark:text-slate-500 font-medium">${f.label}</span>
                        <span class="font-semibold text-slate-800 dark:text-slate-200 mt-0.5 truncate">${f.val}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Legacy alias — kept for any inline onclick calls still using the old name
async function downloadAsZip(pathsJson, bundleName) {
    const filePaths = JSON.parse(decodeURIComponent(pathsJson));
    await downloadZipFromPaths(filePaths, bundleName);
}
