function badge(tabId, text, color) {
    chrome.action.setBadgeText({ tabId, text });
    chrome.action.setBadgeBackgroundColor({ tabId, color });
}

function normalizeUrl(raw) {
    try {
        const u = new URL(raw);

        // YouTube: watch / shorts / playlist / youtu.be をそのまま許可
        // それ以外の通常URLも許可（http/https のみ）
        if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    } catch { }
    return null;
}

async function ensureContentScript(tabId) {
    try {
        await chrome.tabs.sendMessage(tabId, { type: "PING" });
        return;
    } catch { }
    await chrome.scripting.executeScript({
        target: { tabId },
        files: ["notebooklm_content.js"]
    });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
        if (msg?.type !== "SEND_URL_TO_NOTEBOOKLM") return;

        const url = normalizeUrl(msg.url);
        const targetTabId = msg.targetTabId;
        const sourceTabId = msg.sourceTabId;

        if (!url) {
            badge(sourceTabId, "ERR", "#b00020");
            sendResponse({ ok: false, mode: "bad_url" });
            return;
        }

        try {
            await ensureContentScript(targetTabId);

            const r = await chrome.tabs.sendMessage(targetTabId, {
                type: "ADD_SOURCE_URL",
                url
            });

            // r.mode: "auto" | "clipboard" | "failed"
            if (r?.ok && r.mode === "auto") badge(sourceTabId, "OK", "#0a7d26");
            else if (r?.ok && r.mode === "clipboard") badge(sourceTabId, "CLIP", "#6b5b00");
            else badge(sourceTabId, "ERR", "#b00020");

            // 数秒後にバッジ消す（任意）
            setTimeout(() => badge(sourceTabId, "", "#000000"), 3000);

            sendResponse(r || { ok: false, mode: "no_response" });
        } catch (e) {
            badge(sourceTabId, "ERR", "#b00020");
            setTimeout(() => badge(sourceTabId, "", "#000000"), 3000);
            sendResponse({ ok: false, mode: "exception" });
        }
    })();

    return true;
});
