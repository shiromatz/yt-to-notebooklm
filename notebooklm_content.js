// notebooklm_content.js
// MV3 content script for https://notebooklm.google.com/*
//
// Purpose:
// - Receive a URL from the extension
// - Best-effort attempt to add it as a source in NotebookLM UI (DOM automation)
// - If automation fails, copy URL to clipboard as fallback
//
// Notes:
// - NotebookLM UI can change. This script is intentionally selector-agnostic and uses text-based heuristics.
// - No network requests. No access to other sites. Runs only on notebooklm.google.com via manifest matches.

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
        if (style.visibility === "hidden" || style.display === "none") return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function uniq(arr) {
        return Array.from(new Set(arr));
    }

    async function copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // Fallback (older permissions / blocked clipboard)
            try {
                const ta = document.createElement("textarea");
                ta.value = text;
                ta.style.position = "fixed";
                ta.style.left = "-9999px";
                ta.style.top = "0";
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                const ok = document.execCommand("copy");
                ta.remove();
                return ok;
            } catch {
                return false;
            }
        }
    }

    function scoreByText(el, candidates) {
        // candidates: array of strings (lowercase)
        const text = norm(el?.innerText || el?.textContent || "");
        if (!text) return 0;

        // Exact match beats contains beats partial
        let score = 0;
        for (const c of candidates) {
            if (!c) continue;
            if (text === c) score = Math.max(score, 100);
            else if (text.includes(c)) score = Math.max(score, 60);
            else {
                // token overlap
                const tokens = c.split(" ");
                const hits = tokens.filter((t) => t && text.includes(t)).length;
                if (hits >= Math.max(1, Math.floor(tokens.length / 2))) score = Math.max(score, 30 + hits);
            }
        }
        return score;
    }

    function findClickableByText(candidates) {
        const cands = candidates.map((c) => norm(c)).filter(Boolean);

        // Look for elements that behave like buttons/links.
        const elems = Array.from(
            document.querySelectorAll(
                "button, a, [role='button'], [role='menuitem'], [role='tab'], [tabindex]"
            )
        ).filter(isVisible);

        let best = null;
        let bestScore = 0;

        for (const el of elems) {
            // Skip disabled controls
            const ariaDisabled = el.getAttribute("aria-disabled");
            if (ariaDisabled === "true") continue;
            if (el.disabled === true) continue;

            const s = scoreByText(el, cands);
            if (s > bestScore) {
                bestScore = s;
                best = el;
            }
        }

        // Require a minimum score to avoid random clicks
        if (best && bestScore >= 50) return best;
        return null;
    }

    function findDialogRoot() {
        // Common dialog containers
        const dialogs = Array.from(document.querySelectorAll("[role='dialog'], dialog")).filter(isVisible);
        if (!dialogs.length) return null;

        // Pick the top-most (last in DOM often overlays)
        return dialogs[dialogs.length - 1];
    }

    function findInputCandidate(root = document) {
        // Prefer input/textarea; then contenteditable.
        const inputs = Array.from(root.querySelectorAll("input, textarea")).filter(isVisible);

        // Score inputs by placeholder/aria-label hinting URL/link
        const scored = inputs
            .map((el) => {
                const ph = norm(el.getAttribute("placeholder") || "");
                const al = norm(el.getAttribute("aria-label") || "");
                const nm = norm(el.getAttribute("name") || "");
                const hint = `${ph} ${al} ${nm}`;
                let score = 0;
                if (hint.includes("url")) score += 30;
                if (hint.includes("link")) score += 30;
                if (hint.includes("http")) score += 10;
                // Prefer text-like inputs
                const type = norm(el.getAttribute("type") || "text");
                if (type === "url") score += 30;
                if (type === "text" || type === "search") score += 10;
                return { el, score };
            })
            .sort((a, b) => b.score - a.score);

        if (scored.length && scored[0].score > 0) return scored[0].el;
        if (inputs.length) return inputs[0];

        // contenteditable fallback
        const edits = Array.from(root.querySelectorAll("[contenteditable='true']")).filter(isVisible);
        return edits.length ? edits[0] : null;
    }

    async function setValue(el, value) {
        el.focus();

        // Clear existing value
        try {
            if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
                el.value = "";
                el.dispatchEvent(new Event("input", { bubbles: true }));
            } else if (el.isContentEditable) {
                document.execCommand("selectAll", false, null);
                document.execCommand("delete", false, null);
            }
        } catch {
            // ignore
        }

        await sleep(50);

        // Set new value
        if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
            el.value = value;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
        } else if (el.isContentEditable) {
            document.execCommand("insertText", false, value);
            el.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }

    async function click(el) {
        el.scrollIntoView({ block: "center", inline: "center" });
        await sleep(50);
        el.click();
    }

    // ---------- automation core ----------
    // Strategy:
    // 1) Ensure we are on a page where adding sources makes sense (best-effort)
    // 2) Try to open an "Add source" flow:
    //    - click "Add source" / "Add sources" / "Add" near sources
    //    - if not found, try "Sources" tab then "Add source"
    // 3) Once a dialog/panel appears, find an input for URL, paste, and confirm.
    // 4) If we cannot find confirm button, leave URL in clipboard (fallback).
    //
    // Returns: { ok: boolean, mode: "auto"|"clipboard"|"failed", detail?: string }
    async function tryAutoAdd(url) {
        const ADD_SOURCE_TEXTS = [
            "add source",
            "add sources",
            "add a source",
            "add",
            "import",
            "add link",
            "add url",
            "insert link",
            "upload",
            "source"
        ];

        const SOURCES_TEXTS = ["sources", "source"];

        const CONFIRM_TEXTS = [
            "add",
            "import",
            "insert",
            "confirm",
            "done",
            "add to notebook",
            "add to sources",
            "create",
            "save"
        ];

        const URL_OPTION_TEXTS = [
            "url",
            "link",
            "website",
            "web",
            "from url",
            "paste a link",
            "paste link"
        ];

        // Step 0: If there is a "Sources" section/tab, try focusing it (optional)
        // This can reduce false positives where "Add" means something else.
        const sourcesTab = findClickableByText(SOURCES_TEXTS);
        if (sourcesTab) {
            await click(sourcesTab);
            await sleep(250);
        }

        // Step 1: Try clicking a direct "Add source" button
        let addBtn = findClickableByText(["add source", "add sources", "add a source"]);
        if (!addBtn) {
            // try broader "Add" but only if nearby sources context exists
            // (best-effort: if page contains "Sources" text)
            const pageText = norm(document.body?.innerText || "");
            if (pageText.includes("sources")) {
                addBtn = findClickableByText(["add", "import"]);
            }
        }
        if (addBtn) {
            await click(addBtn);
            await sleep(350);
        } else {
            // If we cannot find any add UI, automation likely impossible
            return { ok: false, mode: "failed", detail: "add_button_not_found" };
        }

        // Step 2: If a menu/dialog offers choices (e.g., URL vs file), prefer URL/link
        // Look for a newly opened dialog root and click URL option if present.
        let dialog = findDialogRoot();
        if (dialog) {
            const urlOption = findClickableByText(URL_OPTION_TEXTS);
            if (urlOption) {
                await click(urlOption);
                await sleep(250);
                dialog = findDialogRoot() || dialog;
            }
        } else {
            // Sometimes it opens a side panel, not a dialog. Continue anyway.
            await sleep(150);
            dialog = findDialogRoot();
        }

        // Step 3: Find an input within dialog if exists, else in document
        const scope = dialog || document;
        const input = findInputCandidate(scope);
        if (!input) {
            return { ok: false, mode: "failed", detail: "input_not_found" };
        }

        await setValue(input, url);
        await sleep(150);

        // Step 4: Find and click confirm within dialog/scope, else in whole doc (some UIs render buttons outside)
        let confirm =
            (dialog && findClickableByText(CONFIRM_TEXTS)) ||
            findClickableByText(CONFIRM_TEXTS);

        if (!confirm) {
            // As a last attempt, press Enter in input (many dialogs accept Enter)
            try {
                input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter" }));
                input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter", code: "Enter" }));
                await sleep(300);
                // We cannot reliably know success; treat as failed to be conservative
                return { ok: false, mode: "failed", detail: "confirm_not_found" };
            } catch {
                return { ok: false, mode: "failed", detail: "confirm_not_found" };
            }
        }

        await click(confirm);
        await sleep(500);

        // Step 5: Heuristic success detection
        // If dialog disappears, assume success.
        const dialogAfter = findDialogRoot();
        if (dialog && dialogAfter === null) {
            return { ok: true, mode: "auto" };
        }

        // If there is any toast/snackbar-like element with success-ish text, assume success.
        const toastText = norm(document.body?.innerText || "");
        if (toastText.includes("added") || toastText.includes("imported") || toastText.includes("success")) {
            return { ok: true, mode: "auto" };
        }

        // Unknown state: still count as auto attempt done (but conservative: false)
        return { ok: false, mode: "failed", detail: "unknown_result" };
    }

    // ---------- message handling ----------
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        (async () => {
            if (msg?.type === "PING") {
                sendResponse({ ok: true });
                return;
            }

            if (msg?.type !== "ADD_SOURCE_URL") return;

            const url = msg?.url;
            if (!url || typeof url !== "string") {
                sendResponse({ ok: false, mode: "failed", detail: "no_url" });
                return;
            }

            // 1) Try full automation
            const r = await tryAutoAdd(url);
            if (r.ok && r.mode === "auto") {
                sendResponse(r);
                return;
            }

            // 2) Clipboard fallback
            const copied = await copyToClipboard(url);
            if (copied) {
                sendResponse({ ok: true, mode: "clipboard" });
            } else {
                sendResponse({ ok: false, mode: "failed", detail: r.detail || "clipboard_failed" });
            }
        })();

        return true; // keep the message channel open for async response
    });
})();
