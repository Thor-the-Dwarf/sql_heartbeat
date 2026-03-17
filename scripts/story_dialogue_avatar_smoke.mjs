import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/thor/.codex/skills/develop-web-game/scripts/node_modules/playwright/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'output', 'story-dialogue-avatar-smoke');
const outputPath = path.join(outputDir, 'result.json');

fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader']
});

const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push({ type: 'console.error', text: msg.text() });
});
page.on('pageerror', (error) => {
    errors.push({ type: 'pageerror', text: String(error) });
});

const url = 'http://127.0.0.1:4186/index.html';
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);

await page.locator('.nav-mode-btn[data-lesson-mode="medium"]').click();
await page.waitForTimeout(450);
await page.locator('.lesson-story-root-folder > summary').click();
await page.waitForTimeout(200);
await page.locator('.lesson-tool-folder > summary').filter({ hasText: 'Das Gold der Kupfermine' }).click();
await page.waitForTimeout(200);
await page.locator('.story-title-item').filter({ hasText: '3 Alle friedlichen Arbeiter' }).click();
await page.waitForTimeout(500);

const avatarNames = await page.locator('.guide-avatar-name').allTextContents();
const speechTexts = await page.locator('.guide-speech-text').allTextContents();
const speechHtml = await page.locator('.guide-speech-text').evaluateAll((nodes) => nodes.map((node) => node.innerHTML));

await page.screenshot({ path: path.join(outputDir, 'shot-final.png'), fullPage: true });
await browser.close();

const blockingErrors = errors.filter((entry) => !String(entry.text || '').includes('404'));

const result = {
    url,
    avatarNames,
    speechTexts,
    speechHtml,
    errors,
    blockingErrors,
    pass: avatarNames.length >= 2
        && avatarNames[0] === 'Hannes'
        && avatarNames[1] === 'Fremde'
        && speechTexts.length === 2
        && speechHtml.every((entry) => !String(entry || '').toLowerCase().includes('<br'))
        && blockingErrors.length === 0
};

fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
