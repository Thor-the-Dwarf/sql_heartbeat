import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/thor/.codex/skills/develop-web-game/scripts/node_modules/playwright/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'output', 'story-tree-modes-smoke');
const outputPath = path.join(outputDir, 'result.json');

fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader']
});

const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
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

async function ensureStoryRootOpen() {
  const root = page.locator('.lesson-story-root-folder').first();
  const isOpen = await root.evaluate((node) => node.hasAttribute('open'));
  if (!isOpen) {
    await root.locator('> summary').click();
    await page.waitForTimeout(180);
  }
}

async function openStoryFolders() {
  const folders = page.locator('.lesson-story-root-folder .lesson-tool-list > .lesson-tool-folder');
  const count = await folders.count();
  for (let index = 0; index < count; index += 1) {
    const folder = folders.nth(index);
    const isOpen = await folder.evaluate((node) => node.hasAttribute('open'));
    if (!isOpen) {
      await folder.locator('> summary').click();
      await page.waitForTimeout(120);
    }
  }
}

async function collectModeState(mode) {
  await page.click(`.nav-mode-btn[data-lesson-mode="${mode}"]`);
  await page.waitForTimeout(650);
  await ensureStoryRootOpen();
  await openStoryFolders();
  await page.waitForTimeout(200);

  const modeState = await page.evaluate(() => {
    const root = document.querySelector('.lesson-story-root-folder');
    const folderNodes = Array.from(root?.querySelectorAll(':scope .lesson-tool-list > .lesson-tool-folder') || []);
    const folders = folderNodes.map((folder) => {
      const label = folder.querySelector(':scope > summary .lesson-node-title')?.textContent?.trim() || '';
      const storyTitles = Array.from(folder.querySelectorAll('.story-title-item .story-title-name'))
        .map((node) => node.textContent.trim())
        .filter(Boolean);
      const emptyTexts = Array.from(folder.querySelectorAll('.lesson-item-empty'))
        .map((node) => node.textContent.trim())
        .filter(Boolean);
      return {
        label,
        storyCount: storyTitles.length,
        storyTitles,
        emptyTexts
      };
    });
    const placeholderTexts = folders.flatMap((folder) => folder.emptyTexts)
      .filter((text) => /Story-Ordner vorbereitet\. Inhalte folgen\./i.test(text));
    return {
      folders,
      placeholderTexts
    };
  });

  await page.screenshot({ path: path.join(outputDir, `${mode}.png`), fullPage: true });
  return modeState;
}

const modes = ['easy', 'medium', 'hard'];
const modeResults = {};
for (const mode of modes) {
  modeResults[mode] = await collectModeState(mode);
}

await browser.close();

const blockingErrors = errors.filter((entry) => !String(entry.text || '').includes('status of 404 (File not found)'));
const pass = modes.every((mode) => {
  const result = modeResults[mode];
  return Array.isArray(result?.folders)
    && result.folders.length === 3
    && result.folders.every((folder) => folder.storyCount > 0)
    && result.placeholderTexts.length === 0;
}) && blockingErrors.length === 0;

const result = {
  url,
  modeResults,
  errors,
  blockingErrors,
  pass
};

fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(pass ? 0 : 1);
