import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const mainJsPath = path.join(projectRoot, 'assets', 'js', 'main.js');
const easyPath = path.join(projectRoot, 'app-data', 'folderTree_easy.json');
const mediumPath = path.join(projectRoot, 'app-data', 'folderTree_medium.json');
const hardPath = path.join(projectRoot, 'app-data', 'folderTree_hard.json');
const outputPath = path.join(projectRoot, 'output', 'tool-order-canonical-smoke.json');

const canonicalOrder = ['dql', 'dml', 'ddl', 'dcl', 'tcl'];
const codeOf = (label = '') => {
    const match = String(label || '').trim().match(/^([A-Za-z]+)/);
    return match ? match[1].toLowerCase() : '';
};

function readToolCodes(filePath) {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(payload?.tools)
        ? payload.tools.map((tool) => codeOf(tool?.label || ''))
        : [];
}

function isCanonicalSubset(codes = []) {
    const indices = codes.map((code) => canonicalOrder.indexOf(code));
    if (indices.some((index) => index < 0)) return false;
    for (let index = 1; index < indices.length; index += 1) {
        if (indices[index] < indices[index - 1]) return false;
    }
    return true;
}

const mainJs = fs.readFileSync(mainJsPath, 'utf8');
const easyCodes = readToolCodes(easyPath);
const mediumCodes = readToolCodes(mediumPath);
const hardCodes = readToolCodes(hardPath);

const result = {
    mainJsPath: path.relative(projectRoot, mainJsPath),
    easyPath: path.relative(projectRoot, easyPath),
    mediumPath: path.relative(projectRoot, mediumPath),
    hardPath: path.relative(projectRoot, hardPath),
    runtimeHasCanonicalOrder: mainJs.includes("const CANONICAL_TOOL_ORDER = ['dql', 'dml', 'ddl', 'dcl', 'tcl'];"),
    runtimeSortsParsedTools: mainJs.includes('const toolsFromTree = sortToolsByCanonicalOrder(parsedTools.map((tool, index) => {'),
    runtimeSortsFallbackTools: mainJs.includes('const fallbackTools = sortToolsByCanonicalOrder(LESSON_TREE_FALLBACK.toolLabels.map((label, index) => {'),
    easyCodes,
    mediumCodes,
    hardCodes,
    easyMatchesMedium: JSON.stringify(easyCodes) === JSON.stringify(mediumCodes),
    hardIsCanonicalSubset: isCanonicalSubset(hardCodes),
    pass: false
};

result.pass = result.runtimeHasCanonicalOrder
    && result.runtimeSortsParsedTools
    && result.runtimeSortsFallbackTools
    && result.easyMatchesMedium
    && JSON.stringify(mediumCodes) === JSON.stringify(canonicalOrder)
    && result.hardIsCanonicalSubset;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
