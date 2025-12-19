// debug_panel.js
(function () {
    "use strict";

    class DebugPanel {
        constructor() {
            // Check CONFIG.DEBUG_MODE dynamically if possible, or assume global CONFIG is available
            // In content script context, all files share the same window/global scope if loaded together.
            this.enabled = typeof CONFIG !== 'undefined' && CONFIG.DEBUG_MODE;

            if (!this.enabled) return;

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
            if (!this.enabled) return;
            const line = document.createElement('div');
            line.style.borderBottom = '1px solid #333';
            line.style.padding = '2px 0';
            line.textContent = `[${new Date().toISOString().split('T')[1].slice(3, -1)}] ${msg}`;
            this.el.appendChild(line);
            this.el.scrollTop = this.el.scrollHeight;
            console.log(`[NotebookLM Debug] ${msg}`);
        }
    }

    // Expose to global scope
    window.DebugPanel = DebugPanel;
    window.debugPanel = new DebugPanel(); // Singleton instance
})();
