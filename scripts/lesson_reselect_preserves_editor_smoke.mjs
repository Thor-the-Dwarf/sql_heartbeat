import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const mainJsPath = path.join(projectRoot, 'assets', 'js', 'main.js');
const outputPath = path.join(projectRoot, 'output', 'lesson-reselect-preserves-editor-smoke.json');
const mainJs = fs.readFileSync(mainJsPath, 'utf8');

const activateLessonMatch = mainJs.match(/function activateLesson\(toolId, lessonId\) \{[\s\S]*?\n    \}/u);
const activateLessonSource = activateLessonMatch ? activateLessonMatch[0] : '';
const guardLine = 'if (tool.id === activeToolId && lesson.id === activeLessonId && activeLessonConfig === lesson) return;';
const guardIndex = activateLessonSource.indexOf(guardLine);
const renderIndex = activateLessonSource.indexOf('renderLessonTree(tutorialTreeModel);');
const snapshotIndex = activateLessonSource.indexOf('applySimulationDataSnapshot(snapshot, { setAsBaseline: true, clearUi: true });');

const result = {
    mainJsPath: path.relative(projectRoot, mainJsPath),
    activateLessonFound: Boolean(activateLessonSource),
    hasSameLessonGuard: guardIndex >= 0,
    guardRunsBeforeRender: guardIndex >= 0 && renderIndex >= 0 && guardIndex < renderIndex,
    guardRunsBeforeSnapshotReset: guardIndex >= 0 && snapshotIndex >= 0 && guardIndex < snapshotIndex,
    pass: false
};

result.pass = result.activateLessonFound
    && result.hasSameLessonGuard
    && result.guardRunsBeforeRender
    && result.guardRunsBeforeSnapshotReset;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
