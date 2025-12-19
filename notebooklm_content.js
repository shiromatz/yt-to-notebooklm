// notebooklm_content.js
// MV3 content script for https://notebooklm.google.com/*
//
// Refactored structure:
// - DebugPanel: debug_panel.js
// - NotebookLMFinder: dom_finder.js
// - NotebookLMAutomator: automator.js
// - Main: This file (Message Handler & Orchestration)

(() => {
    "use strict";

    // Wait for modules to be loaded (in case of async issues, though in MV3 they should be sequential in manifest)
    // We assume they are available on window/global scope

    const automator = new NotebookLMAutomator();

    // ---------- Message Listener ----------
    const handlers = {
        [CONFIG.MESSAGES.PING]: (msg, sendResponse) => {
            sendResponse({ ok: true });
        },
        [CONFIG.MESSAGES.CLOSE_DIALOG]: (msg, sendResponse) => {
            automator.closeDialog().then(r => sendResponse(r));
        },
        "CREATE_NOTEBOOK": (msg, sendResponse) => {
            automator.tryCreateNotebook().then(r => sendResponse(r));
        },
        [CONFIG.MESSAGES.ADD_SOURCE]: (msg, sendResponse) => {
            const url = msg?.url;
            if (!url) {
                sendResponse({ ok: false, mode: "failed", detail: "No URL" });
                return;
            }

            (async () => {
                try {
                    // Hard timeout wrapper
                    const timeout = new Promise(resolve =>
                        setTimeout(() => resolve({ ok: false, mode: "failed", detail: "Timeout" }), CONFIG.TIMEOUTS.AUTO_ADD_MAX));

                    const result = await Promise.race([automator.tryAutoAdd(url), timeout]);
                    sendResponse(result);
                } catch (e) {
                    console.error(e);
                    sendResponse({ ok: false, mode: "failed", detail: "Exception: " + e.message });
                }
            })();
        }
    };

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        const handler = handlers[msg?.type];
        if (handler) {
            handler(msg, sendResponse);
            return true; // Keep channel open
        }
        return false;
    });

    console.log("[NotebookLM Helper] Content Script Loaded");

})();
