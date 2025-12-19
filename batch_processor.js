// batch_processor.js
// Logic for handling playlist/batch operations

class BatchProcessor {
    constructor(dependencies) {
        this.deps = dependencies; // { badge, handleDashboardRedirect, ensureContentScript }
    }

    /**
     * Extract URLs from the source tab (YouTube)
     */
    async extractPlaylistUrls(tabId) {
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

    /**
     * Helper: Process a single URL in a batch
     */
    async processSingleUrlInBatch(url, index, total, targetTabId, sourceTabId) {
        this.deps.badge(sourceTabId, `${index + 1}/${total}`, CONFIG.COLORS.PROGRESS);

        try {
            const r = await chrome.tabs.sendMessage(targetTabId, { type: CONFIG.MESSAGES.ADD_SOURCE, url });

            if (r?.mode === "limit_reached") {
                this.deps.badge(sourceTabId, "FULL", CONFIG.COLORS.ERROR);
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

    /**
     * Main Handler for Batch
     */
    async handlePlaylistBatch(msg, sendResponse) {
        const { targetTabId, sourceTabId } = msg;

        try {
            const urls = await this.extractPlaylistUrls(sourceTabId);
            if (!urls.length) {
                sendResponse({ ok: false, detail: "No videos found in playlist" });
                return;
            }

            sendResponse({ ok: true, mode: "playlist_started", count: urls.length });

            // Handle Dashboard -> New Notebook (Once only)
            const ready = await this.deps.handleDashboardRedirect(targetTabId);
            if (!ready) {
                this.deps.badge(sourceTabId, "ERR", CONFIG.COLORS.ERROR);
                return;
            }

            await this.deps.ensureContentScript(targetTabId);

            // Loop using helper
            let stopReason = "done";
            for (let i = 0; i < urls.length; i++) {
                const url = urls[i];
                const result = await this.processSingleUrlInBatch(url, i, urls.length, targetTabId, sourceTabId);

                if (!result.ok && result.reason === "limit") {
                    stopReason = "limit";
                    break;
                }
            }

            if (stopReason === "limit") {
                this.deps.badge(sourceTabId, "LIMIT", CONFIG.COLORS.ERROR);
            } else {
                this.deps.badge(sourceTabId, "DONE", CONFIG.COLORS.SUCCESS);
            }

            // Ensure dialog is closed at the end
            try {
                await chrome.tabs.sendMessage(targetTabId, { type: CONFIG.MESSAGES.CLOSE_DIALOG });
            } catch { }

            setTimeout(() => this.deps.badge(sourceTabId, "", CONFIG.COLORS.DEFAULT), CONFIG.TIMEOUTS.BADGE_DISPLAY_LONG);

        } catch (e) {
            console.error("Playlist Process Error", e);
            this.deps.badge(sourceTabId, "ERR", CONFIG.COLORS.ERROR);
        }
    }
}

// Export for Node.js/Test environments
if (typeof module !== "undefined") {
    module.exports = { BatchProcessor };
}

