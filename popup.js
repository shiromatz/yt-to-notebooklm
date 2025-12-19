// popup.js

async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
}

async function getNotebookLMTabs() {
    return await chrome.tabs.query({ url: CONFIG.URLS.NOTEBOOKLM_MATCH });
}

function escapeHtml(s) {
    return (s || "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function renderTabItem(tab, index) {
    const checked = index === 0 ? "checked" : "";
    const title = escapeHtml(tab.title || "NotebookLM");
    const url = escapeHtml(tab.url || "");

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

function renderTabs(tabs) {
    const box = document.getElementById("tabs");
    box.innerHTML = "";

    if (!tabs.length) {
        box.innerHTML = `<div class="hint">No NotebookLM tabs found.</div>`;
        return;
    }

    const html = tabs.map((t, i) => renderTabItem(t, i)).join("");
    box.innerHTML = html;

    const sendBtn = document.getElementById("send");
    if (sendBtn) sendBtn.disabled = false;
}

function selectedTabId() {
    const el = document.querySelector("input[name='nbtab']:checked");
    return el ? Number(el.value) : null;
}

// Extracted logic for sending
async function sendAction() {
    const btn = document.getElementById("send");
    if (btn) btn.disabled = true;

    const active = await getActiveTab();
    const targetId = selectedTabId();
    if (!active?.url || !targetId) {
        if (btn) btn.disabled = false;
        return;
    }

    // Robust URL parsing
    let u;
    try {
        u = new URL(active.url);
    } catch {
        // Should not happen for valid tabs, but safe guard
        if (btn) btn.disabled = false;
        return;
    }

    const isPlaylist = CONFIG.URLS.YOUTUBE_PLAYLIST_MARKERS.some(marker => active.url.includes(marker));

    // Specific check for YouTube Home using URL object
    // Matches https://www.youtube.com/ or https://www.youtube.com/?...
    const isHome = CONFIG.URLS.YOUTUBE_DOMAINS.includes(u.hostname) && u.pathname === "/";
    const isBatch = isPlaylist || isHome;

    const statusEl = document.getElementById("status");
    statusEl.textContent = isBatch
        ? "Extracting List..."
        : "Sending...";

    try {
        const res = await chrome.runtime.sendMessage({
            type: isBatch ? CONFIG.MESSAGES.PROCESS_PLAYLIST : CONFIG.MESSAGES.SEND_URL,
            url: active.url,
            targetTabId: targetId,
            sourceTabId: active.id
        });

        if (isBatch && res?.ok) {
            statusEl.textContent = "Processing Playlist (See Badge)";
            // Close popup shortly to let user see the message
            setTimeout(() => window.close(), CONFIG.TIMEOUTS.POPUP_CLOSE_LONG);
        } else {
            statusEl.textContent =
                res?.ok ? `Done (${res.mode})` : `Failed (${res?.detail || res?.mode || "unknown"})`;
            if (res?.ok) setTimeout(() => window.close(), CONFIG.TIMEOUTS.POPUP_CLOSE_SHORT);
            else if (btn) btn.disabled = false;
        }
    } catch (e) {
        console.error(e);
        statusEl.textContent = "Error communicating with extension";
        if (btn) btn.disabled = false;
    }
}

async function main() {
    const nbTabs = await getNotebookLMTabs();
    renderTabs(nbTabs);

    document.getElementById("open").addEventListener("click", async () => {
        await chrome.tabs.create({ url: CONFIG.URLS.NOTEBOOKLM_BASE });
        window.close();
    });

    document.getElementById("send").addEventListener("click", sendAction);

    // AUTO-SEND if exactly 1 NotebookLM tab
    // Removed setTimeout race condition. DOM is ready.
    if (nbTabs.length === 1) {
        // Double-check button state just in case
        const btn = document.getElementById("send");
        if (btn && !btn.disabled) {
            sendAction();
        }
    }
}

main();
