// notebooklm_content.js
// MV3 content script for https://notebooklm.google.com/*
//
// Purpose:
// - Receive a URL from the extension
// - Best-effort attempt to add it as a source in NotebookLM UI (DOM automation)
// - If automation fails, report failure (NO clipboard fallback per user request)
//
// Refactored structure:
// - NotebookLMFinder: Encapsulates all DOM searching and selector logic (Page Object).
// - NotebookLMAutomator: Handles user actions (clicks, inputs, flow control).
// - Message Handler: Entry point.

(() => {
    "use strict";

    // ---------- utils ----------
    // Using Utils.sleep, Utils.norm, Utils.isVisible from utils.js

    // ---------- Finder ----------
    const NotebookLMFinder = {
        /**
         * Helper to find text in specific tags, stripping icons
         */
        findByText: (root, tag, textFragment) => {
            const text = Utils.norm(textFragment);
            const elements = Array.from(root.querySelectorAll(tag)).filter(Utils.isVisible);
            return elements.find(el => {
                const clone = el.cloneNode(true);
                const icons = clone.querySelectorAll(CONFIG.SELECTORS.NOTEBOOKLM.ICONS);
                icons.forEach(i => i.remove());
                const content = Utils.norm(clone.innerText || clone.textContent);
                return content.includes(text);
            });
        },

        /**
         * Helper to find the input field (Robust)
         */
        findInput: (root) => {
            let input = root.querySelector(CONFIG.SELECTORS.NOTEBOOKLM.INPUT);
            if (!input) {
                const inputs = Array.from(root.querySelectorAll("input:not([type='hidden'])")).filter(Utils.isVisible);
                input = inputs.find(el => {
                    const ph = Utils.norm(el.getAttribute("placeholder") || "");
                    const al = Utils.norm(el.getAttribute("aria-label") || "");
                    const combined = ph + " " + al;
                    return CONFIG.TEXTS.INPUT_KEYWORDS.some(k => combined.includes(k));
                });
            }
            return input;
        },

        /**
         * Robust Dialog Finder
         * Prefer looking in the overlay container if it exists (Angular Material)
         */
        findLastVisibleDialog: () => {
            const container = document.querySelector(".cdk-overlay-container") || document.body;
            const candidates = container.querySelectorAll(CONFIG.SELECTORS.NOTEBOOKLM.DIALOG);
            const visible = Array.from(candidates).filter(Utils.isVisible);

            if (visible.length === 0) return null;

            // Return the last one (usually the top-most in z-stack)
            return visible[visible.length - 1];
        },

        findAddSourceButton: () => {
            let addBtn = document.querySelector(CONFIG.SELECTORS.NOTEBOOKLM.ADD_SOURCE_BTNS.join(","));
            if (!addBtn) {
                for (const text of CONFIG.TEXTS.ADD_SOURCE_BUTTONS) {
                    addBtn = NotebookLMFinder.findByText(document, "button", text);
                    if (addBtn) break;
                }
            }
            return addBtn;
        },

        findLimitCounter: (dialog) => {
            return Array.from(dialog.querySelectorAll(CONFIG.SELECTORS.NOTEBOOKLM.LIMIT_COUNTER))
                .find(el => el.innerText.includes("/"));
        },

        findSubmitButton: (container) => {
            const buttons = Array.from(container.querySelectorAll("button")).filter(Utils.isVisible);
            return buttons.find(b => {
                const t = Utils.norm(b.innerText);
                return CONFIG.TEXTS.SUBMIT_BUTTONS.some(k => t.includes(k)) && !b.disabled;
            });
        },

        findCloseButton: (dialog) => {
            return dialog.querySelector(CONFIG.SELECTORS.NOTEBOOKLM.CLOSE_BTNS);
        },

        findBackdrop: () => {
            return document.querySelector(CONFIG.SELECTORS.NOTEBOOKLM.BACKDROP);
        },

        findCreateButtons: () => {
            // Find first visible create button
            const candidates = CONFIG.SELECTORS.NOTEBOOKLM.CREATE_BUTTONS
                .map(s => document.querySelector(s));
            return candidates.find(Utils.isVisible);
        }
    };

    // ---------- Strategies ----------
    // ---------- Debug ----------
    // ---------- Debug ----------
    class DebugPanel {
        constructor() {
            if (!CONFIG.DEBUG_MODE) return;
            this.el = document.createElement('div');
            Object.assign(this.el.style, {
                position: 'fixed',
                top: '60px',
                right: '10px',
                background: 'rgba(0,0,0,0.85)',
                color: '#00ff00',
                zIndex: '999999',
                padding: '10px',
                borderRadius: '5px',
                fontSize: '12px',
                maxHeight: '40vh',
                maxWidth: '300px',
                overflowY: 'auto',
                pointerEvents: 'none',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                boxShadow: '0 4px 6px rgba(0,0,0,0.3)'
            });
            document.body.appendChild(this.el);
        }

        log(msg) {
            if (!CONFIG.DEBUG_MODE) return;
            const line = document.createElement('div');
            line.style.borderBottom = '1px solid #333';
            line.style.padding = '2px 0';
            line.textContent = `[${new Date().toISOString().split('T')[1].slice(3, -1)}] ${msg}`;
            this.el.appendChild(line);
            this.el.scrollTop = this.el.scrollHeight;
            console.log(`[NotebookLM Debug] ${msg}`);
        }
    }

    const debug = new DebugPanel();

    // ---------- Strategies ----------
    const YOUTUBE_SELECTION_STRATEGIES = [
        {
            name: "Existing Input",
            check: (dialog) => {
                const el = NotebookLMFinder.findInput(dialog);
                return el ? { el, type: "input" } : null;
            }
        },
        {
            name: "Generic Button (Card UI)",
            check: (dialog) => {
                // Find all buttons or role=button containing "YouTube" or "Website"
                const candidates = Array.from(dialog.querySelectorAll("button, div[role='button']")).filter(Utils.isVisible);
                const target = candidates.find(el => {
                    const text = Utils.norm(el.innerText || el.textContent);
                    return text.includes("youtube") || text.includes("website");
                });
                return target ? { el: target, type: "button" } : null;
            }
        },
        {
            name: "Youtube Chip",
            check: (dialog) => {
                for (const text of CONFIG.TEXTS.YOUTUBE_CHIPS) {
                    const el = NotebookLMFinder.findByText(dialog, CONFIG.SELECTORS.NOTEBOOKLM.YOUTUBE_CHIP, text);
                    if (el) return { el, type: "button" };
                }
                return null;
            }
        },
        {
            name: "Youtube Label",
            check: (dialog) => {
                for (const text of CONFIG.TEXTS.YOUTUBE_CHIPS) {
                    const el = NotebookLMFinder.findByText(dialog, CONFIG.SELECTORS.NOTEBOOKLM.CHIP_LABEL, text);
                    if (el) {
                        const btn = el.closest(CONFIG.SELECTORS.NOTEBOOKLM.YOUTUBE_CHIP) || el;
                        return { el: btn, type: "button" };
                    }
                }
                return null;
            }
        }
    ];

    // ---------- Automator ----------
    class NotebookLMAutomator {
        async click(el) {
            if (!el) return;
            el.scrollIntoView({ block: "nearest", inline: "nearest" });
            await Utils.sleep(CONFIG.TIMEOUTS.UI_CLICK_DELAY);
            const opts = { bubbles: true, cancelable: true, view: window };
            el.dispatchEvent(new PointerEvent("pointerdown", opts));
            el.dispatchEvent(new MouseEvent("mousedown", opts));
            el.dispatchEvent(new PointerEvent("pointerup", opts));
            el.dispatchEvent(new MouseEvent("mouseup", opts));
            el.click();
        }

        /**
         * Step 1: Open the "Add Source" dialog
         */
        async openAddSourceDialog() {
            debug.log("Step 1: Open Add Source Dialog");
            const addBtn = NotebookLMFinder.findAddSourceButton();

            if (addBtn) {
                await this.click(addBtn);
            } else {
                // Check if dialog is already open
                if (!NotebookLMFinder.findLastVisibleDialog()) {
                    return { ok: false, mode: "failed", detail: "Step1: Add Source Button Not Found" };
                }
            }

            // Wait for Dialog (Step 4 Constant)
            const dialog = await Utils.waitFor(NotebookLMFinder.findLastVisibleDialog, CONFIG.TIMEOUTS.DIALOG_WAIT);
            if (!dialog) return { ok: false, mode: "failed", detail: "Step1: Dialog failed to open" };

            // Wait for animation
            await Utils.sleep(CONFIG.TIMEOUTS.UI_ANIMATION_MED);
            return { ok: true, dialog };
        }

        /**
         * Step 1.5: Check source limit (e.g. 50/50)
         */
        checkSourceLimit(dialog) {
            const limitEl = NotebookLMFinder.findLimitCounter(dialog);
            if (limitEl) {
                const parts = limitEl.innerText.split("/");
                if (parts.length === 2) {
                    const current = parseInt(parts[0].replace(/[^0-9]/g, "").trim());
                    const max = parseInt(parts[1].replace(/[^0-9]/g, "").trim());
                    if (!isNaN(current) && !isNaN(max) && current >= max) {
                        return { ok: false, mode: "limit_reached", detail: `Limit reached (${current}/${max})` };
                    }
                }
            }
            return { ok: true };
        }

        /**
         * Step 2: Select "Source Type" (YouTube)
         */
        async selectYoutubeOption(dialog) {
            debug.log("Step 2: Select YouTube Option");
            const executeStrategies = () => {
                for (const strat of YOUTUBE_SELECTION_STRATEGIES) {
                    const res = strat.check(dialog);
                    if (res) {
                        debug.log(`Strategy Match: ${strat.name}`);
                        return res;
                    }
                }
                debug.log("No strategy matched yet...");
                return null;
            };

            const result = await Utils.waitFor(executeStrategies, CONFIG.TIMEOUTS.ELEMENT_WAIT, CONFIG.TIMEOUTS.POLL_INTERVAL);

            if (result) {
                if (result.type === "input") return { ok: true, input: result.el, dialog };
                if (result.type === "button") {
                    await this.click(result.el);
                    return { ok: true, dialog };
                }
            }
            return { ok: false, mode: "failed", detail: "Step2: YouTube Option Not Found" };
        }

        /**
         * Step 3: Ensure Input field is ready
         */
        async findInputAfterSelection(dialog, inputFromArg) {
            let input = inputFromArg;
            if (!input) {
                input = await Utils.waitFor(() => NotebookLMFinder.findInput(document), CONFIG.TIMEOUTS.ELEMENT_WAIT, CONFIG.TIMEOUTS.POLL_MED);
            }

            if (!input) return { ok: false, mode: "failed", detail: "Step3: Input Field Not Found" };
            return { ok: true, input };
        }

        /**
         * Step 4: Type/Paste URL
         */
        async inputUrl(url, input) {
            debug.log("Step 4: Input URL");
            input.focus();
            await Utils.sleep(CONFIG.TIMEOUTS.UI_CLICK_DELAY);

            // Select all and delete to prevent concatenation (fixing bug)
            document.execCommand("selectAll", false, null);
            document.execCommand("delete", false, null);

            // Fallback if execCommand didn't clear it (e.g. non-editable or blocked)
            if (input.value) {
                input.value = "";
                input.dispatchEvent(new Event("input", { bubbles: true }));
            }

            const success = document.execCommand("insertText", false, url);
            if (!success) {
                input.value = url;
                input.dispatchEvent(new Event("input", { bubbles: true }));
            }
            await Utils.sleep(CONFIG.TIMEOUTS.UI_INPUT_DEBOUNCE); // Small debounce
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));

            return { ok: true };
        }

        /**
         * Step 5 & 6: Submit and Verify
         */
        async submitAndVerify() {
            debug.log("Step 5: Submit & Verify");

            // Wait for validation logic in UI
            // await Utils.sleep(CONFIG.TIMEOUTS.UI_VALIDATION_WAIT); // REMOVED per optimization plan

            debug.log("Step 5.1: Waiting for Submit Button...");
            // Find "Insert" or "Add" button
            const confirmBtn = await Utils.waitFor(() => {
                const container = NotebookLMFinder.findLastVisibleDialog() || document;
                const btn = NotebookLMFinder.findSubmitButton(container);
                // debug.log(`Searching submit button... Found? ${!!btn}`); // Too verbose
                return btn;
            }, CONFIG.TIMEOUTS.DIALOG_WAIT, CONFIG.TIMEOUTS.POLL_INTERVAL);

            if (confirmBtn) {
                debug.log(`Step 5.2: Submit Button Found: "${confirmBtn.innerText}"`);
                await this.click(confirmBtn);
                debug.log("Step 5.3: Clicked Submit Button");
            } else {
                debug.log("Step 5.2: Submit Button NOT Found (Timeout)");
                return { ok: false, mode: "failed", detail: "Step5: Submit button not found" };
            }

            debug.log("Step 5.4: Starting Verification Loop...");
            // Verification
            let lastLog = 0;
            const verifyResult = await Utils.waitFor(() => {
                const now = Date.now();
                const dialogOpen = NotebookLMFinder.findLastVisibleDialog();

                // Logging (throttled)
                if (now - lastLog > 1000) {
                    debug.log(`Verifying... Dialog: ${!!dialogOpen}`);
                    lastLog = now;
                }

                // If dialog is gone, success
                if (!dialogOpen) {
                    debug.log("Success: Dialog Closed");
                    return { ok: true, mode: "auto" };
                }

                // Check for success toast
                const toastText = Utils.norm(document.body.innerText);
                // Note: document.body.innerText matches EVERYTHING. 
                // We should look for specific toast containers if possible, but body is okay for now.
                const foundToast = CONFIG.TEXTS.SUCCESS_TOASTS.find(t => toastText.includes(t));
                if (foundToast) {
                    // Start waiting for dialog to actually close
                    // We return null here to keep waiting until !dialogOpen becomes true above
                    // BUT: we need to be careful not to loop forever if it doesn't close.
                    // However, waitFor has a timeout.
                    // Let's check: if toast is present, we WANT it to close.
                    // If we return { ok: true } now, we risk the race condition.
                    // So we return null to force "keep waiting".
                    // debug.log(`Toast detected: "${foundToast}". Waiting for close...`);
                    return null;
                }

                // Check for potential errors in dialog
                const errorText = Utils.norm(dialogOpen.innerText);
                const foundError = CONFIG.TEXTS.ERROR_DIALOGS.find(e => errorText.includes(e));
                if (foundError) {
                    debug.log(`Error detected: "${foundError}"`);
                    return { ok: false, mode: "failed", detail: "Step6: Error message in dialog" };
                }
                return null; // Keep waiting
            }, CONFIG.TIMEOUTS.VERIFY_POLL_MAX, CONFIG.TIMEOUTS.POLL_FAST);

            if (verifyResult) {
                debug.log("Step 5: Verification Success");
                return verifyResult;
            }

            debug.log("Step 5: Verification Timeout (Dialog never closed)");
            return { ok: false, mode: "failed", detail: "Step6: Dialog did not close (Timeout)" };
        }

        /**
         * Main Flow: Auto Add Source
         */
        async tryAutoAdd(url) {
            debug.log(`START AutoAdd: ${url}`);
            // 1. Open Dialog
            const s1 = await this.openAddSourceDialog();
            if (!s1.ok) return s1;
            const dialog = s1.dialog;

            // 1.5 Check Limit
            const s15 = this.checkSourceLimit(dialog);
            if (!s15.ok) return s15;

            // 2. Select YT Option
            const s2 = await this.selectYoutubeOption(dialog);
            if (!s2.ok) return s2;

            // 3. Find Input
            const s3 = await this.findInputAfterSelection(dialog, s2.input);
            if (!s3.ok) return s3;

            // 4. Input URL
            await this.inputUrl(url, s3.input);

            // 5 & 6. Submit & Verify
            return await this.submitAndVerify();
        }

        async closeDialog() {
            const dialog = NotebookLMFinder.findLastVisibleDialog();
            if (dialog) {
                // Try Escape first
                const opts = { bubbles: true, cancelable: true, view: window, key: "Escape", code: "Escape" };
                dialog.dispatchEvent(new KeyboardEvent("keydown", opts));
                dialog.dispatchEvent(new KeyboardEvent("keyup", opts));

                await Utils.sleep(CONFIG.TIMEOUTS.UI_ANIMATION_SHORT);
                if (NotebookLMFinder.findLastVisibleDialog()) {
                    // Try finding Close button
                    const closeBtn = NotebookLMFinder.findCloseButton(dialog);
                    if (closeBtn) await this.click(closeBtn);
                    else {
                        // Click backdrop
                        const backdrop = NotebookLMFinder.findBackdrop();
                        if (backdrop) await this.click(backdrop);
                    }
                }
            }
            return { ok: true };
        }

        // Step 2 support: Create Notebook
        async tryCreateNotebook() {
            // Wait for button to appear (it might be loading)
            const result = await Utils.waitFor(() => {
                return NotebookLMFinder.findCreateButtons();
            }, CONFIG.TIMEOUTS.CREATE_NOTEBOOK_WAIT, CONFIG.TIMEOUTS.POLL_MED);

            if (result) {
                await this.click(result);
                return { ok: true };
            }
            return { ok: false, detail: "Create button not found" };
        }
    }

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

})();
