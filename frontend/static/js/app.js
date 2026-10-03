/**
 * DocuConvert Pro - Main Application Logic
 * Supports Light & Dark Themes, History Drawer, and Toast Notifications
 */

// ── Light / Dark Mode Toggle Logic ──────────────────────────────────────────
function setupThemeToggle() {
    const btn = document.getElementById('themeToggleBtn');
    if (!btn || btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';

    function updateThemeUI(isDark) {
        btn.setAttribute('title', isDark ? 'Click to switch to Light mode' : 'Click to switch to Dark mode');
        btn.setAttribute('aria-label', isDark ? 'Switch to Light mode' : 'Switch to Dark mode');
    }

    // Set initial title based on current state
    updateThemeUI(document.documentElement.classList.contains('dark'));

    btn.onclick = function(e) {
        e.preventDefault();
        const willBeDark = !document.documentElement.classList.contains('dark');
        if (willBeDark) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
        try {
            localStorage.setItem('docuconvert_theme', willBeDark ? 'dark' : 'light');
        } catch (err) {}

        updateThemeUI(willBeDark);
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    };
}

// Initialize theme toggle
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupThemeToggle);
} else {
    setupThemeToggle();
}

// ── Toast Notification Helper ───────────────────────────────────────────────
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `p-4 rounded-xl shadow-xl border flex items-center space-x-3 pointer-events-auto transition-all transform duration-300 translate-y-2 opacity-0 ${
        type === 'success' ? 'bg-emerald-50 dark:bg-emerald-950/80 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200' :
        type === 'error' ? 'bg-rose-50 dark:bg-rose-950/80 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200' :
        'bg-indigo-50 dark:bg-indigo-950/80 border-indigo-200 dark:border-indigo-800 text-indigo-900 dark:text-indigo-200'
    }`;

    const iconName = type === 'success' ? 'check-circle' : type === 'error' ? 'alert-triangle' : 'info';

    toast.innerHTML = `
        <div class="flex-shrink-0">
            <i data-lucide="${iconName}" class="w-5 h-5 ${
                type === 'success' ? 'text-emerald-600 dark:text-emerald-400' :
                type === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-indigo-600 dark:text-indigo-400'
            }"></i>
        </div>
        <div class="flex-1 text-sm font-medium leading-snug">${message}</div>
        <button class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1" onclick="this.parentElement.remove()">
            <i data-lucide="x" class="w-4 h-4"></i>
        </button>
    `;

    container.appendChild(toast);
    if (typeof lucide !== 'undefined') lucide.createIcons();

    setTimeout(() => {
        toast.classList.remove('translate-y-2', 'opacity-0');
    }, 10);

    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
    }, 4500);
}

// ── Activity History Drawer Logic ───────────────────────────────────────────
const historyDrawer = document.getElementById('historyDrawer');
const toggleHistoryBtn = document.getElementById('toggleHistoryBtn');
const closeHistoryBtn = document.getElementById('closeHistoryBtn');
const historyBackdrop = document.getElementById('historyBackdrop');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const historyList = document.getElementById('historyList');
const emptyHistoryMsg = document.getElementById('emptyHistoryMsg');
const historyCount = document.getElementById('historyCount');

function openHistory() {
    if (historyDrawer) {
        historyDrawer.classList.remove('hidden');
        loadHistory();
    }
}

function closeHistory() {
    if (historyDrawer) {
        historyDrawer.classList.add('hidden');
    }
}

if (toggleHistoryBtn) toggleHistoryBtn.addEventListener('click', openHistory);
if (closeHistoryBtn) closeHistoryBtn.addEventListener('click', closeHistory);
if (historyBackdrop) historyBackdrop.addEventListener('click', closeHistory);

async function loadHistory() {
    try {
        const res = await fetch('/api/history');
        const data = await res.json();
        if (data.success && data.history) {
            renderHistory(data.history);
        }
    } catch (e) {
        console.error("Could not load history", e);
    }
}

function renderHistory(items) {
    if (!historyList || !emptyHistoryMsg) return;
    historyList.innerHTML = '';

    if (items.length === 0) {
        emptyHistoryMsg.classList.remove('hidden');
        if (historyCount) historyCount.textContent = '0 entries';
        return;
    }

    emptyHistoryMsg.classList.add('hidden');
    if (historyCount) historyCount.textContent = `${items.length} ${items.length === 1 ? 'entry' : 'entries'}`;

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors flex items-center justify-between text-sm';

        const isSuccess = item.status === 'Completed';

        card.innerHTML = `
            <div class="flex items-center space-x-3 truncate">
                <div class="p-2 rounded-lg ${isSuccess ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400' : 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-400'}">
                    <i data-lucide="${isSuccess ? 'file-check' : 'alert-circle'}" class="w-4 h-4"></i>
                </div>
                <div class="truncate">
                    <p class="font-medium text-slate-800 dark:text-slate-200 truncate">${item.original_filename}</p>
                    <div class="flex items-center space-x-2 text-xs text-slate-500 dark:text-slate-400">
                        <span class="font-semibold text-indigo-600 dark:text-indigo-400">${item.operation}</span>
                        <span>&bull;</span>
                        <span>${item.formatted_size || '0 B'}</span>
                        <span>&bull;</span>
                        <span>${item.created_at}</span>
                    </div>
                </div>
            </div>
            <span class="flex-shrink-0 text-xs font-semibold px-2 py-1 rounded-full ${isSuccess ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400' : 'bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400'}">${item.status}</span>
        `;
        historyList.appendChild(card);
    });

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', async () => {
        if (!confirm("Are you sure you want to clear your operation history?")) return;
        try {
            const res = await fetch('/api/history', { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                renderHistory([]);
                showToast("History cleared successfully.", "info");
            }
        } catch (e) {
            showToast("Failed to clear history.", "error");
        }
    });
}
