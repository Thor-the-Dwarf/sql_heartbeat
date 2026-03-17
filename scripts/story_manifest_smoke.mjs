import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const appManifestPath = path.join(projectRoot, 'app-data', 'stories.index.json');
const sourceManifestPath = path.join(projectRoot, 'Storys', 'stories.index.json');
const mainJsPath = path.join(projectRoot, 'assets', 'js', 'main.js');
const gitignorePath = path.join(projectRoot, '.gitignore');
const outputPath = path.join(projectRoot, 'output', 'story-manifest-smoke.json');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeManifest(value) {
    return JSON.stringify(value, null, 2);
}

function collectManifestEntries(manifest) {
    const entries = [];
    if (Array.isArray(manifest?.stories)) {
        entries.push(...manifest.stories);
    }
    if (manifest?.storiesByMode && typeof manifest.storiesByMode === 'object') {
        Object.values(manifest.storiesByMode).forEach((modeEntries) => {
            if (Array.isArray(modeEntries)) {
                entries.push(...modeEntries);
            }
        });
    }
    return entries.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
}

function getExpectedEasyLabels(manifest) {
    return Array.isArray(manifest?.storiesByMode?.easy)
        ? manifest.storiesByMode.easy.map((entry) => String(entry?.label || '').trim()).filter(Boolean)
        : [];
}

function fileExists(relativePath) {
    return fs.existsSync(path.join(projectRoot, relativePath));
}

function gitCheckIgnore(relativePath) {
    try {
        execFileSync('git', ['check-ignore', '-q', relativePath], { cwd: projectRoot, stdio: 'ignore' });
        return true;
    } catch (error) {
        if (typeof error?.status === 'number') return false;
        throw error;
    }
}

const appManifest = readJson(appManifestPath);
const sourceManifest = readJson(sourceManifestPath);
const mainJs = fs.readFileSync(mainJsPath, 'utf8');
const gitignore = fs.readFileSync(gitignorePath, 'utf8');
const manifestEntries = collectManifestEntries(appManifest);
const missingRequiredPaths = manifestEntries
    .filter((entry) => !entry.optional)
    .map((entry) => String(entry.path || '').trim())
    .filter(Boolean)
    .filter((entryPath) => !fileExists(entryPath));

const expectedEasyLabels = getExpectedEasyLabels(appManifest);
const result = {
    appManifestPath: path.relative(projectRoot, appManifestPath),
    sourceManifestPath: path.relative(projectRoot, sourceManifestPath),
    mainJsUsesPublicManifest: mainJs.includes("const STORY_SOURCE_INDEX_PATH = 'app-data/stories.index.json';"),
    mainJsAvoidsLegacyAppStoriesFallback: !mainJs.includes("'app-data/stories.json'"),
    manifestsMatch: normalizeManifest(appManifest) === normalizeManifest(sourceManifest),
    storysIgnoredByGit: gitCheckIgnore('Storys/stories.index.json'),
    gitignoreContainsStorysRule: /^\/Storys\/$/m.test(gitignore),
    expectedEasyLabels,
    missingRequiredPaths,
    pass: false
};

result.pass = result.mainJsUsesPublicManifest
    && result.mainJsAvoidsLegacyAppStoriesFallback
    && result.manifestsMatch
    && result.storysIgnoredByGit === false
    && result.gitignoreContainsStorysRule === false
    && expectedEasyLabels.includes('Flucht aus der Zitadelle')
    && expectedEasyLabels.includes('Das Geheimnis des Markthofs')
    && expectedEasyLabels.includes('Die Händler von Rabensand')
    && missingRequiredPaths.length === 0;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
