async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
}

async function getNotebookLMTabs() {
    return await chrome.tabs.query({ url: "https://notebooklm.google.com/*" });
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
        const id = `t_${t.id}`;
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

function escapeHtml(s) {
    return (s || "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function selectedTabId() {
    const el = document.querySelector("input[name='nbtab']:checked");
    return el ? Number(el.value) : null;
}

async function main() {
    const nbTabs = await getNotebookLMTabs();
    renderTabs(nbTabs);

    document.getElementById("open").addEventListener("click", async () => {
        await chrome.tabs.create({ url: "https://notebooklm.google.com/" });
        window.close();
    });

    document.getElementById("send").addEventListener("click", async () => {
        const active = await getActiveTab();
        const targetId = selectedTabId();
        if (!active?.url || !targetId) return;

        document.getElementById("status").textContent = "Sending...";

        const res = await chrome.runtime.sendMessage({
            type: "SEND_URL_TO_NOTEBOOKLM",
            url: active.url,
            targetTabId: targetId,
            sourceTabId: active.id
        });

        document.getElementById("status").textContent =
            res?.ok ? `Done (${res.mode})` : `Failed (${res?.mode || "unknown"})`;

        // すぐ閉じたいなら次行を有効化
        // window.close();
    });
}

main();
