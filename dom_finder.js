// dom_finder.js
(function () {
    "use strict";

    const NotebookLMFinder = {
        /**
         * Helper to find text in specific tags, stripping icons
         */
        findByText: (root, tag, textFragment) => {
            if (typeof Utils === 'undefined') return null;
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

    // Expose to global scope
    window.NotebookLMFinder = NotebookLMFinder;

})();
