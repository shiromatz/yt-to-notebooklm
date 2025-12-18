// notebooklm_content.js
// MV3 content script for https://notebooklm.google.com/*
//
// Purpose:
// - Receive a URL from the extension
// - Best-effort attempt to add it as a source in NotebookLM UI (DOM automation)
// - If automation fails, report failure (NO clipboard fallback per user request)
//
// Notes:
// - NotebookLM UI can change. This script uses a hybrid approach:
//   1. Smart Selectors (e.g. formcontrolname, mat-chip text)
//   2. Tab Navigation Fallback (simulating user keyboard flow)
//   3. State Short-circuit: Checks if Input is already visible to skip navigation.
//   4. Robust Retry Loops: For all critical element findings.

(() => {
    "use strict";

    // ---------- utils ----------
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function norm(s) {
        return (s || "").replace(/\s+/g, " ").trim().toLowerCase();
    }

    function isVisible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    // Helper to find text in specific tags, stripping icons
    function findElementByText(root, tag, textFragment) {
        const text = norm(textFragment);
        // querySelectorAll returns a static NodeList or live NodeList? standard is static usually, but we convert to Array
        const elements = Array.from(root.querySelectorAll(tag)).filter(isVisible);
        return elements.find(el => {
            const clone = el.cloneNode(true);
            const icons = clone.querySelectorAll(".mat-icon, .material-icons, i");
            icons.forEach(i => i.remove());
            const content = norm(clone.innerText || clone.textContent);
            return content.includes(text);
        });
    }

    // Helper to find the input field (Robust)
    function findInput(root) {
        let input = root.querySelector("input[formcontrolname='newUrl']");
        if (!input) {
            const inputs = Array.from(root.querySelectorAll("input:not([type='hidden'])")).filter(isVisible);
            input = inputs.find(el => {
                const ph = norm(el.getAttribute("placeholder") || "");
                const al = norm(el.getAttribute("aria-label") || "");
                const combined = ph + " " + al;
                return combined.includes("youtube") || combined.includes("url") || combined.includes("link");
            });
        }
        return input;
    }

    // Robust Dialog Finder: Gets the LAST visible dialog (Angular Material stack)
    function findLastVisibleDialog() {
        const candidates = document.querySelectorAll("mat-dialog-container, [role='dialog']");
        const visible = Array.from(candidates).filter(isVisible);
        if (visible.length === 0) return null;
        return visible[visible.length - 1]; // Top-most dialog
    }

    // ---------- Automation Steps ----------

    async function click(el) {
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
        await sleep(50);
        const opts = { bubbles: true, cancelable: true, view: window };
        el.dispatchEvent(new PointerEvent("pointerdown", opts));
        el.dispatchEvent(new MouseEvent("mousedown", opts));
        el.dispatchEvent(new PointerEvent("pointerup", opts));
        el.dispatchEvent(new MouseEvent("mouseup", opts));
        el.click();
    }

    async function tryAutoAdd(url) {
        console.log("[NBLM-Ext] Starting Auto Add...");

        // --- STEP 1: Open Dialog ---
        let addBtn = document.querySelector("button[aria-label='Add source'], button[aria-label='ソースを追加']");
        if (!addBtn) {
            addBtn = findElementByText(document, "button", "Add source") ||
                findElementByText(document, "button", "ソースを追加");
        }

        if (addBtn) {
            console.log("[NBLM-Ext] Clicking Add Source Button");
            await click(addBtn);
        } else {
            // Check if dialog is already open
            if (!findLastVisibleDialog()) {
                return { ok: false, mode: "failed", detail: "Step1: Add Source Button Not Found" };
            }
        }

        // Wait for Dialog
        let dialog = null;
        for (let i = 0; i < 15; i++) {
            dialog = findLastVisibleDialog();
            if (dialog) break;
            await sleep(200);
        }
        if (!dialog) return { ok: false, mode: "failed", detail: "Step1: Dialog failed to open" };

        await sleep(500); // Wait for initial animation

        // --- STEP 2: Select YouTube (Conditional with Retry) ---
        console.log("[NBLM-Ext] Looking for YouTube option or Input screen...");

        let youtubeBtn = null;
        let input = null;

        // Loop to wait for content
        for (let attempt = 0; attempt < 8; attempt++) {
            // Check Input first
            input = findInput(dialog);
            if (input) {
                console.log("[NBLM-Ext] Input found! Skipping navigation.");
                break;
            }

            // Check YouTube Button
            // Strategy A: YouTube Chip
            youtubeBtn = findElementByText(dialog, "mat-chip", "youtube");
            // Strategy B: Chip Action Class
            if (!youtubeBtn) {
                youtubeBtn = findElementByText(dialog, ".mat-mdc-chip-action-label", "youtube");
                if (youtubeBtn) youtubeBtn = youtubeBtn.closest("mat-chip") || youtubeBtn;
            }

            if (youtubeBtn) {
                console.log("[NBLM-Ext] YouTube option found.");
                break;
            }

            await sleep(250);
            // Refresh dialog reference in case it changed
            dialog = findLastVisibleDialog() || dialog;
        }

        if (input) {
            // Proceed to input
        } else if (youtubeBtn) {
            console.log("[NBLM-Ext] Clicking YouTube Chip");
            await click(youtubeBtn);
        } else {
            return { ok: false, mode: "failed", detail: "Step2: YouTube Option Not Found" };
        }

        // --- STEP 3: Find Input Helper (Post-Click if needed) ---
        if (!input) {
            for (let attempt = 0; attempt < 5; attempt++) {
                await sleep(400);
                input = findInput(document); // Check global doc
                if (input) break;
            }
        }

        if (!input) {
            // One last-ditch retry of clicking YouTube if visible
            if (youtubeBtn && isVisible(youtubeBtn)) {
                console.log("[NBLM-Ext] Retrying click...");
                await click(youtubeBtn);
                await sleep(500);
                input = findInput(document);
            }
        }

        if (!input) return { ok: false, mode: "failed", detail: "Step3: Input Field Not Found" };

        // --- STEP 4: Input URL ---
        console.log("[NBLM-Ext] Inputting URL...");
        input.focus();
        await sleep(50);

        const success = document.execCommand("insertText", false, url);
        if (!success) {
            input.value = url;
            input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        await sleep(100);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));

        // --- STEP 5: Confirm ---
        await sleep(800); // Wait for validation
        // Find "Insert" or "Add" button
        let confirmBtn = null;
        for (let i = 0; i < 15; i++) {
            const container = findLastVisibleDialog() || document;
            const buttons = Array.from(container.querySelectorAll("button")).filter(isVisible);
            confirmBtn = buttons.find(b => {
                const t = norm(b.innerText);
                return (t.includes("insert") || t.includes("add") || t.includes("追加") || t.includes("挿入")) && !b.disabled;
            });
            if (confirmBtn) break;
            await sleep(200);
        }

        if (confirmBtn) {
            console.log("[NBLM-Ext] Clicking Confirm");
            await click(confirmBtn);
        } else {
            // Fallback: Enter key on input
            input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter" }));
            await sleep(100);
            input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter", code: "Enter" }));
        }

        // --- STEP 6: Verification ---
        // OPTIMIZED: Polling instead of fixed sleep
        for (let i = 0; i < 20; i++) { // Max 2s polling
            await sleep(100);
            const dialogOpen = document.querySelector("mat-dialog-container");
            if (!dialogOpen) {
                return { ok: true, mode: "auto" };
            }
            const toastText = norm(document.body.innerText);
            if (toastText.includes("added to notebook") || toastText.includes("ソースを追加しました")) {
                return { ok: true, mode: "auto" };
            }
        }

        return { ok: false, mode: "failed", detail: "Step6: Dialog did not close" };
    }

    // ---------- Message Listener ----------
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg?.type === "PING") {
            sendResponse({ ok: true });
            return true;
        }
        if (msg?.type !== "ADD_SOURCE_URL") return true;

        const url = msg?.url;
        if (!url) {
            sendResponse({ ok: false, mode: "failed", detail: "No URL" });
            return true;
        }

        (async () => {
            try {
                // Hard timeout wrapper
                const timeout = new Promise(resolve =>
                    setTimeout(() => resolve({ ok: false, mode: "failed", detail: "Timeout" }), 9000));

                const result = await Promise.race([tryAutoAdd(url), timeout]);
                sendResponse(result);
            } catch (e) {
                console.error(e);
                sendResponse({ ok: false, mode: "failed", detail: "Exception: " + e.message });
            }
        })();
        return true;
    });

})();
