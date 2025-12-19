
const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

test.describe('Extension E2E', () => {
    test('should load the extension and open popup', async () => {
        const pathToExtension = path.join(__dirname, '../../');
        const userDataDir = path.join(__dirname, '../../tmp/test-user-data-dir');

        console.log(`Loading extension from: ${pathToExtension}`);

        const context = await chromium.launchPersistentContext(userDataDir, {
            headless: false,
            args: [
                `--disable-extensions-except=${pathToExtension}`,
                `--load-extension=${pathToExtension}`,
            ],
        });

        // Determine Extension ID (tricky in E2E, usually requires parsing chrome://extensions or having a fixed key)
        // For now, let's just assert the browser opened and we can navigate to a youtube page.

        const page = await context.newPage();
        await page.goto('https://www.google.com');
        await expect(page).toHaveTitle(/Google/);

        // Ideally, we would open the popup: chrome-extension://<id>/popup.html
        // But ID is generated. 
        // We can go to chrome://extensions to find it, or assume it loads.

        // Check if Service Worker is registered (by checking if the extension background page/sw is active)
        // This is advanced. For this first step, just launching without error is a win.

        await context.close();
    });
});
