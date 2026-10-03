/**
 * preview.js — DocuConvert Pro PDF Preview
 * Uses PDF.js to render a PDF with navigation, zoom, rotation,
 * per-page thumbnail sidebar, and fullscreen support.
 */

'use strict';

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  pdfDoc: null,
  currentPage: 1,
  totalPages: 0,
  zoom: 1.0,           // numeric scale factor
  rotation: 0,         // cumulative rotation in degrees (0/90/180/270)
  rendering: false,
  thumbsVisible: true,
  uploadedFilename: null, // server-side saved filename for download link
  originalFileName: '',
};

// ── DOM Helpers ────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const uploadOverlay      = $('uploadOverlay');
const viewerShell        = $('viewerShell');
const dropZone           = $('dropZone');
const fileInput          = $('pdfFileInput');
const uploadError        = $('uploadError');

const canvas             = $('pdfCanvas');
const ctx                = canvas.getContext('2d');
const canvasWrapper      = $('canvasWrapper');
const pageSpinner        = $('pageLoadingSpinner');
const thumbContainer     = $('thumbContainer');
const thumbSidebar       = $('thumbSidebar');

const fileNameLabel      = $('fileNameLabel');
const fileSizeLabel      = $('fileSizeLabel');
const totalPagesLabel    = $('totalPagesLabel');
const currentPageInput   = $('currentPageInput');
const zoomSelect         = $('zoomSelect');
const zoomLabel          = $('zoomLabel');
const rotateLabel        = $('rotateLabel');
const statusBar          = $('statusBar');
const downloadLink       = $('downloadLink');
const metadataList       = $('metadataList');

// ── Drag & Drop ────────────────────────────────────────────────────────────
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('border-indigo-500', 'bg-indigo-50'); });
dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('border-indigo-500', 'bg-indigo-50'); });
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('border-indigo-500', 'bg-indigo-50');
  const file = e.dataTransfer.files[0];
  if (file) handleFileSelected(file);
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFileSelected(fileInput.files[0]); });

// ── File handling ──────────────────────────────────────────────────────────
async function handleFileSelected(file) {
  uploadError.classList.add('hidden');

  if (!file.name.toLowerCase().endsWith('.pdf') || file.type && !file.type.includes('pdf')) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showError('Please upload a valid PDF file.');
      return;
    }
  }
  if (file.size > 150 * 1024 * 1024) {
    showError('File exceeds the 150 MB limit.');
    return;
  }

  // Upload to server so we can generate a download link
  const formData = new FormData();
  formData.append('files', file);
  formData.append('category', 'pdf');

  setStatus('Uploading…');
  try {
    const resp = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await resp.json();
    if (!data.success) { showError(data.error || 'Upload failed.'); return; }
    const info = data.files[0];
    state.uploadedFilename = info.saved_filename;
    state.originalFileName = info.original_name;

    downloadLink.href     = `/api/download/${info.saved_filename}`;
    downloadLink.download = info.original_name;
    fileSizeLabel.textContent = info.formatted_size;

    // Load via ArrayBuffer for PDF.js
    const arrayBuf = await file.arrayBuffer();
    await loadPDF(arrayBuf);
    fetchMetadata(info.file_path);
  } catch (err) {
    showError('Network error: ' + err.message);
  }
}

async function loadPDF(source) {
  setStatus('Loading PDF…');
  try {
    const loadingTask = pdfjsLib.getDocument({ data: source });
    state.pdfDoc   = await loadingTask.promise;
    state.totalPages = state.pdfDoc.numPages;
    state.currentPage = 1;
    state.rotation = 0;

    totalPagesLabel.textContent  = state.totalPages;
    currentPageInput.max         = state.totalPages;
    currentPageInput.value       = 1;
    fileNameLabel.textContent    = state.originalFileName || 'document.pdf';

    // Switch to viewer
    uploadOverlay.classList.add('hidden');
    viewerShell.classList.remove('hidden');
    viewerShell.classList.add('flex');

    // Apply auto-fit zoom
    await applyAutoZoom();
    await renderPage(1);
    buildThumbnails();
    setStatus(`Loaded ${state.totalPages} page${state.totalPages !== 1 ? 's' : ''}`);
  } catch (err) {
    showError('Could not parse PDF: ' + err.message);
  }
}

// ── Zoom helpers ───────────────────────────────────────────────────────────
async function applyAutoZoom() {
  const page = await state.pdfDoc.getPage(1);
  const vp   = page.getViewport({ scale: 1, rotation: state.rotation });
  const containerW = $('canvasArea').clientWidth - 48; // minus padding
  state.zoom = Math.min(2, containerW / vp.width);
}

function resolveZoom(val, viewport) {
  if (val === 'auto') {
    const containerW = $('canvasArea').clientWidth - 48;
    return Math.min(2, containerW / viewport.width);
  }
  if (val === 'page-width') {
    const containerW = $('canvasArea').clientWidth - 48;
    return containerW / viewport.width;
  }
  return parseFloat(val);
}

// ── Page Rendering ─────────────────────────────────────────────────────────
async function renderPage(pageNum, scrollIntoView = true) {
  if (!state.pdfDoc || state.rendering) return;
  state.rendering = true;
  pageSpinner.classList.remove('hidden');

  try {
    const page = await state.pdfDoc.getPage(pageNum);
    const baseViewport = page.getViewport({ scale: 1, rotation: state.rotation });

    // Resolve zoom from select if needed
    const sel = zoomSelect.value;
    state.zoom = resolveZoom(sel, baseViewport);

    const viewport = page.getViewport({ scale: state.zoom, rotation: state.rotation });

    canvas.width  = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport }).promise;

    state.currentPage          = pageNum;
    currentPageInput.value     = pageNum;
    zoomLabel.textContent      = Math.round(state.zoom * 100) + '%';
    rotateLabel.textContent    = state.rotation + '°';
    setStatus(`Page ${pageNum} of ${state.totalPages}`);

    // Update active thumb
    document.querySelectorAll('.thumb-card').forEach((el, i) => {
      el.classList.toggle('ring-2', i + 1 === pageNum);
      el.classList.toggle('ring-indigo-500', i + 1 === pageNum);
    });

    if (scrollIntoView) {
      const thumb = document.querySelector(`.thumb-card[data-page="${pageNum}"]`);
      if (thumb) thumb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  } finally {
    state.rendering = false;
    pageSpinner.classList.add('hidden');
  }
}

// ── Thumbnail Builder ──────────────────────────────────────────────────────
async function buildThumbnails() {
  thumbContainer.innerHTML = '';
  for (let i = 1; i <= state.totalPages; i++) {
    const card = document.createElement('div');
    card.className = 'thumb-card cursor-pointer rounded-lg overflow-hidden border-2 border-transparent hover:border-indigo-400 transition-all bg-white shadow-sm group relative';
    card.dataset.page = i;

    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.className = 'w-full block';
    card.appendChild(thumbCanvas);

    const label = document.createElement('div');
    label.className = 'text-center text-xs text-slate-500 py-1 group-hover:text-indigo-600 transition-colors';
    label.textContent = i;
    card.appendChild(label);

    card.addEventListener('click', () => renderPage(i));
    thumbContainer.appendChild(card);

    // Render thumb (low-res, async, non-blocking)
    renderThumb(i, thumbCanvas);
  }
}

async function renderThumb(pageNum, thumbCanvas) {
  try {
    const page = await state.pdfDoc.getPage(pageNum);
    const vp   = page.getViewport({ scale: 0.2 });
    thumbCanvas.width  = vp.width;
    thumbCanvas.height = vp.height;
    await page.render({ canvasContext: thumbCanvas.getContext('2d'), viewport: vp }).promise;
  } catch (_) { /* ignore individual thumb errors */ }
}

// ── Toolbar Controls ───────────────────────────────────────────────────────
$('backBtn').addEventListener('click', () => {
  viewerShell.classList.remove('flex');
  viewerShell.classList.add('hidden');
  uploadOverlay.classList.remove('hidden');
  fileInput.value = '';
  state.pdfDoc = null;
  thumbContainer.innerHTML = '';
});

$('firstPageBtn').addEventListener('click', () => { if (state.currentPage > 1) renderPage(1); });
$('prevPageBtn').addEventListener('click',  () => { if (state.currentPage > 1) renderPage(state.currentPage - 1); });
$('nextPageBtn').addEventListener('click',  () => { if (state.currentPage < state.totalPages) renderPage(state.currentPage + 1); });
$('lastPageBtn').addEventListener('click',  () => { if (state.currentPage < state.totalPages) renderPage(state.totalPages); });

currentPageInput.addEventListener('change', () => {
  const p = parseInt(currentPageInput.value, 10);
  if (p >= 1 && p <= state.totalPages) renderPage(p);
  else currentPageInput.value = state.currentPage;
});

zoomSelect.addEventListener('change', () => renderPage(state.currentPage, false));

$('zoomInBtn').addEventListener('click', () => {
  const current = state.zoom;
  const steps = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const next = steps.find(s => s > current) || 2;
  setManualZoom(next);
});
$('zoomOutBtn').addEventListener('click', () => {
  const current = state.zoom;
  const steps = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const prev = [...steps].reverse().find(s => s < current) || 0.5;
  setManualZoom(prev);
});

function setManualZoom(scale) {
  zoomSelect.value = scale.toString();
  if (!['auto', 'page-width', '0.5', '0.75', '1', '1.25', '1.5', '2'].includes(zoomSelect.value)) {
    zoomSelect.value = '1';
  }
  renderPage(state.currentPage, false);
}

$('rotateCWBtn').addEventListener('click', () => {
  state.rotation = (state.rotation + 90) % 360;
  renderPage(state.currentPage, false);
});
$('rotateCCWBtn').addEventListener('click', () => {
  state.rotation = (state.rotation - 90 + 360) % 360;
  renderPage(state.currentPage, false);
});

$('toggleThumbsBtn').addEventListener('click', () => {
  state.thumbsVisible = !state.thumbsVisible;
  thumbSidebar.classList.toggle('hidden', !state.thumbsVisible);
});

$('fullscreenBtn').addEventListener('click', () => {
  const el = $('canvasArea');
  if (!document.fullscreenElement) {
    el.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
});

// Keyboard navigation
document.addEventListener('keydown', (e) => {
  if (!state.pdfDoc) return;
  if (['ArrowRight', 'PageDown'].includes(e.key)) renderPage(Math.min(state.currentPage + 1, state.totalPages));
  if (['ArrowLeft',  'PageUp'].includes(e.key))   renderPage(Math.max(state.currentPage - 1, 1));
  if (e.key === 'Home') renderPage(1);
  if (e.key === 'End')  renderPage(state.totalPages);
});

// ── Metadata fetch ─────────────────────────────────────────────────────────
async function fetchMetadata(filePath) {
  try {
    const resp = await fetch('/api/pdf/metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: filePath })
    });
    const data = await resp.json();
    if (!data.success) return;

    const meta = data.metadata;
    const infoPanel = $('infoPanel');
    infoPanel.classList.remove('hidden');

    const fields = [
      ['Pages',       meta.page_count],
      ['PDF Version', meta.pdf_version],
      ['File Size',   meta.formatted_size],
      ['Author',      meta.author],
      ['Creator',     meta.creator],
      ['Created',     meta.creation_date],
      ['Modified',    meta.modification_date],
      ['Encrypted',   meta.encrypted ? 'Yes' : 'No'],
    ];

    metadataList.innerHTML = fields
      .filter(([, v]) => v)
      .map(([k, v]) => `
        <div class="border-b border-slate-100 pb-2">
          <div class="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">${k}</div>
          <div class="text-slate-700 text-xs mt-0.5 break-words">${v}</div>
        </div>
      `).join('');
  } catch (_) { /* non-fatal */ }
}

// ── Utilities ──────────────────────────────────────────────────────────────
function showError(msg) {
  uploadError.textContent = msg;
  uploadError.classList.remove('hidden');
}

function setStatus(msg) {
  statusBar.textContent = msg;
}

// Init Lucide icons (page-level)
if (typeof lucide !== 'undefined') lucide.createIcons();
