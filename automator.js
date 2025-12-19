// automator.js
(function () {
    "use strict";

    // Strategies for selecting YouTube source type
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

    class NotebookLMAutomator {
        constructor() {
            this.debug = window.debugPanel || { log: console.log };
        }

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
            this.debug.log("Step 1: Open Add Source Dialog");
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
            this.debug.log("Step 2: Select YouTube Option");
            const executeStrategies = () => {
                for (const strat of YOUTUBE_SELECTION_STRATEGIES) {
                    const res = strat.check(dialog);
                    if (res) {
                        this.debug.log(`Strategy Match: ${strat.name}`);
                        return res;
                    }
                }
                this.debug.log("No strategy matched yet...");
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
            this.debug.log("Step 4: Input URL");
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
         * Refactored to separate Verification Logic
         */
        async submitAndVerify() {
            this.debug.log("Step 5: Submit & Verify");

            // 1. Find and Click Submit
            const confirmBtn = await this._waitForSubmitButton();
            if (!confirmBtn) {
                return { ok: false, mode: "failed", detail: "Step5: Submit button not found" };
            }

            this.debug.log(`Step 5.2: Submit Button Found: "${confirmBtn.innerText}"`);
            await this.click(confirmBtn);

            // 2. Verify Result using Helper
            const verifier = new VerificationHelper(this.debug);
            return await verifier.waitForCompletion();
        }

        async _waitForSubmitButton() {
            return await Utils.waitFor(() => {
                const container = NotebookLMFinder.findLastVisibleDialog() || document;
                return NotebookLMFinder.findSubmitButton(container);
            }, CONFIG.TIMEOUTS.DIALOG_WAIT, CONFIG.TIMEOUTS.POLL_INTERVAL);
        }

        /**
         * Main Flow: Auto Add Source
         */
        async tryAutoAdd(url) {
            this.debug.log(`START AutoAdd: ${url}`);
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

    /**
     * Helper class to handle the verification state machine
     */
    class VerificationHelper {
        constructor(debugLogger) {
            this.debug = debugLogger;
        }

        async waitForCompletion() {
            this.debug.log("Step 5.4: Starting Verification Loop...");

            const result = await Utils.waitFor(
                () => this._checkState(),
                CONFIG.TIMEOUTS.VERIFY_POLL_MAX,
                CONFIG.TIMEOUTS.POLL_FAST
            );

            if (result) return result;

            // Timeout fallback
            if (this._checkSuccessToast()) {
                this.debug.log("Step 5: Timeout but Success Toast present. Assuming success.");
                return { ok: true, mode: "auto" };
            }

            this.debug.log("Step 5: Verification Timeout (Dialog never closed)");
            return { ok: false, mode: "failed", detail: "Step6: Dialog did not close (Timeout)" };
        }

        _checkState() {
            // Priority 1: Dialog Closed (Success)
            if (!NotebookLMFinder.findLastVisibleDialog()) {
                this.debug.log("Success: Dialog Closed");
                return { ok: true, mode: "auto" };
            }

            // Priority 2: Error Message (Failure)
            const error = this._checkErrorDialog();
            if (error) {
                this.debug.log(`Error detected: "${error}"`);
                return { ok: false, mode: "failed", detail: "Step6: Error message in dialog" };
            }

            // Priority 3: Success Toast (Intermediate Success)
            // If toast is present, we technically succeeded, but we ideally wait for the dialog to close.
            // Returning null keeps waiting. 
            // If we wanted to exit early on toast, we could returns { ok: true ... } here.
            // Current logic: Keep waiting for dialog close for cleanliness.
            if (this._checkSuccessToast()) {
                // We just log it for now, but don't return yet unless we want to "early exit"
                // The original logic returned null (wait).
            }

            return null; // Keep waiting
        }

        _checkErrorDialog() {
            const dialog = NotebookLMFinder.findLastVisibleDialog();
            if (!dialog) return null;
            const text = Utils.norm(dialog.innerText);
            return CONFIG.TEXTS.ERROR_DIALOGS.find(e => text.includes(e));
        }

        _checkSuccessToast() {
            const text = Utils.norm(document.body.innerText);
            return CONFIG.TEXTS.SUCCESS_TOASTS.find(t => text.includes(t));
        }
    }

    // Expose to global scope
    window.NotebookLMAutomator = NotebookLMAutomator;

})();
