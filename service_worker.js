// service_worker.js
function badge(tabId, text, color) {
    chrome.action.setBadgeText({ tabId, text });
    chrome.action.setBadgeBackgroundColor({ tabId, color });
}

function normalizeUrl(raw) {
    try {
        const u = new URL(raw);
        if (u.hostname.includes("youtube.com") || u.hostname.includes("youtu.be")) {
            const v = u.searchParams.get("v");
            if (v) return `https://www.youtube.com/watch?v=${v}`;
        }
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

async function extractPlaylistUrls(tabId) {
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
            // Select regular videos (playlist) and grid videos (channel/feed)
            const selectors = [
                "a#video-title",
                "a#video-title-link",
                "a.yt-lockup-metadata-view-model__title"
            ];
            const candidates = Array.from(document.querySelectorAll(selectors.join(",")));
            return candidates.map(a => {
                const u = new URL(a.href, window.location.origin);
                const v = u.searchParams.get("v");
                if (v) return `https://www.youtube.com/watch?v=${v}`;
                return null;
            }).filter(Boolean);
        }
    });
    if (results && results[0] && results[0].result) {
        return [...new Set(results[0].result)];
    }
    return [];
}

// Check if tab is on Dashboard and needs new notebook
async function handleDashboardRedirect(tabId) {
    const tab = await chrome.tabs.get(tabId);
    // Dashboard URLs usually don't have /notebook/UUID
    if (!tab.url.includes("/notebook/")) {

        // Attempt to create new notebook via scripting
        // We need to WAIT for the button because of "Loading..." spinner.
        await chrome.scripting.executeScript({
            target: { tabId },
            func: async () => {
                const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

                // Polling for button appearance
                for (let i = 0; i < 20; i++) { // Max 10s wait
                    // Selectors:
                    // 1. .create-new-button (Top right)
                    // 2. .create-new-action-button (Card)
                    // 3. Aria-label fallback (English only usually)
                    const btns = [
                        document.querySelector(".create-new-button"),
                        document.querySelector(".create-new-action-button"),
                        document.querySelector("button[aria-label='Create new notebook']")
                    ];
                    // Find first visible one
                    const btn = btns.find(b => b && b.offsetParent !== null);

                    if (btn) {
                        btn.click();
                        return "clicked";
                    }
                    await sleep(500);
                }
                return "timeout";
            }
        });

        // Loop wait for URL change (max 15s - creation can be slow)
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 500));
            const t = await chrome.tabs.get(tabId);
            if (t.url && t.url.includes("/notebook/")) {
                // Wait extra for UI load
                await new Promise(r => setTimeout(r, 2500));
                return true;
            }
        }
        return false; // Failed to redirect
    }
    return true; // Already on notebook
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
        const targetTabId = msg.targetTabId;
        const sourceTabId = msg.sourceTabId;

        // --- HANDLER: SINGLE URL ---
        if (msg?.type === "SEND_URL_TO_NOTEBOOKLM") {
            const url = normalizeUrl(msg.url);
            if (!url) {
                badge(sourceTabId, "ERR", "#b00020");
                sendResponse({ ok: false, mode: "bad_url" });
                return;
            }

            try {
                // Handle Dashboard -> New Notebook
                const ready = await handleDashboardRedirect(targetTabId);
                if (!ready) {
                    badge(sourceTabId, "ERR", "#b00020");
                    sendResponse({ ok: false, mode: "create_failed" });
                    return;
                }

                await ensureContentScript(targetTabId);
                const r = await chrome.tabs.sendMessage(targetTabId, { type: "ADD_SOURCE_URL", url });

                if (r?.ok && r.mode === "auto") badge(sourceTabId, "OK", "#0a7d26");
                else badge(sourceTabId, "ERR", "#b00020");

                setTimeout(() => badge(sourceTabId, "", "#000000"), 3000);
                sendResponse(r || { ok: false, mode: "no_response" });
            } catch (e) {
                console.error(e);
                badge(sourceTabId, "ERR", "#b00020");
                sendResponse({ ok: false, mode: "exception" });
            }
            return;
        }

        // --- HANDLER: PLAYLIST ---
        if (msg?.type === "PROCESS_PLAYLIST") {
            try {
                const urls = await extractPlaylistUrls(sourceTabId);
                if (!urls.length) {
                    sendResponse({ ok: false, detail: "No videos found in playlist" });
                    return;
                }

                sendResponse({ ok: true, mode: "playlist_started", count: urls.length });

                // Handle Dashboard -> New Notebook (Once only)
                const ready = await handleDashboardRedirect(targetTabId);
                if (!ready) {
                    badge(sourceTabId, "ERR", "#b00020");
                    return;
                }

                await ensureContentScript(targetTabId);

                for (let i = 0; i < urls.length; i++) {
                    const url = urls[i];
                    badge(sourceTabId, `${i + 1}/${urls.length}`, "#005a9c");

                    try {
                        const r = await chrome.tabs.sendMessage(targetTabId, { type: "ADD_SOURCE_URL", url });

                        if (r?.mode === "limit_reached") {
                            badge(sourceTabId, "FULL", "#b00020");
                            break;
                        }

                        if (!r?.ok) console.error("Failed to add", url, r);
                    } catch (e) {
                        console.error("Exception adding", url, e);
                    }
                    await new Promise(r => setTimeout(r, 500));
                }

                badge(sourceTabId, "DONE", "#0a7d26");

                // Ensure dialog is closed at the end
                try {
                    await chrome.tabs.sendMessage(targetTabId, { type: "CLOSE_DIALOG" });
                } catch { }

                setTimeout(() => badge(sourceTabId, "", "#000000"), 5000);

            } catch (e) {
                console.error("Playlist Process Error", e);
                badge(sourceTabId, "ERR", "#b00020");
            }
            return;
        }
    })();

    return true;
});
