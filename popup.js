// popup.js

async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
}

async function getNotebookLMTabs() {
    return await chrome.tabs.query({ url: "https://notebooklm.google.com/*" });
}

function escapeHtml(s) {
    return (s || "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function renderTabs(tabs) {
    const box = document.getElementById("tabs");
    box.innerHTML = "";
    if (!tabs.length) {
        box.innerHTML = `<div class="hint">No NotebookLM tabs found.</div>`;
        return;
    }
    for (let i = 0; i < tabs.length; i++) {
        const t = tabs[i];
        const row = document.createElement("div");
        row.innerHTML = `
      <label>
        <input type="radio" name="nbtab" value="${t.id}" ${i === 0 ? "checked" : ""}/>
        <div>
          <div class="title">${escapeHtml(t.title || "NotebookLM")}</div>
          <div class="url">${escapeHtml(t.url || "")}</div>
        </div>
      </label>
    `;
        box.appendChild(row);
    }
    document.getElementById("send").disabled = false;
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

    const isPlaylist = active.url.includes("list=") ||
        active.url.includes("playlist") ||
        active.url.includes("/videos") ||
        active.url.includes("/feed/") ||
        active.url.includes("/results");

    const statusEl = document.getElementById("status");
    statusEl.textContent = isPlaylist
        ? "Extracting Playlist..."
        : "Sending...";

    const res = await chrome.runtime.sendMessage({
        type: isPlaylist ? "PROCESS_PLAYLIST" : "SEND_URL_TO_NOTEBOOKLM",
        url: active.url,
        targetTabId: targetId,
        sourceTabId: active.id
    });

    if (isPlaylist && res?.ok) {
        statusEl.textContent = "Processing Playlist (See Badge)";
        // window.close() would be nice here for playlist too, but let's keep it open or close per preference.
        // Given "Auto Send", usually implies "Set and Forget".
        setTimeout(() => window.close(), 1500);
    } else {
        statusEl.textContent =
            res?.ok ? `Done (${res.mode})` : `Failed (${res?.detail || res?.mode || "unknown"})`;
        if (res?.ok) setTimeout(() => window.close(), 800);
        else if (btn) btn.disabled = false;
    }
}

async function main() {
    const nbTabs = await getNotebookLMTabs();
    renderTabs(nbTabs);

    document.getElementById("open").addEventListener("click", async () => {
        await chrome.tabs.create({ url: "https://notebooklm.google.com/" });
        window.close();
    });

    document.getElementById("send").addEventListener("click", sendAction);

    // AUTO-SEND if exactly 1 NotebookLM tab
    if (nbTabs.length === 1) {
        // Wait a tick for UI render
        setTimeout(() => {
            // Only auto-send if not already sending (double click safety)
            if (!document.getElementById("send").disabled) {
                sendAction();
            }
        }, 100);
    }
}

main();
