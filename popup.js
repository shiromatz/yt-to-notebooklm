// popup.js

// --- UI Logic ---
class PopupUI {
    constructor() {
        this.tabsBox = document.getElementById("tabs");
        this.sendBtn = document.getElementById("send");
        this.statusEl = document.getElementById("status");
    }

    escapeHtml(s) {
        return (s || "").replace(/[&<>"']/g, (c) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[c]));
    }

    renderTabItem(tab, index) {
        const checked = index === 0 ? "checked" : "";
        const title = this.escapeHtml(tab.title || "NotebookLM");
        const url = this.escapeHtml(tab.url || "");

        return `
      <label>
        <input type="radio" name="nbtab" value="${tab.id}" ${checked}/>
        <div>
          <div class="title">${title}</div>
          <div class="url">${url}</div>
        </div>
      </label>
    `;
    }

    renderTabs(tabs) {
        this.tabsBox.innerHTML = "";

        if (!tabs.length) {
            this.tabsBox.innerHTML = `<div class="hint">No NotebookLM tabs found.</div>`;
            return;
        }

        const html = tabs.map((t, i) => this.renderTabItem(t, i)).join("");
        this.tabsBox.innerHTML = html;

        if (this.sendBtn) this.sendBtn.disabled = false;
    }

    getSelectedTabId() {
        const el = document.querySelector("input[name='nbtab']:checked");
        return el ? Number(el.value) : null;
    }

    setStatus(text) {
        if (this.statusEl) this.statusEl.textContent = text;
    }

    setBusy(isBusy) {
        if (this.sendBtn) this.sendBtn.disabled = isBusy;
    }
}

// --- Data Logic ---

async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
}

async function getNotebookLMTabs() {
    return await chrome.tabs.query({ url: CONFIG.URLS.NOTEBOOKLM_MATCH });
}

// --- Controller Logic ---

async function sendAction(ui) {
    ui.setBusy(true);

    const active = await getActiveTab();
    const targetId = ui.getSelectedTabId();
    if (!active?.url || !targetId) {
        ui.setBusy(false);
        return;
    }

    // Robust URL parsing
    let u;
    try {
        u = new URL(active.url);
    } catch {
        ui.setBusy(false);
        return;
    }

    const isPlaylist = CONFIG.URLS.YOUTUBE_PLAYLIST_MARKERS.some(marker => active.url.includes(marker));
    const isHome = CONFIG.URLS.YOUTUBE_DOMAINS.includes(u.hostname) && u.pathname === "/";
    const isBatch = isPlaylist || isHome;

    ui.setStatus(isBatch ? "Extracting List..." : "Sending...");

    try {
        const res = await chrome.runtime.sendMessage({
            type: isBatch ? CONFIG.MESSAGES.PROCESS_PLAYLIST : CONFIG.MESSAGES.SEND_URL,
            url: active.url,
            targetTabId: targetId,
            sourceTabId: active.id
        });

        if (isBatch && res?.ok) {
            ui.setStatus("Processing Playlist (See Badge)");
            setTimeout(() => window.close(), CONFIG.TIMEOUTS.POPUP_CLOSE_LONG);
        } else {
            const statusMsg = res?.ok ? `Done (${res.mode})` : `Failed (${res?.detail || res?.mode || "unknown"})`;
            ui.setStatus(statusMsg);

            if (res?.ok) setTimeout(() => window.close(), CONFIG.TIMEOUTS.POPUP_CLOSE_SHORT);
            else ui.setBusy(false);
        }
    } catch (e) {
        console.error(e);
        ui.setStatus("Error communicating with extension");
        ui.setBusy(false);
    }
}

async function main() {
    const ui = new PopupUI();
    const nbTabs = await getNotebookLMTabs();
    ui.renderTabs(nbTabs);

    document.getElementById("open").addEventListener("click", async () => {
        await chrome.tabs.create({ url: CONFIG.URLS.NOTEBOOKLM_BASE });
        window.close();
    });

    document.getElementById("send").addEventListener("click", () => sendAction(ui));

    // AUTO-SEND if exactly 1 NotebookLM tab
    if (nbTabs.length === 1) {
        if (!ui.sendBtn.disabled) {
            sendAction(ui);
        }
    }
}

main();
