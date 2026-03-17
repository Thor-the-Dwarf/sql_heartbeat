import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/thor/.codex/skills/develop-web-game/scripts/node_modules/playwright/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'output', 'story-progress-ui-smoke');
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
await page.waitForTimeout(800);

const activeMode = await page.locator('.nav-mode-btn.is-active').getAttribute('data-lesson-mode');
const manifest = await page.evaluate(async () => {
    const response = await fetch('Storys/stories.index.json', { cache: 'no-store' });
    return response.json();
});
const storyPath = manifest?.defaultStoryPathByMode?.[activeMode] || manifest?.defaultStoryPath || manifest?.storiesByMode?.[activeMode]?.[0]?.path;
const storyJson = await page.evaluate(async (selectedPath) => {
    const response = await fetch(selectedPath, { cache: 'no-store' });
    return response.json();
}, storyPath);

const firstTitle = storyJson?.titles?.[0] || null;
const secondTitle = storyJson?.titles?.[1] || null;
const starterSql = String(firstTitle?.guideScenes?.[0]?.starterSql || '').trim();

if (!starterSql || !firstTitle || !secondTitle) {
    throw new Error('Story fixture incomplete for UI smoke.');
}

await page.click('.lesson-story-root-folder > summary');
await page.waitForTimeout(150);
await page.click('.lesson-story-root-folder .lesson-tool-folder > summary');
await page.waitForTimeout(150);
await page.click('.story-title-item');
await page.waitForTimeout(300);

const initialButtonState = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('.guide-story-nav-btn'));
    const finishButton = buttons.find((button) => /fertig|weiter/i.test(button.textContent || ''));
    return {
        text: finishButton?.textContent?.trim() || '',
        disabled: finishButton ? finishButton.disabled : null,
        readyClass: finishButton ? finishButton.classList.contains('is-ready') : false
    };
});

await page.click('.CodeMirror');
await page.keyboard.press('Meta+A');
await page.keyboard.type(starterSql, { delay: 8 });
await page.waitForTimeout(500);

const readyState = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('.guide-story-nav-btn'));
    const finishButton = buttons.find((button) => /fertig|weiter/i.test(button.textContent || ''));
    const activeStory = document.querySelector('.story-title-item.is-active');
    return {
        disabled: finishButton ? finishButton.disabled : null,
        readyClass: finishButton ? finishButton.classList.contains('is-ready') : false,
        activeStoryReadyClass: activeStory ? activeStory.classList.contains('is-ready') : false,
        activeStoryCompleteClass: activeStory ? activeStory.classList.contains('is-complete') : false
    };
});

await page.click('.guide-story-nav-btn.is-ready:not([disabled])');
await page.waitForTimeout(450);

const afterAdvance = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.story-title-item'));
    const activeStory = document.querySelector('.story-title-item.is-active .story-title-name');
    const completedCount = items.filter((item) => item.classList.contains('is-complete')).length;
    return {
        activeTitle: activeStory ? activeStory.textContent.trim() : '',
        completedCount,
        firstItemComplete: items[0] ? items[0].classList.contains('is-complete') : false,
        secondItemActive: items[1] ? items[1].classList.contains('is-active') : false
    };
});

await page.screenshot({ path: path.join(outputDir, 'shot-final.png'), fullPage: true });
await browser.close();

const blockingErrors = errors.filter((entry) => {
    const text = String(entry?.text || '');
    return !text.includes('status of 404 (File not found)');
});

const result = {
    url,
    activeMode,
    storyPath,
    initialButtonState,
    readyState,
    afterAdvance,
    errors,
    blockingErrors,
    pass: initialButtonState.disabled === true
        && initialButtonState.readyClass === false
        && readyState.disabled === false
        && readyState.readyClass === true
        && readyState.activeStoryReadyClass === true
        && afterAdvance.firstItemComplete === true
        && afterAdvance.secondItemActive === true
        && afterAdvance.completedCount >= 1
        && blockingErrors.length === 0
};

fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
