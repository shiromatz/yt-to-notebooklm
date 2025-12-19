// utils.js
// Shared utilities for Service Worker and Content Scripts

const Utils = {
    /**
     * Async sleep function
     * @param {number} ms 
     */
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),

    /**
     * Normalize string: trim, lowercase, replace multiple spaces
     * @param {string} s 
     */
    norm: (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase(),

    /**
     * Check if element is visible (DOM only)
     * @param {Element} el 
     */
    isVisible: (el) => {
        if (!el) return false;
        // Check if running in a context with window (Content Script)
        if (typeof window === "undefined") return false;

        const style = window.getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    },

    /**
     * Wait for a condition to be true
     * @param {Function} predicate - Returns truthy value when condition is met
     * @param {number} timeout - Max wait time in ms
     * @param {number} interval - Check interval in ms
     * @returns {Promise<any>} - Returns the truthy value or null on timeout
     */
    waitFor: async (predicate, timeout = 3000, interval = 200) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const result = await predicate(); // Support async predicate
            if (result) return result;
            await Utils.sleep(interval);
        }
        return null;
    },

    /**
     * Normalize URL to standard format
     * @param {string} raw 
     */
    normalizeUrl: (raw) => {
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
};

// Expose to global scope
if (typeof window !== "undefined") {
    window.Utils = Utils;
} else {
    self.Utils = Utils;
}
