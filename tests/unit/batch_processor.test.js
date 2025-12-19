
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock globs
global.chrome = {
    scripting: {
        executeScript: vi.fn(),
    },
    tabs: {
        sendMessage: vi.fn(),
        onUpdated: {
            addListener: vi.fn(),
            removeListener: vi.fn(),
        },
        get: vi.fn(),
    },
    action: {
        setBadgeText: vi.fn(),
        setBadgeBackgroundColor: vi.fn(),
    },
};

global.Utils = {
    sleep: vi.fn().mockResolvedValue(true),
    normalizeUrl: (url) => url, // Simple pass-through or mock
    norm: (s) => s.toLowerCase()
};

// Mock Constants
const { CONFIG } = require('../../constants.js');
global.CONFIG = CONFIG;

const { BatchProcessor } = require('../../batch_processor.js');

describe('BatchProcessor', () => {
    let deps;
    let processor;

    beforeEach(() => {
        deps = {
            badge: vi.fn(),
            handleDashboardRedirect: vi.fn().mockResolvedValue(true),
            ensureContentScript: vi.fn().mockResolvedValue(true),
        };
        processor = new BatchProcessor(deps);
        vi.clearAllMocks();
    });

    describe('extractPlaylistUrls', () => {
        it('should extract URLs from script execution result', async () => {
            const mockResult = [
                {
                    result: [
                        'https://www.youtube.com/watch?v=1',
                        'https://www.youtube.com/watch?v=2',
                    ]
                }
            ];
            chrome.scripting.executeScript.mockResolvedValue(mockResult);

            const urls = await processor.extractPlaylistUrls(123);

            expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
                target: { tabId: 123 },
                func: expect.any(Function),
                args: expect.any(Array)
            });
            expect(urls).toHaveLength(2);
            expect(urls[0]).toBe('https://www.youtube.com/watch?v=1');
        });

        it('should return empty array if no results', async () => {
            chrome.scripting.executeScript.mockResolvedValue([]);
            const urls = await processor.extractPlaylistUrls(123);
            expect(urls).toEqual([]);
        });
    });

    describe('processSingleUrlInBatch', () => {
        it('should success adding a source', async () => {
            chrome.tabs.sendMessage.mockResolvedValue({ ok: true, mode: 'auto' });

            const res = await processor.processSingleUrlInBatch('http://url', 0, 10, 999, 123);

            expect(deps.badge).toHaveBeenCalledWith(123, '1/10', expect.any(String));
            expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(999, { type: CONFIG.MESSAGES.ADD_SOURCE, url: 'http://url' });
            expect(res.ok).toBe(true);
        });

        it('should stop on limit reached', async () => {
            chrome.tabs.sendMessage.mockResolvedValue({ ok: false, mode: 'limit_reached' });

            const res = await processor.processSingleUrlInBatch('http://url', 5, 10, 999, 123);

            expect(deps.badge).toHaveBeenCalledWith(123, 'FULL', CONFIG.COLORS.ERROR);
            expect(res.ok).toBe(false);
            expect(res.reason).toBe('limit');
        });

        it('should handle exceptions gracefully', async () => {
            chrome.tabs.sendMessage.mockRejectedValue(new Error("Network Error"));

            const res = await processor.processSingleUrlInBatch('http://url', 0, 10, 999, 123);

            expect(res.ok).toBe(false);
            expect(res.reason).toBe('exception');
        });
    });

    describe('handlePlaylistBatch', () => {
        it('should process a list of urls', async () => {
            // Mock extraction
            vi.spyOn(processor, 'extractPlaylistUrls').mockResolvedValue(['u1', 'u2']);

            // Mock single process
            vi.spyOn(processor, 'processSingleUrlInBatch').mockResolvedValue({ ok: true });

            await processor.handlePlaylistBatch({ targetTabId: 999, sourceTabId: 123 }, vi.fn());

            expect(processor.extractPlaylistUrls).toHaveBeenCalled();
            expect(deps.handleDashboardRedirect).toHaveBeenCalled();
            expect(deps.ensureContentScript).toHaveBeenCalled();

            expect(processor.processSingleUrlInBatch).toHaveBeenCalledTimes(2);
            expect(deps.badge).toHaveBeenCalledWith(123, 'DONE', CONFIG.COLORS.SUCCESS);

            // Should close dialog at the end
            expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(999, { type: CONFIG.MESSAGES.CLOSE_DIALOG });
        });

        it('should stop processing if limit reached', async () => {
            vi.spyOn(processor, 'extractPlaylistUrls').mockResolvedValue(['u1', 'u2', 'u3']);

            // First succeeds, Second hits limit
            vi.spyOn(processor, 'processSingleUrlInBatch')
                .mockResolvedValueOnce({ ok: true })
                .mockResolvedValueOnce({ ok: false, reason: 'limit' });

            await processor.handlePlaylistBatch({ targetTabId: 999, sourceTabId: 123 }, vi.fn());

            expect(processor.processSingleUrlInBatch).toHaveBeenCalledTimes(2);
            // Third one should not be called
            // And badge should show DONE (or whatever state was left, actually limit returns DONE in current logic at end?)
            // The loop breaks, then it prints DONE.
            // Wait, if limit is reached, we probably shouldn't print DONE.
            // Current Code:
            // if (!result.ok && result.reason === "limit") break;
            // this.deps.badge(sourceTabId, "DONE", CONFIG.COLORS.SUCCESS); 
            // -> This looks like a bug (or at least weird UX). Usefulness of verifying logic!

            expect(deps.badge).toHaveBeenCalledWith(123, 'LIMIT', CONFIG.COLORS.ERROR);
        });
    });
});
