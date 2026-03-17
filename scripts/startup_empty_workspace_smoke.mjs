import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/thor/.codex/skills/develop-web-game/scripts/node_modules/playwright/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'output', 'startup-empty-workspace-smoke');
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

const url = 'http://127.0.0.1:4188/index.html';
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

const state = await page.evaluate(() => {
    const editor = window.sqlEditorInstance;
    const popup = document.getElementById('multi-intellisense-panel');
    const codeMirror = document.querySelector('.CodeMirror');
    const activeElement = document.activeElement;
    const tables = Array.from(document.querySelectorAll('#tables-container .table-card'));
    const activeInsideEditor = Boolean(codeMirror && activeElement && codeMirror.contains(activeElement));
    return {
        editorValue: String(editor?.getValue?.() || ''),
        editorHasFocus: Boolean(editor?.hasFocus?.()),
        editorFocusedClass: Boolean(codeMirror?.classList.contains('CodeMirror-focused')),
        activeInsideEditor,
        popupHiddenClass: Boolean(popup?.classList.contains('is-hidden')),
        popupDisplay: popup ? window.getComputedStyle(popup).display : '',
        popupAriaHidden: popup?.getAttribute('aria-hidden') || '',
        tableCardCount: tables.length,
        tableNames: tables.map((table) => table.id || table.dataset.tableName || ''),
        diagnosticsText: String(document.getElementById('diagnostics-lines')?.textContent || '').trim()
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
    state,
    errors,
    blockingErrors,
    pass: state.editorValue === ''
        && state.editorHasFocus === false
        && state.editorFocusedClass === false
        && state.activeInsideEditor === false
        && state.popupHiddenClass === true
        && state.popupDisplay === 'none'
        && state.tableCardCount === 0
        && blockingErrors.length === 0
};

fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
