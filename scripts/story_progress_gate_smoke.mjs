import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import storyProgressLiveChecks from '../assets/js/story-progress-live-checks.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'output');
const outputPath = path.join(outputDir, 'story-progress-gate-smoke.json');

const mainJs = fs.readFileSync(path.join(projectRoot, 'assets/js/main.js'), 'utf8');
const styleCss = fs.readFileSync(path.join(projectRoot, 'assets/style.css'), 'utf8');
const indexHtml = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');

const scene = { id: 'scene-1', advanceOn: { type: 'statement-contains', tokens: ['SELECT'] } };
const runtimeEntry = { completed: false, readySceneIds: ['scene-1', 'scene-1', ''] };
const normalizedReadyIds = storyProgressLiveChecks.normalizeStoryReadySceneIds(runtimeEntry.readySceneIds);
const beforeReady = storyProgressLiveChecks.isStorySceneReady({ completed: false, readySceneIds: [] }, scene);
const marked = storyProgressLiveChecks.markStorySceneReady({ completed: false, readySceneIds: [] }, 'scene-1');
const afterReady = storyProgressLiveChecks.isStorySceneReady({ completed: false, readySceneIds: marked.readySceneIds }, scene);
const noAdvanceSceneReady = storyProgressLiveChecks.isStorySceneReady({ completed: false, readySceneIds: [] }, { id: 'scene-free', advanceOn: null });
const blockedAdvance = storyProgressLiveChecks.advanceStoryProgress({
    storyIds: ['story-1', 'story-2'],
    activeStoryId: 'story-1',
    sceneCount: 1,
    sceneIndex: 0,
    currentSceneReady: false,
    completedStory: false
});
const readyAdvance = storyProgressLiveChecks.advanceStoryProgress({
    storyIds: ['story-1', 'story-2'],
    activeStoryId: 'story-1',
    sceneCount: 1,
    sceneIndex: 0,
    currentSceneReady: true,
    completedStory: false
});

const result = {
    normalizedReadyIds,
    beforeReady,
    marked,
    afterReady,
    noAdvanceSceneReady,
    blockedAdvance,
    readyAdvance,
    hooks: {
        helperScriptIncluded: indexHtml.includes('<script src="assets/js/story-progress-live-checks.js"></script>'),
        liveEditorHook: mainJs.includes('scheduleLiveStoryReadinessEvaluation();'),
        immediateStorySelectionHook: mainJs.includes('scheduleLiveStoryReadinessEvaluation(0);'),
        guideButtonDisabledUntilReady: mainJs.includes('nextBtn.disabled = !activeSceneReady;'),
        guideButtonUsesReadyAdvance: mainJs.includes("nextBtn.addEventListener('click', () => advanceActiveStorySceneFromReadyState());"),
        storyTreeReadyClass: mainJs.includes("storyItem.classList.add('is-ready');"),
        simulationCheckDoesNotAutoAdvance: mainJs.includes('function handleStoryAdvanceCheckAfterSimulation(parseResult) {')
            && mainJs.includes("evaluateActiveStorySceneProgress(parseResult, { showBlockedNotice: true });")
    },
    styles: {
        storyReadyStyle: styleCss.includes('.story-title-item.is-ready'),
        guideButtonReadyStyle: styleCss.includes('.guide-story-nav-btn.is-ready'),
        guideGateReadyStyle: styleCss.includes('.guide-story-gate.is-ready')
    }
};

result.pass = normalizedReadyIds.length === 1
    && normalizedReadyIds[0] === 'scene-1'
    && beforeReady === false
    && marked.hasChanges === true
    && afterReady === true
    && noAdvanceSceneReady === true
    && blockedAdvance.allowed === false
    && readyAdvance.allowed === true
    && readyAdvance.completedStory === true
    && readyAdvance.nextStoryId === 'story-2'
    && Object.values(result.hooks).every(Boolean)
    && Object.values(result.styles).every(Boolean);

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ outputPath, pass: result.pass, hooks: result.hooks, styles: result.styles }, null, 2));
process.exit(result.pass ? 0 : 1);
