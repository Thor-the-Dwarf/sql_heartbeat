import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const indexHtmlPath = path.join(projectRoot, 'index.html');
const mainJsPath = path.join(projectRoot, 'assets', 'js', 'main.js');
const outputPath = path.join(projectRoot, 'output', 'guide-window-story-selection-smoke.json');

const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
const mainJs = fs.readFileSync(mainJsPath, 'utf8');

const result = {
    indexHtmlPath: path.relative(projectRoot, indexHtmlPath),
    mainJsPath: path.relative(projectRoot, mainJsPath),
    rightDrawerHiddenByDefault: indexHtml.includes('<aside id="right-drawer" class="drawer horizontal-drawer" hidden aria-hidden="true">'),
    hasGuideSelectionScope: mainJs.includes("let activeGuideSelectionScope = 'lesson';"),
    syncGuideWindowVisibilityHidesDrawer: mainJs.includes("rightDrawer.hidden = !isVisible;"),
    activateLessonHidesGuide: mainJs.includes("activeGuideSelectionScope = 'lesson';\n        activeToolId = tool.id;"),
    activateLessonRefreshesGuideVisibility: mainJs.includes("renderLessonTree(tutorialTreeModel);\n        updateGuideWindowStoryHint();"),
    activateStoryTitleShowsGuide: mainJs.includes("activeGuideSelectionScope = 'story';\n        activeStoryTitleId = storyTitle.id;"),
    guideHintEarlyReturnsOutsideStory: mainJs.includes("if (!isGuideWindowStorySelectionActive()) {\n            renderGuideWindowStoryStage(null, []);"),
    storyAutoAdvanceNeedsStorySelection: mainJs.includes("if (activeGuideSelectionScope !== 'story' || !activeStoryTitleConfig || !parseResult || parseResult.error) return;"),
    storyActiveHighlightNeedsStorySelection: mainJs.includes("const isActiveStory = activeGuideSelectionScope === 'story' && storyTitle.id === activeStoryTitleId;"),
    pass: false
};

result.pass = result.rightDrawerHiddenByDefault
    && result.hasGuideSelectionScope
    && result.syncGuideWindowVisibilityHidesDrawer
    && result.activateLessonHidesGuide
    && result.activateLessonRefreshesGuideVisibility
    && result.activateStoryTitleShowsGuide
    && result.guideHintEarlyReturnsOutsideStory
    && result.storyAutoAdvanceNeedsStorySelection
    && result.storyActiveHighlightNeedsStorySelection;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
