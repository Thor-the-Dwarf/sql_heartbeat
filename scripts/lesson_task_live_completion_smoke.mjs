import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const lessonTaskLiveChecks = require(path.join(projectRoot, 'assets', 'js', 'lesson-task-live-checks.js'));

const files = [
    path.join(projectRoot, 'app-data', 'folderTree_easy.json'),
    path.join(projectRoot, 'app-data', 'folderTree_medium.json'),
    path.join(projectRoot, 'app-data', 'folderTree_hard.json')
];
const outputPath = path.join(projectRoot, 'output', 'lesson-task-live-completion-smoke.json');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function flattenTasks(tree) {
    const tasks = [];
    (tree.tools || []).forEach((tool) => {
        const walk = (node) => {
            (node.tasks || []).forEach((task) => {
                tasks.push({
                    file: path.basename(tree.__filePath || ''),
                    tool: tool.label,
                    lesson: node.title,
                    body: String(node.body || ''),
                    text: String(task.text || ''),
                    explicitCheck: task.check || null
                });
            });
            (node.children || []).forEach(walk);
        };
        (tool.lessonRoots || []).forEach(walk);
    });
    return tasks;
}

function matchCheckAgainstSql(check, sql) {
    if (!check || typeof check !== 'object') return false;
    const statement = String(sql || '');
    if (check.type === 'statement-regex') {
        const regex = new RegExp(String(check.pattern || ''), String(check.flags || 'i'));
        return regex.test(statement);
    }
    if (check.type === 'statement-contains') {
        const lowered = statement.toLowerCase();
        return (Array.isArray(check.tokens) ? check.tokens : [])
            .map((token) => String(token || '').trim().toLowerCase())
            .filter(Boolean)
            .every((token) => lowered.includes(token));
    }
    return false;
}

function findTask(tasks, lesson, textFragment) {
    return tasks.find((task) => task.lesson === lesson && task.text.includes(textFragment));
}

const allTasks = files.flatMap((filePath) => {
    const payload = readJson(filePath);
    payload.__filePath = filePath;
    return flattenTasks(payload);
});

const tasksWithChecks = allTasks.map((task) => ({
    ...task,
    effectiveCheck: task.explicitCheck || lessonTaskLiveChecks.deriveTaskCheck(task.text, {
        lessonTitle: task.lesson,
        lessonBody: task.body
    })
}));

const withoutCheck = tasksWithChecks.filter((task) => !task.effectiveCheck);

const representativeCases = [
    {
        name: 'easy-create-users',
        task: findTask(tasksWithChecks, 'Erste Tabelle anlegen: users mit id INTEGER und name TEXT', 'Lege die Tabelle `users` exakt'),
        sql: 'CREATE TABLE users (id INTEGER, name TEXT);'
    },
    {
        name: 'medium-where-equals',
        task: findTask(tasksWithChecks, 'Filtern: SELECT ... FROM ... WHERE ...', 'WHERE id = 2'),
        sql: 'SELECT * FROM users WHERE id = 2;'
    },
    {
        name: 'easy-grant-select',
        task: findTask(tasksWithChecks, 'Rechte vergeben (GRANT ...)', 'Leserecht auf `users` gibt'),
        sql: 'GRANT SELECT ON users TO trainee_role;'
    },
    {
        name: 'easy-begin',
        task: findTask(tasksWithChecks, 'Commit-Szenario', 'Starte eine Transaktion'),
        sql: 'BEGIN;'
    },
    {
        name: 'medium-types-demo',
        task: findTask(tasksWithChecks, 'Datentypen: VARCHAR / CHAR / BIGINT / DECIMAL / NUMERIC / DATE / TIMESTAMP', 'types_demo'),
        sql: 'CREATE TABLE types_demo (big BIGINT, code CHAR(2), email VARCHAR(100), price DECIMAL(10,2), amount NUMERIC(10,2), created DATE, created_at TIMESTAMP);'
    },
    {
        name: 'hard-create-view',
        task: findTask(tasksWithChecks, 'VIEW', 'CREATE VIEW v_users'),
        sql: 'CREATE VIEW v_users AS SELECT id, name FROM users;'
    }
];

const representativeResults = representativeCases.map((entry) => ({
    name: entry.name,
    taskFound: Boolean(entry.task),
    matched: entry.task ? matchCheckAgainstSql(entry.task.effectiveCheck, entry.sql) : false
}));

const result = {
    totalTasks: allTasks.length,
    derivedCoverage: {
        total: tasksWithChecks.length,
        withoutCheck: withoutCheck.length
    },
    unresolvedTasks: withoutCheck.map((task) => ({
        file: task.file,
        tool: task.tool,
        lesson: task.lesson,
        text: task.text
    })),
    representativeResults,
    pass: withoutCheck.length === 0 && representativeResults.every((entry) => entry.taskFound && entry.matched)
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
