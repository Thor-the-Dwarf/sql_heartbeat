import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/thor/.codex/skills/develop-web-game/scripts/node_modules/playwright/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'output', 'editor-mouse-selection-smoke');
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

const url = 'http://127.0.0.1:4187/index.html';
const sampleSql = 'SELECT story_stationen, AVG(score)\nFROM metrics;';

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.evaluate(() => window.scrollTo(0, 0));

const editorInfo = await page.evaluate((sql) => {
    const editor = window.sqlEditorInstance;
    editor.focus();
    editor.setValue(sql);
    editor.setCursor({ line: 0, ch: 0 });
    const lineEl = document.querySelector('.CodeMirror-line');
    const targetWord = 'story_stationen';
    let wordTarget = null;

    if (lineEl) {
        const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
        let textNode = walker.nextNode();
        while (textNode) {
            const rawText = String(textNode.nodeValue || '');
            const wordOffset = rawText.indexOf(targetWord);
            if (wordOffset >= 0) {
                const range = document.createRange();
                range.setStart(textNode, wordOffset);
                range.setEnd(textNode, wordOffset + targetWord.length);
                const rect = range.getBoundingClientRect();
                wordTarget = {
                    x: Math.round(rect.left + rect.width / 2),
                    y: Math.round(rect.top + rect.height / 2)
                };
                break;
            }
            textNode = walker.nextNode();
        }
    }

    return {
        line0: editor.getLine(0),
        wordTarget
    };
}, sampleSql);

await page.waitForTimeout(180);
if (!editorInfo.wordTarget) {
    throw new Error('Could not resolve word target for story_stationen.');
}
await page.mouse.click(editorInfo.wordTarget.x, editorInfo.wordTarget.y, { clickCount: 2, delay: 50 });
await page.waitForTimeout(180);
const doubleClickSelection = await page.evaluate(() => window.sqlEditorInstance.getSelection());

await page.locator('.CodeMirror-line').first().click({ clickCount: 3, position: { x: 18, y: 8 } });
await page.waitForTimeout(220);
const tripleClickSelection = await page.evaluate(() => window.sqlEditorInstance.getSelection());

await page.screenshot({ path: path.join(outputDir, 'shot-final.png'), fullPage: true });
await browser.close();

const blockingErrors = errors.filter((entry) => {
    const text = String(entry?.text || '');
    return !text.includes('status of 404 (File not found)');
});

const normalizedTripleSelection = String(tripleClickSelection || '').replace(/\n$/, '');
const result = {
    url,
    sampleSql,
    line0: editorInfo.line0,
    doubleClickSelection,
    tripleClickSelection,
    normalizedTripleSelection,
    errors,
    blockingErrors,
    pass: doubleClickSelection === 'story_stationen'
        && normalizedTripleSelection === editorInfo.line0
        && blockingErrors.length === 0
};

fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
