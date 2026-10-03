/**
 * DocuConvert Pro - Interactive PDF Editor Studio
 */

let pdfDoc = null;
let currentPdfPath = null;
let currentPdfName = "document.pdf";
let currentPage = 1;
let totalPages = 1;
let currentZoom = 1.0;
let fabricCanvas = null;
let pdfBackgroundCanvas = null;
let currentTool = 'select';

// Per-page state caches: { [pageNumber]: fabricJsonState }
const pageAnnotations = {};
const pageRedactions = {}; // { [pageNumber]: [ { rect: [x0,y0,x1,y1] } ] }
const undoStacks = {};
const redoStacks = {};

// Signature Pad state
let sigPadCanvas = null;
let sigPadCtx = null;
let isDrawingSig = false;
let sigMode = 'draw';

document.addEventListener('DOMContentLoaded', () => {
    initEditor();
});

function initEditor() {
    pdfBackgroundCanvas = document.getElementById('pdfBackgroundCanvas');
    const fabricEl = document.getElementById('fabricCanvas');

    fabricCanvas = new fabric.Canvas('fabricCanvas', {
        selection: true,
        preserveObjectStacking: true
    });

    setupEventListeners();
    setupSignaturePad();

    // Check if a PDF path was passed via URL query parameter (e.g. ?file=...)
    const urlParams = new URLSearchParams(window.location.search);
    const fileParam = urlParams.get('file');
    const nameParam = urlParams.get('name');
    if (fileParam) {
        loadPdfFromUrl(`/api/download/${fileParam}`, nameParam || fileParam, fileParam);
    }
}

function setupEventListeners() {
    // File open input
    const fileInput = document.getElementById('editorFileInput');
    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                await uploadAndLoadPdf(file);
            }
        });
    }

    // Page navigation
    document.getElementById('prevPageBtn').addEventListener('click', () => changePage(currentPage - 1));
    document.getElementById('nextPageBtn').addEventListener('click', () => changePage(currentPage + 1));

    // Zoom controls
    document.getElementById('zoomInBtn').addEventListener('click', () => setZoom(currentZoom + 0.2));
    document.getElementById('zoomOutBtn').addEventListener('click', () => setZoom(Math.max(0.4, currentZoom - 0.2)));
    document.getElementById('fitWidthBtn').addEventListener('click', fitToWidth);

    // Undo / Redo
    document.getElementById('undoBtn').addEventListener('click', undo);
    document.getElementById('redoBtn').addEventListener('click', redo);

    // Save and Export
    document.getElementById('saveAndExportBtn').addEventListener('click', saveAndExportPdf);

    // Tool buttons
    setupToolButtons();

    // Fabric object events
    fabricCanvas.on('object:added', () => recordHistory());
    fabricCanvas.on('object:modified', () => recordHistory());
    fabricCanvas.on('object:removed', () => recordHistory());

    fabricCanvas.on('selection:created', onObjectSelected);
    fabricCanvas.on('selection:updated', onObjectSelected);
    fabricCanvas.on('selection:cleared', onObjectDeselected);

    // Delete key to remove selected object
    window.addEventListener('keydown', (e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditingText()) {
            deleteActiveObject();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            undo();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
            e.preventDefault();
            redo();
        }
    });

    document.getElementById('deleteObjectBtn').addEventListener('click', deleteActiveObject);

    // Canvas click event for adding text or shapes
    fabricCanvas.on('mouse:down', onCanvasMouseDown);
}

function isEditingText() {
    const active = fabricCanvas.getActiveObject();
    return active && active.isEditing;
}

// ----------------- PDF Loading & Page Rendering -----------------

async function uploadAndLoadPdf(file) {
    const formData = new FormData();
    formData.append('files', file);
    formData.append('category', 'pdf');

    try {
        showToast("Uploading document...", "info");
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success && data.files.length > 0) {
            const uploaded = data.files[0];
            currentPdfPath = uploaded.file_path;
            currentPdfName = uploaded.original_name;
            await loadPdfFromUrl(`/api/download/${uploaded.saved_filename}`, uploaded.original_name, uploaded.file_path);
        } else {
            showToast("Failed to upload document.", "error");
        }
    } catch (e) {
        showToast("Error uploading file.", "error");
    }
}

async function loadPdfFromUrl(url, displayName, serverPath) {
    try {
        currentPdfName = displayName || "document.pdf";
        currentPdfPath = serverPath || currentPdfPath;
        document.getElementById('currentPdfName').textContent = currentPdfName;

        const loadingTask = pdfjsLib.getDocument(url);
        pdfDoc = await loadingTask.promise;
        totalPages = pdfDoc.numPages;

        document.getElementById('totalPagesNum').textContent = totalPages;
        document.getElementById('sidebarPageCount').textContent = `${totalPages} pages`;

        document.getElementById('emptyEditorState').classList.add('hidden');
        document.getElementById('canvasContainerWrapper').classList.remove('hidden');

        renderSidebarThumbnails();
        await renderCurrentPage();

        showToast("Document loaded successfully!", "success");
    } catch (e) {
        console.error(e);
        showToast("Failed to render PDF document.", "error");
    }
}

async function renderCurrentPage() {
    if (!pdfDoc) return;

    // Save previous page annotations before switching
    saveCurrentPageAnnotations();

    document.getElementById('currentPageNum').textContent = currentPage;
    document.getElementById('prevPageBtn').disabled = currentPage <= 1;
    document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;

    const page = await pdfDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale: currentZoom });

    // Size background canvas
    pdfBackgroundCanvas.width = viewport.width;
    pdfBackgroundCanvas.height = viewport.height;
    const bgCtx = pdfBackgroundCanvas.getContext('2d');

    // Render PDF page to background canvas
    const renderContext = {
        canvasContext: bgCtx,
        viewport: viewport
    };
    await page.render(renderContext).promise;

    // Size Fabric canvas to match
    fabricCanvas.setWidth(viewport.width);
    fabricCanvas.setHeight(viewport.height);

    const wrapper = document.getElementById('canvasContainerWrapper');
    wrapper.style.width = `${viewport.width}px`;
    wrapper.style.height = `${viewport.height}px`;

    // Restore page annotations if cached
    fabricCanvas.clear();
    if (pageAnnotations[currentPage]) {
        fabricCanvas.loadFromJSON(pageAnnotations[currentPage], () => {
            fabricCanvas.renderAll();
        });
    }

    highlightActiveSidebarThumbnail();
}

function saveCurrentPageAnnotations() {
    if (fabricCanvas) {
        pageAnnotations[currentPage] = JSON.stringify(fabricCanvas.toJSON());
    }
}

async function changePage(pageNum) {
    if (pageNum < 1 || pageNum > totalPages) return;
    currentPage = pageNum;
    await renderCurrentPage();
}

function setZoom(newZoom) {
    currentZoom = Math.min(2.5, Math.max(0.4, Math.round(newZoom * 10) / 10));
    document.getElementById('zoomLevelDisplay').textContent = `${Math.round(currentZoom * 100)}%`;
    renderCurrentPage();
}

function fitToWidth() {
    const viewportWidth = document.getElementById('canvasViewport').clientWidth - 64;
    if (pdfDoc && viewportWidth > 200) {
        pdfDoc.getPage(currentPage).then(page => {
            const baseViewport = page.getViewport({ scale: 1.0 });
            setZoom(viewportWidth / baseViewport.width);
        });
    }
}

// ----------------- Sidebar Thumbnails -----------------

async function renderSidebarThumbnails() {
    const container = document.getElementById('sidebarThumbnails');
    container.innerHTML = '';

    for (let i = 1; i <= totalPages; i++) {
        const thumbCard = document.createElement('div');
        thumbCard.className = `p-2 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer hover:border-indigo-500 transition-all text-center space-y-1.5 ${i === currentPage ? 'ring-2 ring-indigo-500 border-indigo-500' : ''}`;
        thumbCard.id = `thumbCard_${i}`;
        thumbCard.onclick = () => changePage(i);

        const canvas = document.createElement('canvas');
        canvas.className = 'w-full rounded bg-white shadow-sm';
        thumbCard.appendChild(canvas);

        const label = document.createElement('span');
        label.className = 'text-[10px] text-slate-400 font-semibold block';
        label.textContent = `Page ${i}`;
        thumbCard.appendChild(label);

        container.appendChild(thumbCard);

        // Render mini preview
        pdfDoc.getPage(i).then(page => {
            const vp = page.getViewport({ scale: 0.2 });
            canvas.width = vp.width;
            canvas.height = vp.height;
            page.render({
                canvasContext: canvas.getContext('2d'),
                viewport: vp
            });
        });
    }
}

function highlightActiveSidebarThumbnail() {
    for (let i = 1; i <= totalPages; i++) {
        const card = document.getElementById(`thumbCard_${i}`);
        if (card) {
            if (i === currentPage) {
                card.className = "p-2 rounded-xl bg-slate-900 border border-indigo-500 ring-2 ring-indigo-500 cursor-pointer text-center space-y-1.5";
            } else {
                card.className = "p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 cursor-pointer text-center space-y-1.5";
            }
        }
    }
}

// ----------------- Tools & Mode Handlers -----------------

function setupToolButtons() {
    const tools = [
        'toolSelect', 'toolText', 'toolDraw', 'toolHighlight',
        'toolRect', 'toolCircle', 'toolLine', 'toolArrow',
        'toolWhiteout', 'toolRedaction', 'toolImage', 'toolSignature'
    ];

    tools.forEach(tid => {
        const btn = document.getElementById(tid);
        if (btn) {
            btn.addEventListener('click', () => {
                const modeName = tid.replace('tool', '').toLowerCase();
                setTool(modeName);
            });
        }
    });

    // Hidden image file upload
    const imageHidden = document.getElementById('imageInputHidden');
    if (imageHidden) {
        imageHidden.addEventListener('change', handleImageUpload);
    }

    // Formatting bar controls
    setupFormattingControls();
}

function setTool(toolName) {
    currentTool = toolName;

    // Reset styles on all tool buttons
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.classList.remove('bg-indigo-600', 'text-white');
        btn.classList.add('text-slate-400');
    });

    const activeBtn = document.getElementById(`tool${capitalize(toolName)}`);
    if (activeBtn) {
        activeBtn.classList.add('bg-indigo-600', 'text-white');
        activeBtn.classList.remove('text-slate-400');
    }

    const textControls = document.getElementById('textFormattingControls');
    const drawControls = document.getElementById('drawFormattingControls');

    // Reset fabric drawing mode
    fabricCanvas.isDrawingMode = false;
    fabricCanvas.selection = (toolName === 'select');

    if (toolName === 'draw') {
        fabricCanvas.isDrawingMode = true;
        fabricCanvas.freeDrawingBrush.width = parseInt(document.getElementById('brushSizeSlider').value) || 3;
        fabricCanvas.freeDrawingBrush.color = document.getElementById('brushColorPicker').value || '#ef4444';
        textControls.classList.add('hidden');
        drawControls.classList.remove('hidden');
    } else if (toolName === 'highlight') {
        fabricCanvas.isDrawingMode = true;
        fabricCanvas.freeDrawingBrush.width = 24;
        fabricCanvas.freeDrawingBrush.color = 'rgba(253, 224, 71, 0.4)'; // translucent yellow
        textControls.classList.add('hidden');
        drawControls.classList.remove('hidden');
    } else if (toolName === 'text') {
        textControls.classList.remove('hidden');
        drawControls.classList.add('hidden');
    } else if (toolName === 'image') {
        document.getElementById('imageInputHidden').click();
        setTool('select');
    } else if (toolName === 'signature') {
        openSignatureModal();
        setTool('select');
    } else {
        textControls.classList.remove('hidden');
        drawControls.classList.add('hidden');
    }
}

function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function onCanvasMouseDown(options) {
    if (currentTool === 'select' || fabricCanvas.isDrawingMode) return;

    const pointer = fabricCanvas.getPointer(options.e);

    if (currentTool === 'text') {
        const text = new fabric.IText('Double click to edit', {
            left: pointer.x,
            top: pointer.y,
            fontFamily: document.getElementById('fontFamilySelect').value,
            fontSize: parseInt(document.getElementById('fontSizeSelect').value),
            fill: document.getElementById('textColorPicker').value,
            selectable: true
        });
        fabricCanvas.add(text);
        fabricCanvas.setActiveObject(text);
        text.enterEditing();
        setTool('select');
    } else if (currentTool === 'rect') {
        const rect = new fabric.Rect({
            left: pointer.x,
            top: pointer.y,
            width: 120,
            height: 70,
            fill: 'rgba(99, 102, 241, 0.2)',
            stroke: '#4f46e5',
            strokeWidth: 2
        });
        fabricCanvas.add(rect);
        fabricCanvas.setActiveObject(rect);
        setTool('select');
    } else if (currentTool === 'circle') {
        const circle = new fabric.Circle({
            left: pointer.x,
            top: pointer.y,
            radius: 45,
            fill: 'rgba(99, 102, 241, 0.2)',
            stroke: '#4f46e5',
            strokeWidth: 2
        });
        fabricCanvas.add(circle);
        fabricCanvas.setActiveObject(circle);
        setTool('select');
    } else if (currentTool === 'line') {
        const line = new fabric.Line([pointer.x, pointer.y, pointer.x + 120, pointer.y], {
            stroke: '#ef4444',
            strokeWidth: 3
        });
        fabricCanvas.add(line);
        fabricCanvas.setActiveObject(line);
        setTool('select');
    } else if (currentTool === 'arrow') {
        addArrow(pointer.x, pointer.y);
        setTool('select');
    } else if (currentTool === 'whiteout') {
        const whiteout = new fabric.Rect({
            left: pointer.x,
            top: pointer.y,
            width: 140,
            height: 35,
            fill: '#ffffff',
            stroke: '#e2e8f0',
            strokeWidth: 1,
            selectable: true
        });
        fabricCanvas.add(whiteout);
        fabricCanvas.setActiveObject(whiteout);
        setTool('select');
    } else if (currentTool === 'redaction') {
        const redact = new fabric.Rect({
            left: pointer.x,
            top: pointer.y,
            width: 140,
            height: 35,
            fill: '#000000',
            stroke: '#000000',
            selectable: true,
            isRedaction: true
        });
        fabricCanvas.add(redact);
        fabricCanvas.setActiveObject(redact);

        // Record redaction coordinates in PDF points (72dpi scale)
        if (!pageRedactions[currentPage]) pageRedactions[currentPage] = [];
        const scaleFactor = 1 / currentZoom;
        pageRedactions[currentPage].push({
            rect: [
                pointer.x * scaleFactor,
                pointer.y * scaleFactor,
                (pointer.x + 140) * scaleFactor,
                (pointer.y + 35) * scaleFactor
            ]
        });

        showToast("Permanent redaction box added.", "info");
        setTool('select');
    }
}

function addArrow(fromX, fromY) {
    const toX = fromX + 120;
    const toY = fromY;
    const line = new fabric.Line([fromX, fromY, toX, toY], {
        stroke: '#ef4444',
        strokeWidth: 3,
        originX: 'center',
        originY: 'center'
    });
    const triangle = new fabric.Triangle({
        left: toX,
        top: toY,
        originX: 'center',
        originY: 'center',
        angle: 90,
        width: 12,
        height: 12,
        fill: '#ef4444'
    });
    const group = new fabric.Group([line, triangle], {
        left: fromX,
        top: fromY - 6
    });
    fabricCanvas.add(group);
    fabricCanvas.setActiveObject(group);
}

function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        fabric.Image.fromURL(event.target.result, (img) => {
            img.scaleToWidth(180);
            img.set({
                left: 100,
                top: 100
            });
            fabricCanvas.add(img);
            fabricCanvas.setActiveObject(img);
            showToast("Image added to page.", "success");
        });
    };
    reader.readAsDataURL(file);
}

// ----------------- Formatting Controls -----------------

function setupFormattingControls() {
    const fontSelect = document.getElementById('fontFamilySelect');
    const sizeSelect = document.getElementById('fontSizeSelect');
    const boldBtn = document.getElementById('boldBtn');
    const italicBtn = document.getElementById('italicBtn');
    const underlineBtn = document.getElementById('underlineBtn');
    const colorPicker = document.getElementById('textColorPicker');

    fontSelect.addEventListener('change', () => {
        const obj = fabricCanvas.getActiveObject();
        if (obj && obj.type === 'i-text') {
            obj.set('fontFamily', fontSelect.value);
            fabricCanvas.renderAll();
        }
    });

    sizeSelect.addEventListener('change', () => {
        const obj = fabricCanvas.getActiveObject();
        if (obj && obj.type === 'i-text') {
            obj.set('fontSize', parseInt(sizeSelect.value));
            fabricCanvas.renderAll();
        }
    });

    boldBtn.addEventListener('click', () => {
        const obj = fabricCanvas.getActiveObject();
        if (obj && obj.type === 'i-text') {
            obj.set('fontWeight', obj.fontWeight === 'bold' ? 'normal' : 'bold');
            fabricCanvas.renderAll();
        }
    });

    italicBtn.addEventListener('click', () => {
        const obj = fabricCanvas.getActiveObject();
        if (obj && obj.type === 'i-text') {
            obj.set('fontStyle', obj.fontStyle === 'italic' ? 'normal' : 'italic');
            fabricCanvas.renderAll();
        }
    });

    underlineBtn.addEventListener('click', () => {
        const obj = fabricCanvas.getActiveObject();
        if (obj && obj.type === 'i-text') {
            obj.set('underline', !obj.underline);
            fabricCanvas.renderAll();
        }
    });

    colorPicker.addEventListener('input', () => {
        const obj = fabricCanvas.getActiveObject();
        if (obj) {
            if (obj.type === 'i-text') {
                obj.set('fill', colorPicker.value);
            } else if (obj.stroke) {
                obj.set('stroke', colorPicker.value);
            }
            fabricCanvas.renderAll();
        }
    });

    // Draw / Brush controls
    const brushSlider = document.getElementById('brushSizeSlider');
    const brushSizeDisplay = document.getElementById('brushSizeDisplay');
    const brushPicker = document.getElementById('brushColorPicker');
    const opacitySlider = document.getElementById('opacitySlider');

    brushSlider.addEventListener('input', () => {
        brushSizeDisplay.textContent = `${brushSlider.value}px`;
        if (fabricCanvas.freeDrawingBrush) {
            fabricCanvas.freeDrawingBrush.width = parseInt(brushSlider.value);
        }
    });

    brushPicker.addEventListener('input', () => {
        if (fabricCanvas.freeDrawingBrush) {
            fabricCanvas.freeDrawingBrush.color = brushPicker.value;
        }
    });

    opacitySlider.addEventListener('input', () => {
        const active = fabricCanvas.getActiveObject();
        if (active) {
            active.set('opacity', parseFloat(opacitySlider.value));
            fabricCanvas.renderAll();
        }
    });
}

function onObjectSelected(e) {
    document.getElementById('deleteObjectBtn').classList.remove('hidden');
    const obj = e.selected[0];
    if (obj && obj.type === 'i-text') {
        document.getElementById('fontFamilySelect').value = obj.fontFamily || 'Inter';
        document.getElementById('fontSizeSelect').value = obj.fontSize || 16;
        document.getElementById('textColorPicker').value = obj.fill || '#000000';
    }
}

function onObjectDeselected() {
    document.getElementById('deleteObjectBtn').classList.add('hidden');
}

function deleteActiveObject() {
    const active = fabricCanvas.getActiveObject();
    if (active) {
        fabricCanvas.remove(active);
        fabricCanvas.discardActiveObject();
        fabricCanvas.renderAll();
    }
}

// ----------------- Undo / Redo System -----------------

function recordHistory() {
    if (!undoStacks[currentPage]) undoStacks[currentPage] = [];
    undoStacks[currentPage].push(JSON.stringify(fabricCanvas.toJSON()));
    redoStacks[currentPage] = []; // clear redo stack on new action
}

function undo() {
    if (!undoStacks[currentPage] || undoStacks[currentPage].length === 0) return;
    if (!redoStacks[currentPage]) redoStacks[currentPage] = [];

    // Push current to redo
    redoStacks[currentPage].push(JSON.stringify(fabricCanvas.toJSON()));

    const prevState = undoStacks[currentPage].pop();
    fabricCanvas.loadFromJSON(prevState, () => {
        fabricCanvas.renderAll();
    });
}

function redo() {
    if (!redoStacks[currentPage] || redoStacks[currentPage].length === 0) return;
    const nextState = redoStacks[currentPage].pop();

    if (!undoStacks[currentPage]) undoStacks[currentPage] = [];
    undoStacks[currentPage].push(JSON.stringify(fabricCanvas.toJSON()));

    fabricCanvas.loadFromJSON(nextState, () => {
        fabricCanvas.renderAll();
    });
}

// ----------------- Signature Modal -----------------

function setupSignaturePad() {
    sigPadCanvas = document.getElementById('sigPadCanvas');
    if (!sigPadCanvas) return;
    sigPadCtx = sigPadCanvas.getContext('2d');
    sigPadCtx.lineWidth = 2.5;
    sigPadCtx.lineCap = 'round';
    sigPadCtx.lineJoin = 'round';
    sigPadCtx.strokeStyle = '#1e1b4b';

    sigPadCanvas.addEventListener('mousedown', (e) => {
        isDrawingSig = true;
        sigPadCtx.beginPath();
        sigPadCtx.moveTo(e.offsetX, e.offsetY);
    });

    sigPadCanvas.addEventListener('mousemove', (e) => {
        if (!isDrawingSig) return;
        sigPadCtx.lineTo(e.offsetX, e.offsetY);
        sigPadCtx.stroke();
    });

    window.addEventListener('mouseup', () => {
        isDrawingSig = false;
    });

    // Type signature live preview
    const sigTypeInput = document.getElementById('sigTypeInput');
    const sigTypePreview = document.getElementById('sigTypePreview');
    if (sigTypeInput && sigTypePreview) {
        sigTypeInput.addEventListener('input', () => {
            sigTypePreview.textContent = sigTypeInput.value || "Your Signature";
        });
    }
}

function clearSigPad() {
    if (sigPadCtx) {
        sigPadCtx.clearRect(0, 0, sigPadCanvas.width, sigPadCanvas.height);
    }
}

function openSignatureModal() {
    document.getElementById('signatureModal').classList.remove('hidden');
}

function closeSignatureModal() {
    document.getElementById('signatureModal').classList.add('hidden');
}

function setSigTab(tab) {
    sigMode = tab;
    ['draw', 'type', 'upload'].forEach(t => {
        const btn = document.getElementById(`sigTab${capitalize(t)}`);
        const panel = document.getElementById(`sigPanel${capitalize(t)}`);
        if (t === tab) {
            btn.className = "px-4 py-2 text-indigo-400 border-b-2 border-indigo-500 font-semibold";
            panel.classList.remove('hidden');
        } else {
            btn.className = "px-4 py-2 text-slate-400 hover:text-white font-semibold";
            panel.classList.add('hidden');
        }
    });
}

function applySignatureToCanvas() {
    if (sigMode === 'draw') {
        const dataUrl = sigPadCanvas.toDataURL('image/png');
        insertSignatureImage(dataUrl);
    } else if (sigMode === 'type') {
        const text = document.getElementById('sigTypeInput').value.trim() || "Signature";
        const sigText = new fabric.IText(text, {
            left: 150,
            top: 150,
            fontFamily: 'Caveat',
            fontSize: 38,
            fill: '#1e1b4b',
            fontStyle: 'italic'
        });
        fabricCanvas.add(sigText);
        fabricCanvas.setActiveObject(sigText);
        closeSignatureModal();
        showToast("Signature inserted.", "success");
    } else if (sigMode === 'upload') {
        const input = document.getElementById('sigImageFile');
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onload = (e) => {
                insertSignatureImage(e.target.result);
            };
            reader.readAsDataURL(input.files[0]);
        }
    }
}

function insertSignatureImage(dataUrl) {
    fabric.Image.fromURL(dataUrl, (img) => {
        img.scaleToWidth(160);
        img.set({
            left: 150,
            top: 150
        });
        fabricCanvas.add(img);
        fabricCanvas.setActiveObject(img);
        closeSignatureModal();
        showToast("Signature inserted.", "success");
    });
}

// ----------------- Save and Export PDF -----------------

async function saveAndExportPdf() {
    if (!pdfDoc || !currentPdfPath) {
        showToast("No active PDF document to export.", "error");
        return;
    }

    saveCurrentPageAnnotations();
    showToast("Generating edited PDF...", "info");

    // Collect high-res overlay images for pages that have annotations
    const pageOverlays = {};
    const flatRedactions = [];

    // Temporarily clear selections and render each page's fabric overlay to PNG
    for (const [pageNumStr, jsonStr] of Object.entries(pageAnnotations)) {
        const pageNum = parseInt(pageNumStr);
        const parsed = JSON.parse(jsonStr);

        if (parsed.objects && parsed.objects.length > 0) {
            // Create off-screen canvas with same dimensions as original page
            const offscreenCanvas = new fabric.StaticCanvas(null, {
                width: fabricCanvas.getWidth(),
                height: fabricCanvas.getHeight()
            });

            await new Promise(resolve => {
                offscreenCanvas.loadFromJSON(jsonStr, () => {
                    offscreenCanvas.renderAll();
                    // Export transparent PNG of all user additions
                    const dataUrl = offscreenCanvas.toDataURL({ format: 'png' });
                    // Backend pages are 0-indexed
                    pageOverlays[(pageNum - 1).toString()] = dataUrl;
                    resolve();
                });
            });
        }
    }

    // Collect redactions
    for (const [pageNumStr, reds] of Object.entries(pageRedactions)) {
        const pageIdx = parseInt(pageNumStr) - 1;
        reds.forEach(r => {
            flatRedactions.push({
                page: pageIdx,
                rect: r.rect
            });
        });
    }

    try {
        const res = await fetch('/api/editor/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                file_path: currentPdfPath,
                original_name: currentPdfName,
                overlays: pageOverlays,
                redactions: flatRedactions
            })
        });

        const data = await res.json();
        if (data.success && data.download_url) {
            showToast("Document saved! Starting download...", "success");
            // Trigger download
            window.location.href = data.download_url;
        } else {
            showToast(data.error || "Failed to save PDF.", "error");
        }
    } catch (e) {
        console.error(e);
        showToast("Error connecting to server for PDF export.", "error");
    }
}
