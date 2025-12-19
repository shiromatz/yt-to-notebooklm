// service_worker.js
try { importScripts("constants.js", "utils.js"); } catch (e) { console.error(e); }

function badge(tabId, text, color) {
    chrome.action.setBadgeText({ tabId, text });
    chrome.action.setBadgeBackgroundColor({ tabId, color });
}

/**
 * Wait for a specific URL fragment to appear in a tab
 */
function waitForUrlContains(tabId, fragment, timeoutMs) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve(false);
        }, timeoutMs);

        const listener = (updatedTabId, changeInfo, tab) => {
            if (updatedTabId !== tabId) return;
            const url = changeInfo.url || tab.url;
            if (url && url.includes(fragment)) {
                chrome.tabs.onUpdated.removeListener(listener);
                clearTimeout(timer);
                resolve(true);
            }
        };

        chrome.tabs.onUpdated.addListener(listener);
    });
}

async function ensureContentScript(tabId) {
    try {
        await chrome.tabs.sendMessage(tabId, { type: CONFIG.MESSAGES.PING });
        return;
    } catch { }
    await chrome.scripting.executeScript({
        target: { tabId },
        files: ["constants.js", "utils.js", "notebooklm_content.js"]
    });
}

async function extractPlaylistUrls(tabId) {
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (selectors) => {
            // Select regular videos (playlist) and grid videos (channel/feed)
            const candidates = Array.from(document.querySelectorAll(selectors.join(",")));
            return candidates.map(a => {
                const u = new URL(a.href, window.location.origin);
                const v = u.searchParams.get("v");
                if (v) return `https://www.youtube.com/watch?v=${v}`;
                return null;
            }).filter(Boolean);
        },
        args: [CONFIG.SELECTORS.YOUTUBE.PLAYLIST_LINKS]
    });
    if (results && results[0] && results[0].result) {
        return [...new Set(results[0].result)];
    }
    return [];
}

async function createNotebookFromDashboard(tabId) {
    // Ensure script is there first
    await ensureContentScript(tabId);

    // Send message to click "New Notebook"
    const r = await chrome.tabs.sendMessage(tabId, { type: "CREATE_NOTEBOOK" });

    if (!r?.ok) {
        console.error("Failed to click create button", r);
        return false;
    }

    // Loop wait for URL change (max 15s - creation can be slow)
    return await waitForUrlContains(tabId, "/notebook/", CONFIG.TIMEOUTS.REDIRECT_WAIT);
}

// Check if tab is on Dashboard and needs new notebook
async function handleDashboardRedirect(tabId) {
    const tab = await chrome.tabs.get(tabId);
    // Dashboard URLs usually don't have /notebook/UUID
    if (!tab.url.includes("/notebook/")) {
        const redirected = await createNotebookFromDashboard(tabId);

        if (redirected) {
            // Wait extra for UI load
            await Utils.sleep(CONFIG.TIMEOUTS.UI_ANIMATION_LONG);
            return true;
        }

        return false; // Failed to redirect
    }
    return true; // Already on notebook
}

/**
 * Helper: Process a single URL in a batch
 * (Refactor Step 3: Extraction)
 */
async function processSingleUrlInBatch(url, index, total, targetTabId, sourceTabId) {
    badge(sourceTabId, `${index + 1}/${total}`, CONFIG.COLORS.PROGRESS);

    try {
        const r = await chrome.tabs.sendMessage(targetTabId, { type: CONFIG.MESSAGES.ADD_SOURCE, url });

        if (r?.mode === "limit_reached") {
            badge(sourceTabId, "FULL", CONFIG.COLORS.ERROR);
            return { ok: false, reason: "limit" };
        }

        if (!r?.ok) {
            console.error("Failed to add", url, r);
            return { ok: false, reason: "failed", detail: r?.detail || "unknown" };
        }
    } catch (e) {
        console.error("Exception adding", url, e);
        return { ok: false, reason: "exception", detail: e.message };
    }

    // Tiny delay between items
    await Utils.sleep(CONFIG.TIMEOUTS.BATCH_ITEM_DELAY);
    return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
        if (msg?.type === CONFIG.MESSAGES.SEND_URL) {
            await handleSingleUrl(msg, sendResponse);
            return;
        }

        if (msg?.type === CONFIG.MESSAGES.PROCESS_PLAYLIST) {
            await handlePlaylistBatch(msg, sendResponse);
            return;
        }
    })();

    return true;
});

/**
 * Handle single URL submission
 */
async function handleSingleUrl(msg, sendResponse) {
    const { url, targetTabId, sourceTabId } = msg;
    const normalized = Utils.normalizeUrl(url);

    if (!normalized) {
        badge(sourceTabId, "ERR", CONFIG.COLORS.ERROR);
        sendResponse({ ok: false, mode: "bad_url" });
        return;
    }

    try {
        // Handle Dashboard -> New Notebook
        const ready = await handleDashboardRedirect(targetTabId);
        if (!ready) {
            badge(sourceTabId, "ERR", CONFIG.COLORS.ERROR);
            sendResponse({ ok: false, mode: "create_failed" });
            return;
        }

        await ensureContentScript(targetTabId);
        const r = await chrome.tabs.sendMessage(targetTabId, { type: CONFIG.MESSAGES.ADD_SOURCE, url: normalized });

        if (r?.ok && r.mode === "auto") badge(sourceTabId, "OK", CONFIG.COLORS.SUCCESS);
        else badge(sourceTabId, "ERR", CONFIG.COLORS.ERROR);

        setTimeout(() => badge(sourceTabId, "", CONFIG.COLORS.DEFAULT), CONFIG.TIMEOUTS.BADGE_DISPLAY);
        sendResponse(r || { ok: false, mode: "no_response" });
    } catch (e) {
        console.error(e);
        badge(sourceTabId, "ERR", CONFIG.COLORS.ERROR);
        sendResponse({ ok: false, mode: "exception" });
    }
}

/**
 * Handle playlist batch processing
 */
async function handlePlaylistBatch(msg, sendResponse) {
    const { targetTabId, sourceTabId } = msg;

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
            badge(sourceTabId, "ERR", CONFIG.COLORS.ERROR);
            return;
        }

        await ensureContentScript(targetTabId);

        // Loop using helper
        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            const result = await processSingleUrlInBatch(url, i, urls.length, targetTabId, sourceTabId);

            if (!result.ok && result.reason === "limit") break;
        }

        badge(sourceTabId, "DONE", CONFIG.COLORS.SUCCESS);

        // Ensure dialog is closed at the end
        try {
            await chrome.tabs.sendMessage(targetTabId, { type: CONFIG.MESSAGES.CLOSE_DIALOG });
        } catch { }

        setTimeout(() => badge(sourceTabId, "", CONFIG.COLORS.DEFAULT), CONFIG.TIMEOUTS.BADGE_DISPLAY_LONG);

    } catch (e) {
        console.error("Playlist Process Error", e);
        badge(sourceTabId, "ERR", CONFIG.COLORS.ERROR);
    }
}
