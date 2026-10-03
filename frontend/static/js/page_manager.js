/**
 * page_manager.js — DocuConvert Pro PDF Page Manager
 *
 * Features:
 *   • Upload PDF → fetch page thumbnails from server
 *   • Drag-and-drop reordering (SortableJS)
 *   • Select/deselect pages (shift-click range, ctrl-click individual)
 *   • Rotate (CW / CCW) selected or all pages
 *   • Duplicate selected pages
 *   • Delete selected pages
 *   • Extract selected pages
 *   • Undo / Redo stack
 *   • Save → POST to /api/pdf/pages/modify → download result
 */

'use strict';

// ── Download helper (works in both EXE/pywebview and browser) ──────────────
async function downloadFile(filename, downloadPath) {
    if (window.__DCPRO_DESKTOP__ && window.pywebview && window.pywebview.api) {
        // EXE mode: show native Windows Save As dialog
        try {
            const result = await window.pywebview.api.save_file(filename, downloadPath);
            if (result && result.success) {
                showPmToast(`Saved to: ${result.saved_to}`, 'success');
            } else if (result && !result.cancelled) {
                showPmToast('Save failed: ' + (result.error || 'Unknown error'), 'error');
            }
        } catch (e) {
            showPmToast('Download error: ' + e.message, 'error');
        }
    } else {
        // Browser mode: use anchor click
        const a = document.createElement('a');
        a.href = downloadPath;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
}

function showPmToast(msg, type) {
    // Simple inline toast for page manager (no shared toast system on this page)
    const t = document.createElement('div');
    t.textContent = msg;
    const colors = type === 'success'
        ? 'bg-emerald-600 text-white'
        : 'bg-rose-600 text-white';
    t.className = `fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg ${colors}`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
}

// ── State ──────────────────────────────────────────────────────────────────
const pm = {
  filePath: null,
  originalName: '',
  totalPages: 0,

  // Array of page descriptor objects: { origIndex, rotation, label }
  pages: [],

  // Selected page indices (into pm.pages[])
  selected: new Set(),

  // Undo / Redo stacks  (each entry is a deep clone of pm.pages)
  undoStack: [],
  redoStack: [],

  lastClickedIdx: null,   // for shift-click range selection
  sortable: null,
  hasChanges: false,
};

// ── DOM ────────────────────────────────────────────────────────────────────
const $id = (id) => document.getElementById(id);

const uploadSection   = $id('uploadSection');
const managerShell    = $id('managerShell');
const dropZone        = $id('pmDropZone');
const fileInput       = $id('pmFileInput');
const uploadError     = $id('pmUploadError');
const pageGrid        = $id('pageGrid');
const loadingSpinner  = $id('pmLoadingSpinner');
const emptyState      = $id('pmEmptyState');
const pmFileName      = $id('pmFileName');
const pmPageCount     = $id('pmPageCount');
const pmStatus        = $id('pmStatus');
const pmChangesLabel  = $id('pmChangesLabel');
const selectedCount   = $id('selectedCount');
const undoBtn         = $id('pmUndoBtn');
const redoBtn         = $id('pmRedoBtn');
const resultPanel     = $id('resultPanel');
const resultDetails   = $id('resultDetails');
const resultDownload  = $id('resultDownloadBtn');

// ── Upload / Drop Zone ─────────────────────────────────────────────────────
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('border-violet-500', 'bg-violet-50');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('border-violet-500', 'bg-violet-50');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('border-violet-500', 'bg-violet-50');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

async function handleFile(file) {
  uploadError.classList.add('hidden');
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    showUploadError('Please upload a valid PDF file.');
    return;
  }
  if (file.size > 150 * 1024 * 1024) {
    showUploadError('File exceeds the 150 MB size limit.');
    return;
  }

  const formData = new FormData();
  formData.append('files', file);
  formData.append('category', 'pdf');

  setStatus('Uploading…');
  try {
    const resp = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await resp.json();
    if (!data.success) { showUploadError(data.error || 'Upload failed.'); return; }

    const info = data.files[0];
    pm.filePath     = info.file_path;
    pm.originalName = info.original_name;

    pmFileName.textContent = info.original_name;
    switchToManager();
    await loadThumbnails(info.file_path, info.original_name);
  } catch (err) {
    showUploadError('Network error: ' + err.message);
  }
}

function switchToManager() {
  uploadSection.classList.add('hidden');
  managerShell.classList.remove('hidden');
  managerShell.classList.add('flex');
}

function switchToUpload() {
  managerShell.classList.add('hidden');
  managerShell.classList.remove('flex');
  uploadSection.classList.remove('hidden');
  fileInput.value = '';
  pm.pages = [];
  pm.selected.clear();
  pm.undoStack = [];
  pm.redoStack = [];
  pm.hasChanges = false;
  pageGrid.innerHTML = '';
  pageGrid.classList.add('hidden');
}

// ── Thumbnail Loading ──────────────────────────────────────────────────────
async function loadThumbnails(filePath, origName) {
  loadingSpinner.classList.remove('hidden');
  pageGrid.classList.add('hidden');
  emptyState.classList.add('hidden');

  try {
    const resp = await fetch('/api/pdf/pages/thumbnails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: filePath })
    });
    const data = await resp.json();
    loadingSpinner.classList.add('hidden');

    if (!data.success) { setStatus('Error: ' + (data.error || 'Failed to load pages.')); return; }
    if (!data.pages || data.pages.length === 0) {
      emptyState.classList.remove('hidden');
      return;
    }

    pm.totalPages = data.total_pages;
    pmPageCount.textContent = `${pm.totalPages} page${pm.totalPages !== 1 ? 's' : ''}`;

    // Build initial pages array
    // API returns: { page_index (0-based), page_number (1-based), thumbnail (full data url), rotation }
    pm.pages = data.pages.map((p, i) => ({
      sourcePageIdx: p.page_index !== undefined ? p.page_index : i,  // 0-based, for ops
      pageNumber:    p.page_number    ?? (i + 1),                     // 1-based display
      rotation:      0,                                               // additional rotation applied in UI
      label:         `Page ${p.page_number ?? (i + 1)}`,
      thumbnail:     p.thumbnail || null,                             // full data URL (jpeg)
    }));

    renderGrid();
    initSortable();
    setStatus(`${pm.totalPages} pages loaded — drag to reorder`);
  } catch (err) {
    loadingSpinner.classList.add('hidden');
    setStatus('Error: ' + err.message);
  }
}

// ── Grid Rendering ─────────────────────────────────────────────────────────
function renderGrid() {
  pageGrid.innerHTML = '';

  pm.pages.forEach((page, idx) => {
    const card = document.createElement('div');
    card.className = [
      'page-card relative bg-white dark:bg-slate-900 rounded-xl border-2 transition-all duration-150 cursor-pointer shadow-sm group',
      pm.selected.has(idx) ? 'border-violet-500 dark:border-violet-400 ring-2 ring-violet-300 dark:ring-violet-800 shadow-violet-100 dark:shadow-none' : 'border-slate-200 dark:border-slate-800 hover:border-violet-300 dark:hover:border-violet-600',
    ].join(' ');
    card.dataset.idx = idx;

    // Selection checkbox
    const checkbox = document.createElement('div');
    checkbox.className = [
      'absolute top-2 left-2 w-5 h-5 rounded-full border-2 flex items-center justify-center z-10 transition-all',
      pm.selected.has(idx)
        ? 'bg-violet-600 border-violet-600 dark:bg-violet-500 dark:border-violet-500'
        : 'bg-white/80 dark:bg-slate-900/80 border-slate-300 dark:border-slate-600 group-hover:border-violet-400',
    ].join(' ');
    checkbox.innerHTML = pm.selected.has(idx)
      ? '<svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>'
      : '';
    card.appendChild(checkbox);

    // Page number badge
    const badge = document.createElement('div');
    badge.className = 'absolute top-2 right-2 bg-slate-800/80 dark:bg-slate-700/80 text-white text-[10px] px-1.5 py-0.5 rounded-md z-10 font-medium backdrop-blur-xs';
    badge.textContent = idx + 1;
    card.appendChild(badge);

    // Thumbnail image / placeholder
    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'aspect-[3/4] w-full bg-slate-100 dark:bg-slate-800/60 flex items-center justify-center overflow-hidden rounded-t-lg';

    if (page.thumbnail) {
      const img = document.createElement('img');
      img.src = page.thumbnail; // already a full data URL from server
      img.className = 'w-full h-full object-contain transition-transform duration-200';
      img.style.transform = `rotate(${page.rotation}deg)`;
      thumbWrap.appendChild(img);
    } else {
      const icon = document.createElement('div');
      icon.className = 'text-slate-300 dark:text-slate-600 flex flex-col items-center';
      icon.innerHTML = `<svg class="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg><span class="text-xs mt-1">Page ${page.pageNumber}</span>`;
      thumbWrap.appendChild(icon);
    }
    card.appendChild(thumbWrap);

    // Label
    const labelEl = document.createElement('div');
    labelEl.className = 'text-center text-xs text-slate-500 dark:text-slate-400 py-2 px-1 truncate';
    labelEl.textContent = page.label || `Page ${page.pageNumber}`;
    if (page.rotation) labelEl.textContent += ` (${page.rotation}°)`;
    card.appendChild(labelEl);

    // Per-card action mini-toolbar
    const miniBar = document.createElement('div');
    miniBar.className = 'hidden group-hover:flex absolute bottom-8 inset-x-0 justify-center space-x-1 px-1';
    miniBar.innerHTML = `
      <button class="pm-card-btn" data-action="rotate-cw"  title="Rotate CW">↻</button>
      <button class="pm-card-btn" data-action="duplicate"  title="Duplicate">⧉</button>
      <button class="pm-card-btn pm-card-btn-danger" data-action="delete" title="Delete">✕</button>
    `;
    miniBar.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'rotate-cw') { saveUndo(); pm.pages[idx].rotation = (pm.pages[idx].rotation + 90) % 360; markChanged(); renderGrid(); }
        if (action === 'duplicate') { saveUndo(); pm.pages.splice(idx + 1, 0, { ...pm.pages[idx] }); markChanged(); renderGrid(); initSortable(); }
        if (action === 'delete')    { saveUndo(); pm.pages.splice(idx, 1); pm.selected.delete(idx); markChanged(); renderGrid(); initSortable(); }
      });
    });
    card.appendChild(miniBar);

    // Selection click
    card.addEventListener('click', (e) => {
      if (e.shiftKey && pm.lastClickedIdx !== null) {
        const start = Math.min(pm.lastClickedIdx, idx);
        const end   = Math.max(pm.lastClickedIdx, idx);
        for (let i = start; i <= end; i++) pm.selected.add(i);
      } else if (e.ctrlKey || e.metaKey) {
        if (pm.selected.has(idx)) pm.selected.delete(idx);
        else pm.selected.add(idx);
      } else {
        if (pm.selected.size === 1 && pm.selected.has(idx)) {
          pm.selected.clear();
        } else {
          pm.selected.clear();
          pm.selected.add(idx);
        }
      }
      pm.lastClickedIdx = idx;
      updateSelectionUI();
      renderGrid(); // re-render to show selection state
    });

    pageGrid.appendChild(card);
  });

  pageGrid.classList.remove('hidden');
  updateSelectionUI();
  updateUndoRedoBtns();
}

// ── SortableJS ─────────────────────────────────────────────────────────────
function initSortable() {
  if (pm.sortable) pm.sortable.destroy();
  pm.sortable = Sortable.create(pageGrid, {
    animation: 150,
    ghostClass: 'opacity-30',
    chosenClass: 'scale-95',
    onEnd: (evt) => {
      if (evt.oldIndex === evt.newIndex) return;
      saveUndo();
      const moved = pm.pages.splice(evt.oldIndex, 1)[0];
      pm.pages.splice(evt.newIndex, 0, moved);
      pm.selected.clear();
      markChanged();
      renderGrid();
      initSortable();
    }
  });
}

// ── Selection Actions ──────────────────────────────────────────────────────
function updateSelectionUI() {
  const count = pm.selected.size;
  selectedCount.textContent = `${count} selected`;
}

$id('selectAllBtn').addEventListener('click', () => {
  pm.pages.forEach((_, i) => pm.selected.add(i));
  renderGrid();
});

$id('deselectAllBtn').addEventListener('click', () => {
  pm.selected.clear();
  renderGrid();
});

function getSelectedIndices() {
  return [...pm.selected].sort((a, b) => a - b);
}

$id('rotateSelCWBtn').addEventListener('click',  () => rotateSelected(90));
$id('rotateSelCCWBtn').addEventListener('click', () => rotateSelected(-90));

function rotateSelected(delta) {
  if (pm.selected.size === 0) return;
  saveUndo();
  pm.selected.forEach(i => {
    pm.pages[i].rotation = ((pm.pages[i].rotation + delta) + 360) % 360;
  });
  markChanged();
  renderGrid();
}

$id('duplicateSelBtn').addEventListener('click', () => {
  const idxs = getSelectedIndices().reverse(); // reverse so splice doesn't shift
  if (idxs.length === 0) return;
  saveUndo();
  idxs.forEach(i => pm.pages.splice(i + 1, 0, { ...pm.pages[i] }));
  pm.selected.clear();
  markChanged();
  renderGrid();
  initSortable();
});

$id('deleteSelBtn').addEventListener('click', () => {
  const idxs = getSelectedIndices().reverse();
  if (idxs.length === 0) return;
  saveUndo();
  idxs.forEach(i => pm.pages.splice(i, 1));
  pm.selected.clear();
  markChanged();
  renderGrid();
  initSortable();
});

$id('extractSelBtn').addEventListener('click', async () => {
  const idxs = getSelectedIndices();
  if (idxs.length === 0) { alert('Select pages to extract first.'); return; }

  // Build operations: only include selected pages, in order
  // Backend expects: { source_page: 0-based-int, rotation: int }
  const ops = idxs.map(i => ({
    source_page: pm.pages[i].sourcePageIdx,
    rotation:    pm.pages[i].rotation
  }));

  setStatus('Extracting selected pages…');
  try {
    const resp = await fetch('/api/pdf/pages/modify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_path: pm.filePath,
        operations: ops,
        output_name: 'Extracted_Pages_' + pm.originalName,
        original_name: pm.originalName
      })
    });
    const data = await resp.json();
    if (!data.success) { setStatus('Extract failed: ' + data.error); return; }

    // Trigger native Save As dialog (pywebview) or normal download (browser)
    await downloadFile(data.output_filename, data.download_url);
    setStatus('Extracted ' + idxs.length + ' pages — saved.');
  } catch (err) {
    setStatus('Error: ' + err.message);
  }
});

// ── Undo / Redo ────────────────────────────────────────────────────────────
function saveUndo() {
  pm.undoStack.push(JSON.parse(JSON.stringify(pm.pages)));
  pm.redoStack = [];
  updateUndoRedoBtns();
}

function updateUndoRedoBtns() {
  undoBtn.disabled = pm.undoStack.length === 0;
  redoBtn.disabled = pm.redoStack.length === 0;
}

undoBtn.addEventListener('click', () => {
  if (pm.undoStack.length === 0) return;
  pm.redoStack.push(JSON.parse(JSON.stringify(pm.pages)));
  pm.pages = pm.undoStack.pop();
  pm.selected.clear();
  renderGrid();
  initSortable();
  updateUndoRedoBtns();
});

redoBtn.addEventListener('click', () => {
  if (pm.redoStack.length === 0) return;
  pm.undoStack.push(JSON.parse(JSON.stringify(pm.pages)));
  pm.pages = pm.redoStack.pop();
  pm.selected.clear();
  renderGrid();
  initSortable();
  updateUndoRedoBtns();
});

// ── Save & Download ────────────────────────────────────────────────────────
$id('saveChangesBtn').addEventListener('click', saveAndDownload);

async function saveAndDownload() {
  if (pm.pages.length === 0) { alert('No pages to save.'); return; }

  // Build operations: keep pages in current (reordered) state with their rotations
  // Backend apply_page_modifications reads op.get("source_page") (0-based)
  const operations = pm.pages.map((p) => ({
    source_page: p.sourcePageIdx,   // 0-based original page index
    rotation:    p.rotation,        // additional rotation applied in UI
  }));

  setStatus('Saving…');
  $id('saveChangesBtn').disabled = true;

  try {
    const resp = await fetch('/api/pdf/pages/modify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_path: pm.filePath,
        operations,
        output_name: 'Reorganized_' + pm.originalName,
        original_name: pm.originalName
      })
    });
    const data = await resp.json();
    $id('saveChangesBtn').disabled = false;

    if (!data.success) {
      setStatus('Error: ' + (data.error || 'Save failed.'));
      return;
    }

    // Show result panel — store download info on button for click handler
    resultDetails.textContent = `${data.total_pages} pages · ${data.formatted_size}`;
    resultDownload.dataset.downloadUrl = data.download_url;
    resultDownload.dataset.filename = data.output_filename;
    resultPanel.classList.remove('hidden');
    pm.hasChanges = false;
    pmChangesLabel.classList.add('hidden');
    setStatus('Saved successfully!  Click Download to save file.');
  } catch (err) {
    $id('saveChangesBtn').disabled = false;
    setStatus('Error: ' + err.message);
  }
}

// ── Result Panel buttons ───────────────────────────────────────────────────
$id('resultCloseBtn').addEventListener('click', () => {
  resultPanel.classList.add('hidden');
});
$id('resultDownloadBtn').addEventListener('click', async () => {
  const url      = resultDownload.dataset.downloadUrl;
  const filename = resultDownload.dataset.filename;
  if (url && filename) {
    await downloadFile(filename, url);
  }
});
$id('resultNewBtn').addEventListener('click', () => {
  resultPanel.classList.add('hidden');
  switchToUpload();
});
$id('pmBackBtn').addEventListener('click', () => {
  if (pm.hasChanges && !confirm('You have unsaved changes. Discard them and open a new file?')) return;
  switchToUpload();
});

// ── Helpers ────────────────────────────────────────────────────────────────
function markChanged() {
  pm.hasChanges = true;
  pmChangesLabel.classList.remove('hidden');
}

function setStatus(msg) {
  pmStatus.textContent = msg;
}

function showUploadError(msg) {
  uploadError.textContent = msg;
  uploadError.classList.remove('hidden');
}

// ── Styles injected for mini toolbar buttons ───────────────────────────────
(function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .pm-tool-btn {
      display:inline-flex; align-items:center; justify-content:center;
      width:2rem; height:2rem; border-radius:.5rem;
      transition:background .15s, color .15s;
    }
    .pm-tool-btn:hover { background:#f1f5f9; }
    .dark .pm-tool-btn:hover { background:#1e293b; }
    .pm-tool-btn:disabled { opacity:.35; pointer-events:none; }
    .pm-card-btn {
      font-size:.75rem; width:1.5rem; height:1.5rem; border-radius:.25rem;
      background:rgba(255,255,255,.9); border:1px solid #e2e8f0; color:#1e293b;
      cursor:pointer; display:flex; align-items:center; justify-content:center;
      transition:background .15s;
    }
    .dark .pm-card-btn {
      background:rgba(30,41,59,.9); border:1px solid #334155; color:#f8fafc;
    }
    .pm-card-btn:hover { background:#e0e7ff; }
    .dark .pm-card-btn:hover { background:#312e81; }
    .pm-card-btn-danger:hover { background:#fee2e2; color:#dc2626; }
    .dark .pm-card-btn-danger:hover { background:#450a0a; color:#f87171; }
  `;
  document.head.appendChild(style);
})();

// Init Lucide icons
if (typeof lucide !== 'undefined') lucide.createIcons();
