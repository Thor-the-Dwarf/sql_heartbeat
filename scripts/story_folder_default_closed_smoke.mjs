import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const mainJsPath = path.join(projectRoot, 'assets', 'js', 'main.js');
const outputPath = path.join(projectRoot, 'output', 'story-folder-default-closed-smoke.json');
const mainJs = fs.readFileSync(mainJsPath, 'utf8');

const hasExactClosedDefault = mainJs.includes("storyFolderDetails.open = lessonFolderOpenState.has(storyFolderStateKey);");
const stillAutoOpensActiveStory = mainJs.includes('|| containsActiveStory')
    || mainJs.includes('storyFolder.titles.some((storyTitle) => storyTitle.id === activeStoryTitleId)');

const result = {
    mainJsPath: path.relative(projectRoot, mainJsPath),
    hasExactClosedDefault,
    stillAutoOpensActiveStory,
    pass: hasExactClosedDefault && !stillAutoOpensActiveStory
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
