document.addEventListener('DOMContentLoaded', () => {
    const rootStyle = getComputedStyle(document.documentElement);
    if (!rootStyle.getPropertyValue('--bg').trim()) {
        document.documentElement.classList.add('theme-fallback-dark');
    }

    function installEditorPointerSelectionBehavior(editorInstance) {
        if (!editorInstance?.getWrapperElement) return;
        const wrapper = editorInstance.getWrapperElement();

        function getPointerEditorPos(event) {
            return editorInstance.coordsChar({ left: event.clientX, top: event.clientY }, 'window');
        }

        function selectWordAtPointer(event) {
            const pointerPos = getPointerEditorPos(event);
            const range = editorInstance.findWordAt(pointerPos);
            editorInstance.focus();
            editorInstance.setSelection(range.anchor, range.head);
        }

        function selectLineAtPointer(event) {
            const pointerPos = getPointerEditorPos(event);
            const lineNumber = Math.max(0, Number(pointerPos?.line) || 0);
            const lineText = String(editorInstance.getLine(lineNumber) || '');
            editorInstance.focus();
            editorInstance.setSelection(
                CodeMirror.Pos(lineNumber, 0),
                CodeMirror.Pos(lineNumber, lineText.length)
            );
        }

        wrapper.addEventListener('dblclick', (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            window.requestAnimationFrame(() => selectWordAtPointer(event));
        });

        wrapper.addEventListener('mousedown', (event) => {
            if (event.button !== 0 || event.detail < 3) return;
            event.preventDefault();
            window.requestAnimationFrame(() => selectLineAtPointer(event));
        });
    }

    // Initialize CodeMirror
    const editor = CodeMirror.fromTextArea(document.getElementById('sql-editor'), {
        mode: 'text/x-sql',
        theme: 'dracula',
        lineNumbers: true,
        indentWithTabs: false,
        smartIndent: true,
        lineWrapping: false,
        matchBrackets: true,
        autofocus: false,
        extraKeys: { "Ctrl-Space": "autocomplete" }
    });

    installEditorPointerSelectionBehavior(editor);
    window.sqlEditorInstance = editor;

    // --- Simulator & Parser Integration ---
    const simulator = window.simulator;
    const parser = new SQLParser();
    parser.simulationData.VIEWS = parser.simulationData.VIEWS || {};
    parser.simulationData.INDEXES = parser.simulationData.INDEXES || {};
    parser.simulationData.SCHEMAS = parser.simulationData.SCHEMAS || {};
    parser.simulationData.SEQUENCES = parser.simulationData.SEQUENCES || {};
    const chatContainer = document.getElementById('chat-container');
    const lessonTreeContainer = document.getElementById('lesson-tree');
    const navTreeSubtitleEl = document.querySelector('.nav-tree-subtitle');
    const lessonModeButtons = Array.from(document.querySelectorAll('[data-lesson-mode]'));
    const tablesContainer = document.getElementById('tables-container');
    const diagnosticsPane = document.getElementById('diagnostics-pane');
    const diagnosticsLines = document.getElementById('diagnostics-lines');
    const diagnosticsHeader = document.querySelector('.diagnostics-header');
    const queryStagePane = document.getElementById('query-stage-pane');
    const processResultPanel = document.getElementById('process-result-panel');
    const processResultBody = document.getElementById('process-result-body');
    const processResultStepLabel = document.getElementById('process-result-step');
    const rightDrawer = document.getElementById('right-drawer');
    const multiIntellisensePanel = document.getElementById('multi-intellisense-panel');
    const multiIntellisenseList = document.getElementById('multi-intellisense-list');
    const multiIntellisenseDebugEl = document.getElementById('multi-intellisense-debug');
    const centerContent = document.getElementById('center-content');
    const schemaStage = document.getElementById('schema-stage');
    const guideStoryStageEl = document.getElementById('guide-story-stage');
    const guideWindowNoteEl = document.querySelector('.guide-window-note');
    const btnResetStoryProgress = document.getElementById('btn-reset-story-progress');
    const defaultGuideWindowNoteText = guideWindowNoteEl ? String(guideWindowNoteEl.textContent || '').trim() : '';
    const topCanvas = document.getElementById('top-canvas');
    const ctx = topCanvas.getContext('2d');
    const storyProgressLiveChecks = window.storyProgressLiveChecks || {
        normalizeStoryReadySceneIds: () => [],
        isStorySceneReady: (runtimeEntry, scene) => Boolean(runtimeEntry?.completed) || !scene?.advanceOn,
        markStorySceneReady: (runtimeEntry) => ({
            readySceneIds: Array.isArray(runtimeEntry?.readySceneIds) ? runtimeEntry.readySceneIds : [],
            hasChanges: false,
            isReady: true
        }),
        advanceStoryProgress: (options = {}) => ({
            allowed: Boolean(options.currentSceneReady),
            completedStory: Boolean(options.currentSceneReady),
            nextStoryId: String(options.activeStoryId || ''),
            nextSceneIndex: 0,
            openedNextStory: false,
            reachedStoryEnd: true
        })
    };
    const lessonTaskLiveChecks = window.lessonTaskLiveChecks || { deriveTaskCheck: () => null };

    // Toggle state for relationship lines (must be declared before drawRelationships is called)
    let showRelationships = true;
    let stepPreviewMap = new Map();
    const DCL_STEP_TYPES = new Set(['GRANT', 'REVOKE']);
    const TCL_STEP_TYPES = new Set(['BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT']);
    const SUPPORTED_TASK_CHECK_TYPES = new Set([
        'table-columns',
        'table-exists',
        'table-missing',
        'column-absent',
        'column-renamed',
        'column-constraint',
        'column-fk-target',
        'schema-constraint',
        'row-count',
        'row-exists',
        'row-missing',
        'statement-contains',
        'statement-regex',
        'result-row-count',
        'result-columns',
        'result-equals'
    ]);
    const SUPPORTED_DATABASE_PROFILES = new Set([
        'empty',
        'demo',
        'demo-analytics',
        'demo-null-users',
        'demo-students',
        'employees-basic',
        'employees-with-role',
        'customers',
        'demo-reports',
        'products-empty',
        'students-empty'
    ]);
    let processRuntimeState = createProcessRuntimeState();
    let processLogEntries = [];
    let activeErrorDiagnostics = [];
    let intellisensePositionRafId = 0;
    let intellisenseInsertAnchor = null;
    let intellisenseMouseDownInsertAt = 0;
    let sqlCoreCatalogStatus = 'idle';
    let sqlCoreCatalogMeta = {
        dialect: 'SQL Core',
        version: '',
        storageKey: 'sqlcore.progress.v1',
        storageSchema: 1
    };
    let sqlCoreItemsById = new Map();
    let sqlCoreStatesById = new Map();
    let sqlCoreTransitionsByFrom = new Map();
    let sqlCoreTokenToItemIds = new Map();
    let sqlCoreProgressSnapshot = {
        schema: 1,
        unlockedIds: new Set(),
        completedTaskIds: new Set()
    };
    const SQL_CORE_SUGGESTION_GROUPS = [
        { id: 'DQL', label: 'DQL' },
        { id: 'DML', label: 'DML' },
        { id: 'DDL', label: 'DDL' },
        { id: 'DCL', label: 'DCL' },
        { id: 'TCL', label: 'TCL' },
        { id: 'SHARED', label: 'Shared' }
    ];
    const editorSqlFunctionTokens = new Set([
        'SUM',
        'COUNT',
        'AVG',
        'MIN',
        'MAX',
        'LOWER',
        'UPPER',
        'COALESCE'
    ]);

    bindEditorSqlFunctionOverlay();

    // Controls
    const btnPlay = document.getElementById('btn-play');
    const btnFF = document.getElementById('btn-ff');
    const btnToggleIntellisense = document.getElementById('btn-toggle-intellisense');
    const dialectSelect = document.getElementById('sql-dialect-select');
    const exampleSelect = document.getElementById('sql-example-select');
    const btnLoadExample = document.getElementById('btn-load-example');
    const btnResetDemo = document.getElementById('btn-reset-demo');
    const CREATE_STEP_KINDS = new Set([
        'CREATE_START',
        'PARSE',
        'CHECK',
        'LOCKS',
        'CATALOG_TABLE',
        'CATALOG_COLUMNS',
        'STORAGE',
        'COMMIT',
        'RESULT'
    ]);
    const CREATE_VISIBLE_COLUMN_PHASES = new Set(['CATALOG_COLUMNS', 'STORAGE', 'COMMIT', 'RESULT']);
    const CREATE_PHASE_META = {
        CREATE_START: {
            phase: 'create-start',
            badge: 'DDL start',
            draft: true,
            placeholder: 'DDL-Ausführung gestartet'
        },
        PARSE: {
            phase: 'parse',
            badge: 'Parse',
            draft: true,
            placeholder: 'SQL wird in Tokens und AST zerlegt'
        },
        CHECK: {
            phase: 'check',
            badge: 'Prüfen',
            draft: true,
            placeholder: 'Prüfe Berechtigungen, Namenskonflikte und Datentypen'
        },
        LOCKS: {
            phase: 'locks',
            badge: 'DDL Lock',
            draft: true,
            placeholder: 'Schema-Lock gesetzt'
        },
        CATALOG_TABLE: {
            phase: 'catalog-table',
            badge: 'Katalog: Tabelle',
            draft: true,
            placeholder: 'Tabellen-Metadaten werden registriert'
        },
        CATALOG_COLUMNS: {
            phase: 'catalog-columns',
            badge: 'Katalog: Spalten',
            draft: true,
            placeholder: 'Spalten-Metadaten werden geschrieben'
        },
        STORAGE: {
            phase: 'storage',
            badge: 'Storage',
            draft: true,
            placeholder: 'Storage-Segment wird initialisiert'
        },
        COMMIT: {
            phase: 'commit',
            badge: 'Commit',
            draft: true,
            placeholder: 'Transaktion wird abgeschlossen'
        },
        RESULT: {
            phase: 'result',
            badge: 'Erstellt',
            draft: false,
            placeholder: ''
        }
    };
    const BASIC_SQL_EXAMPLES = [
        {
            id: 'select-where',
            label: 'SELECT · WHERE',
            sql: "SELECT id, name\nFROM users\nWHERE role = 'User'\nORDER BY id;"
        },
        {
            id: 'join-basic',
            label: 'SELECT · JOIN',
            sql: "SELECT u.name, l.message\nFROM users u\nJOIN logs l ON l.user_id = u.id\nORDER BY u.id;"
        },
        {
            id: 'insert-basic',
            label: 'INSERT',
            sql: "INSERT INTO users (id, name, role)\nVALUES (4, 'Diana', 'User');"
        },
        {
            id: 'update-basic',
            label: 'UPDATE',
            sql: "UPDATE users\nSET role = 'Admin'\nWHERE id = 2;"
        },
        {
            id: 'delete-basic',
            label: 'DELETE',
            sql: "DELETE FROM logs\nWHERE user_id = 1;"
        },
        {
            id: 'ddl-basic',
            label: 'CREATE TABLE',
            sql: "CREATE TABLE classes (\n  class_id INTEGER PRIMARY KEY,\n  title TEXT NOT NULL\n);"
        },
        {
            id: 'error-demo',
            label: 'Fehlerdemo',
            sql: "SELECT id\nFROM missing_table;"
        }
    ];
    const LESSON_TREE_FALLBACK = {
        rootLabel: 'Werkzeuge',
        toolLabels: [
            'DQL Data Query Language',
            'DML Data Manipulation Language',
            'DDL Data Definition Language',
            'DCL Data Control Language',
            'TCL Transaction Control Language'
        ]
    };
    const STORY_TREE_FALLBACK = {
        rootLabel: 'Storys',
        titles: [
            {
                id: 'story-start-neonhafen',
                title: 'Kapitel 1: Ankunft im Neonhafen',
                stepLabel: '1 / 3',
                status: 'aktiv',
                guideScenes: [
                    { speaker: 'Guide', text: 'Willkommen im Neonhafen. Hier lernst du SQL Schritt fuer Schritt.' }
                ]
            }
        ]
    };
    const LESSON_MODE_STORAGE_KEY = 'sql-heartbeat.foldertree.mode.v2';
    const STORY_SOURCE_INDEX_PATH = 'app-data/stories.index.json';
    const STORY_SOURCE_FALLBACKS_BY_MODE = {
        easy: [
            {
                path: 'Storys/Flucht aus der Zitadelle/stories.json',
                label: 'Flucht aus der Zitadelle'
            },
            {
                path: 'Storys/Das Geheimnis des Markthofs/stories.json',
                label: 'Das Geheimnis des Markthofs'
            },
            {
                path: 'Storys/Die Händler von Rabensand/stories.json',
                label: 'Die Händler von Rabensand'
            }
        ],
        medium: [
            {
                path: 'Storys/Das Gold der Kupfermine/stories.json',
                label: 'Das Gold der Kupfermine'
            },
            {
                path: 'Storys/Das Siegel der Kronfeste/stories.json',
                label: 'Das Siegel der Kronfeste'
            },
            {
                path: 'Storys/Die Spur des Schmugglers/stories.json',
                label: 'Die Spur des Schmugglers'
            }
        ],
        hard: [
            {
                path: 'Storys/Sturm auf den Wachturm/stories.json',
                label: 'Sturm auf den Wachturm'
            },
            {
                path: 'Storys/Die Tore von Steinbruch/stories.json',
                label: 'Die Tore von Steinbruch'
            },
            {
                path: 'Storys/Der letzte Kurier von Dornwall/stories.json',
                label: 'Der letzte Kurier von Dornwall'
            }
        ]
    };
    const DEFAULT_ACTIVE_STORY_PATH_BY_MODE = {
        easy: 'Storys/Flucht aus der Zitadelle/stories.json',
        medium: 'Storys/Das Gold der Kupfermine/stories.json',
        hard: 'Storys/Sturm auf den Wachturm/stories.json'
    };
    const DEFAULT_ACTIVE_STORY_PATH = DEFAULT_ACTIVE_STORY_PATH_BY_MODE.easy;
    const STORY_SHOW_ALL_FOR_TEST = true;
    const LESSON_MODE_CONFIG = {
        easy: {
            id: 'easy',
            treePath: 'app-data/folderTree_easy.json',
            storyEnabled: true
        },
        medium: {
            id: 'medium',
            treePath: 'app-data/folderTree_medium.json',
            storyEnabled: true
        },
        hard: {
            id: 'hard',
            treePath: 'app-data/folderTree_hard.json',
            storyEnabled: true
        }
    };
    const initialSimulationDataSnapshot = deepClone(parser.simulationData);
    let activeSimulationDataBaseline = deepClone(initialSimulationDataSnapshot);
    let activeLessonMode = loadStoredLessonMode();
    let tutorialTreeModel = { rootLabel: LESSON_TREE_FALLBACK.rootLabel, tools: [] };
    let storyTreeModel = { rootLabel: STORY_TREE_FALLBACK.rootLabel, titles: [] };
    let storyFolderBlueprint = [];
    let activeToolId = '';
    let activeLessonId = '';
    let activeLessonConfig = null;
    let activeStoryTitleId = '';
    let activeStoryTitleConfig = null;
    let activeGuideSelectionScope = 'lesson';
    let hasExplicitStorySelection = false;
    let activeStorySceneIndex = 0;
    let storyAutoAdvanceNoticeText = '';
    let storyAutoAdvanceNoticeTimer = null;
    let pendingStoryAdvanceParseResult = null;
    let pendingLessonTaskParseResult = null;
    let liveLessonTaskEvaluationTimer = null;
    let liveStoryReadinessEvaluationTimer = null;
    const lessonTaskProgress = new Map();
    const lessonTaskAnimationQueue = new Set();
    const lessonFolderOpenState = new Set();
    const storyRuntimeState = new Map();
    const STORY_PROGRESS_STORAGE_KEY = 'sql-heartbeat.story-progress.v1';
    const INTELLISENSE_ENABLED_STORAGE_KEY = 'sql-heartbeat.intellisense.enabled.v1';
    const INTELLISENSE_PANEL_MIN_WIDTH = 186;
    const INTELLISENSE_PANEL_COLUMN_WIDTH = 168;
    const INTELLISENSE_PANEL_COLUMN_GAP = 8;
    const INTELLISENSE_PANEL_HORIZONTAL_PADDING = 18;
    let isIntellisenseEnabled = true;

    function sanitizeClassName(value) {
        return String(value || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    }

    function stripTokenIdFromTitle(value = '') {
        return String(value || '')
            .replace(/\s*\(Token-ID:\s*[^)]+\)/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    function resolveLessonMode(mode = '') {
        const normalized = String(mode || '').trim().toLowerCase();
        return LESSON_MODE_CONFIG[normalized] ? normalized : 'easy';
    }

    function getLessonModeConfig(mode = activeLessonMode) {
        return LESSON_MODE_CONFIG[resolveLessonMode(mode)];
    }

    function loadStoredLessonMode() {
        if (typeof window === 'undefined' || !window.localStorage) return 'easy';
        try {
            const storedValue = window.localStorage.getItem(LESSON_MODE_STORAGE_KEY);
            return resolveLessonMode(storedValue || 'easy');
        } catch (error) {
            return 'easy';
        }
    }

    function persistLessonMode(mode = activeLessonMode) {
        if (typeof window === 'undefined' || !window.localStorage) return;
        try {
            window.localStorage.setItem(LESSON_MODE_STORAGE_KEY, resolveLessonMode(mode));
        } catch (error) {
            // Ignore storage write errors in restricted contexts.
        }
    }

    function syncLessonModeUi(mode = activeLessonMode) {
        const resolvedMode = resolveLessonMode(mode);

        lessonModeButtons.forEach((button) => {
            const buttonMode = resolveLessonMode(button.dataset.lessonMode || '');
            const isActive = buttonMode === resolvedMode;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });

        if (navTreeSubtitleEl) {
            navTreeSubtitleEl.textContent = `Modus: ${resolvedMode}`;
        }
    }

    function bindLessonModeButtons() {
        if (lessonModeButtons.length === 0) return;

        lessonModeButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const requestedMode = resolveLessonMode(button.dataset.lessonMode || '');
                if (requestedMode === activeLessonMode) return;
                lessonFolderOpenState.clear();
                initLessonTree(requestedMode).catch((error) => {
                    console.warn('[LessonTree] Mode-Wechsel fehlgeschlagen.', error);
                });
            });
        });
    }

    function createProcessRuntimeState() {
        return {
            transaction: {
                active: false,
                savepoints: [],
                lastAction: '-'
            },
            grants: new Map(),
            lastGuideCategory: ''
        };
    }

    function resetProcessRuntimeState() {
        processRuntimeState = createProcessRuntimeState();
    }

    function makeLessonKey(toolId, lessonId) {
        return `${String(toolId || '').trim()}::${String(lessonId || '').trim()}`;
    }

    function normalizeLessonTitle(value = '') {
        return String(value || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim();
    }

    function normalizeLessonPathKey(pathParts = []) {
        const parts = Array.isArray(pathParts) ? pathParts : [];
        return parts
            .map((entry) => normalizeLessonTitle(entry))
            .filter(Boolean)
            .join(' > ');
    }

    function sanitizeGuideSceneText(value = '') {
        return String(value || '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/\r\n?/g, '\n')
            .trim();
    }

    function normalizeGuideDialogueTurns(scene = null) {
        const sceneId = String(scene?.id || 'scene').trim() || 'scene';
        const explicitTurns = Array.isArray(scene?.dialogueTurns) ? scene.dialogueTurns : [];
        const normalizedTurns = explicitTurns
            .map((turn, turnIndex) => {
                const speaker = String(turn?.speaker || '').trim();
                const text = sanitizeGuideSceneText(turn?.text || '');
                if (!speaker || !text) return null;
                return {
                    id: String(turn?.id || `${sceneId}-turn-${turnIndex + 1}`),
                    speaker,
                    text
                };
            })
            .filter(Boolean);

        if (normalizedTurns.length > 0) return normalizedTurns;

        const fallbackText = sanitizeGuideSceneText(scene?.text || '');
        if (!fallbackText) return [];
        return [
            {
                id: `${sceneId}-turn-1`,
                speaker: String(scene?.speaker || 'Guide').trim() || 'Guide',
                text: fallbackText
            }
        ];
    }

    function normalizeSimulationDataShape(snapshot) {
        const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
        return {
            TABLES: source.TABLES && typeof source.TABLES === 'object' ? source.TABLES : {},
            VIEWS: source.VIEWS && typeof source.VIEWS === 'object' ? source.VIEWS : {},
            INDEXES: source.INDEXES && typeof source.INDEXES === 'object' ? source.INDEXES : {},
            SCHEMAS: source.SCHEMAS && typeof source.SCHEMAS === 'object' ? source.SCHEMAS : {},
            SEQUENCES: source.SEQUENCES && typeof source.SEQUENCES === 'object' ? source.SEQUENCES : {}
        };
    }

    function createEmptySimulationData() {
        return {
            TABLES: {},
            VIEWS: {},
            INDEXES: {},
            SCHEMAS: {},
            SEQUENCES: {}
        };
    }

    function extractToolCode(label = '') {
        const match = String(label || '').trim().match(/^([A-Za-z]+)/);
        return match ? match[1].toLowerCase() : '';
    }

    const CANONICAL_TOOL_ORDER = ['dql', 'dml', 'ddl', 'dcl', 'tcl'];

    function sortToolsByCanonicalOrder(tools = []) {
        const orderMap = new Map(CANONICAL_TOOL_ORDER.map((code, index) => [code, index]));
        return (Array.isArray(tools) ? tools : [])
            .map((tool, index) => ({ tool, index }))
            .sort((left, right) => {
                const leftRank = orderMap.has(left.tool?.code) ? orderMap.get(left.tool.code) : Number.MAX_SAFE_INTEGER;
                const rightRank = orderMap.has(right.tool?.code) ? orderMap.get(right.tool.code) : Number.MAX_SAFE_INTEGER;
                if (leftRank !== rightRank) return leftRank - rightRank;
                return left.index - right.index;
            })
            .map((entry) => entry.tool);
    }

    function buildToolDatabasePreset(toolCode) {
        if (toolCode === 'ddl' || toolCode === 'dcl' || toolCode === 'tcl') {
            return createEmptySimulationData();
        }
        return deepClone(initialSimulationDataSnapshot);
    }

    function buildSnapshotFromTables(tables = {}, options = {}) {
        const { includeDemo = false } = options;
        const base = includeDemo
            ? normalizeSimulationDataShape(deepClone(initialSimulationDataSnapshot))
            : createEmptySimulationData();

        base.TABLES = base.TABLES || {};
        Object.entries(tables).forEach(([tableName, tableDef]) => {
            base.TABLES[String(tableName || '').toLowerCase()] = deepClone(tableDef);
        });

        return base;
    }

    function createTableDef(columns = [], rows = []) {
        return {
            columns: deepClone(columns),
            rows: deepClone(rows)
        };
    }

    function replaceStringValuesDeep(value, replacements = []) {
        if (typeof value === 'string') {
            return replacements.reduce((current, [from, to]) => current.split(from).join(to), value);
        }
        if (Array.isArray(value)) {
            return value.map((entry) => replaceStringValuesDeep(entry, replacements));
        }
        if (value && typeof value === 'object') {
            const next = {};
            Object.entries(value).forEach(([key, entryValue]) => {
                next[key] = replaceStringValuesDeep(entryValue, replacements);
            });
            return next;
        }
        return value;
    }

    function cloneTableDefWithTextReplacements(tableDef, replacements = []) {
        return replaceStringValuesDeep(deepClone(tableDef), replacements);
    }

    const MARKTHOF_TO_RABENSAND_REPLACEMENTS = [
        ['Suedtor', 'Salztor'],
        ['Markthof', 'Rabensand'],
        ['Gerbergasse', 'Duenengang'],
        ['Baldur Laib', 'Yarin Dattel'],
        ['Lennart Eisen', 'Samir Eisen'],
        ['Klara Krume', 'Mina Sand'],
        ['Gregor Zins', 'Marek Salz'],
        ['Kaspar Klinge', 'Sadir Sand'],
        ['Borik Kessel', 'Borek Kessel'],
        ['Tabea Teig', 'Talia Teig'],
        ['Rika Klinge', 'Yara Sand'],
        ['Bruno Markt', 'Hakim Markt'],
        ['Konrad Feder', 'Nabil Feder'],
        ['Hannes Pfeffer', 'Hannes Safran'],
        ['Falk Faehre', 'Jorin Segel'],
        ['Faehrmann', 'Schiffer'],
        ['Gewuerzbeutel', 'Safranbeutel'],
        ['Siegelring', 'Silberring'],
        ['Leinenrolle', 'Seidentuch'],
        ['Laterne', 'Oellampe']
    ];

    const MARKTHOF_TO_KRONFESTE_REPLACEMENTS = [
        ['hauptmann', 'vogt'],
        ['Suedtor', 'Torwall'],
        ['Markthof', 'Muenzhof'],
        ['Gerbergasse', 'Kronarchiv'],
        ['Baldur Laib', 'Almar Laib'],
        ['Lennart Eisen', 'Gerrit Eisen'],
        ['Klara Krume', 'Marta Mehl'],
        ['Gregor Zins', 'Konrad Pfennig'],
        ['Kaspar Klinge', 'Viktor Wachs'],
        ['Borik Kessel', 'Bardo Kessel'],
        ['Falk Faehre', 'Cedrik Siegel'],
        ['Faehrmann', 'Siegelmeister'],
        ['Tabea Teig', 'Tilda Teig'],
        ['Rika Klinge', 'Ysra Wachs'],
        ['Magd', 'Kammerzofe'],
        ['Bruno Markt', 'Bruno Muenz'],
        ['Konrad Feder', 'Peregrin Feder'],
        ['Schreiber', 'Archivar'],
        ['Gewuerzbeutel', 'Siegelwachs'],
        ['Siegelring', 'Messingring'],
        ['Zinnbecher', 'Tintenfass'],
        ['Leinenrolle', 'Pergamentrolle'],
        ['Laterne', 'Oellampe']
    ];

    const MARKTHOF_TO_SCHMUGGLER_REPLACEMENTS = [
        ['bezirknr', 'viertelnr'],
        ['hauptmann', 'hafenmeister'],
        ['Suedtor', 'Fischmarkt'],
        ['Markthof', 'Zollhof'],
        ['Gerbergasse', 'Lagerkai'],
        ['Baldur Laib', 'Balduin Laib'],
        ['Lennart Eisen', 'Lorenz Eisen'],
        ['Klara Krume', 'Mina Krume'],
        ['Gregor Zins', 'Gregor Anleger'],
        ['Kaspar Klinge', 'Silas Schmuggler'],
        ['Borik Kessel', 'Bardo Kessel'],
        ['Falk Faehre', 'Hauke Steuer'],
        ['Faehrmann', 'Kapitaen'],
        ['Tabea Teig', 'Tilda Teig'],
        ['Rika Klinge', 'Rike Schmuggler'],
        ['Magd', 'Hafenmagd'],
        ['Bruno Markt', 'Bruno Zoll'],
        ['Konrad Feder', 'Konrad Feder'],
        ['Gewuerzbeutel', 'Taurolle'],
        ['Siegelring', 'Kupferkompass'],
        ['Zinnbecher', 'Zinnbecher'],
        ['Leinenrolle', 'Leinenballen'],
        ['Laterne', 'Sturmlaterne']
    ];

    const KRONFESTE_TO_WACHTURM_REPLACEMENTS = [
        ['Torwall', 'Aussensteg'],
        ['Muenzhof', 'Signalhof'],
        ['Kronarchiv', 'Wachturm'],
        ['Almar Laib', 'Raban Brot'],
        ['Gerrit Eisen', 'Torvin Eisen'],
        ['Marta Mehl', 'Mira Mehl'],
        ['Konrad Pfennig', 'Brann Taler'],
        ['Viktor Wachs', 'Darian Horn'],
        ['Bardo Kessel', 'Borek Kessel'],
        ['Ulf Kessel', 'Udo Kessel'],
        ['Cedrik Siegel', 'Leif Funk'],
        ['Tilda Teig', 'Tilda Korn'],
        ['Odo Hammer', 'Odo Mast'],
        ['Ysra Wachs', 'Mira Horn'],
        ['Bruno Muenz', 'Bruno Funke'],
        ['Peregrin Feder', 'Orin Mast'],
        ['Ida Muenz', 'Ida Funke'],
        ['Hannes Pfeffer', 'Hannes Rauch'],
        ['Kammerzofe', 'Turmhilfe'],
        ['Archivar', 'Signalwart'],
        ['Siegelmeister', 'Turmmeister'],
        ['Siegelwachs', 'Signalhorn'],
        ['Messingring', 'Eisenhaken'],
        ['Tintenfass', 'Leuchtbecher'],
        ['Pergamentrolle', 'Wachrolle'],
        ['Oellampe', 'Leuchtlampe']
    ];

    const KUPFERMINE_TO_STEINBRUCH_REPLACEMENTS = [
        ['Kupfermine', 'Steinbruch'],
        ['Stollenmund', 'Nordtor'],
        ['Schmelzhof', 'Torhof'],
        ['Tiefstollen', 'Bruchkante'],
        ['Merten Laib', 'Tarek Brot'],
        ['Levin Eisen', 'Borin Eisen'],
        ['Klara Krume', 'Sina Schotter'],
        ['Torben Taler', 'Rurik Tor'],
        ['Kuno Erz', 'Raban Stein'],
        ['Falk Seil', 'Lukas Tor'],
        ['Runa Erz', 'Rika Stein'],
        ['Bruno Schurf', 'Bruno Bruch'],
        ['Konrad Karte', 'Konrad Pfad'],
        ['Erzlampe', 'Torrolle'],
        ['Kupferring', 'Steinkeil'],
        ['Seilrolle', 'Kettenrolle'],
        ['Werkzeugkiste', 'Windenkiste'],
        ['Grubenhelm', 'Wappenplatte'],
        ['Aufzugfuehrer', 'Torwaechter'],
        ['Stollenhilfe', 'Bruchhilfe']
    ];

    const SCHMUGGLER_TO_DORNWALL_REPLACEMENTS = [
        ['Fischmarkt', 'Westtor'],
        ['Zollhof', 'Botenhof'],
        ['Lagerkai', 'Dornwall'],
        ['Balduin Laib', 'Darin Laib'],
        ['Lorenz Eisen', 'Lorik Eisen'],
        ['Mina Krume', 'Mina Korn'],
        ['Gregor Anleger', 'Gregor Tor'],
        ['Silas Schmuggler', 'Marek Dorn'],
        ['Rike Schmuggler', 'Elin Dorn'],
        ['Bruno Zoll', 'Bruno Bote'],
        ['Konrad Feder', 'Konrad Brief'],
        ['Hauke Steuer', 'Lenn Kurier'],
        ['Hafenmagd', 'Botin'],
        ['Kapitaen', 'Kurier'],
        ['Schmuggler', 'Wegelagerer'],
        ['Taurolle', 'Briefrolle'],
        ['Kupferkompass', 'Siegeltasche'],
        ['Leinenballen', 'Botenbeutel'],
        ['Sturmlaterne', 'Wegeleuchte']
    ];

    function createEmployeesTable(withRole = false) {
        const columns = [
            { name: 'id', type: 'INTEGER', isPK: true },
            { name: 'name', type: 'TEXT', isPK: false }
        ];
        if (withRole) columns.push({ name: 'role', type: 'TEXT', isPK: false });

        const rows = withRole
            ? [[1, 'Anna', 'Dev'], [2, 'Ben', 'Ops']]
            : [[1, 'Anna'], [2, 'Ben']];

        return createTableDef(columns, rows);
    }

    function createCustomersTable() {
        return createTableDef(
            [
                { name: 'customer_id', type: 'INTEGER', isPK: true },
                { name: 'name', type: 'TEXT', isPK: false }
            ],
            [
                [1, 'Acme'],
                [2, 'Globex']
            ]
        );
    }

    function createDemoUsersTable(options = {}) {
        const { includeNullName = false } = options;
        const rows = [
            [1, 'Alice', 'Admin'],
            [2, 'Bob', 'User'],
            [3, 'Charlie', 'User']
        ];

        if (includeNullName) rows.push([4, null, 'User']);

        return createTableDef(
            [
                { name: 'id', type: 'INTEGER', isPK: true },
                { name: 'name', type: 'VARCHAR', isPK: false },
                { name: 'role', type: 'TEXT', isPK: false }
            ],
            rows
        );
    }

    function createDemoLogsTable() {
        return createTableDef(
            [
                { name: 'log_id', type: 'INTEGER', isPK: true },
                { name: 'user_id', type: 'INTEGER', isFK: true, fkTarget: 'users.id' },
                { name: 'message', type: 'TEXT', isPK: false }
            ],
            [
                [101, 1, 'Logged In'],
                [102, 2, 'Viewed Page'],
                [103, 1, 'Logout']
            ]
        );
    }

    function createScoresTable() {
        return createTableDef(
            [
                { name: 'user_id', type: 'INTEGER', isFK: true, fkTarget: 'users.id' },
                { name: 'points', type: 'INTEGER', isPK: false }
            ],
            [
                [1, 12],
                [1, 18],
                [2, 7],
                [2, 13],
                [3, 5]
            ]
        );
    }

    function createStudentsTable() {
        return createTableDef(
            [
                { name: 'id', type: 'INTEGER', isPK: true },
                { name: 'name', type: 'TEXT', isPK: false }
            ],
            [
                [1, 'Anna'],
                [2, 'Ben'],
                [3, 'Cara']
            ]
        );
    }

    function createEmptyStudentsTable() {
        return createTableDef(
            [
                { name: 'id', type: 'INTEGER', isPK: true },
                { name: 'name', type: 'TEXT', isPK: false }
            ],
            []
        );
    }

    function createProductsTable() {
        return createTableDef(
            [
                { name: 'id', type: 'INTEGER', isPK: true },
                { name: 'name', type: 'TEXT', isPK: false }
            ],
            []
        );
    }

    function createReportsTable() {
        return createTableDef(
            [
                { name: 'report_id', type: 'INTEGER', isPK: true },
                { name: 'title', type: 'TEXT', isPK: false }
            ],
            [
                [1, 'Q1'],
                [2, 'Q2']
            ]
        );
    }

    function createOberburgBezirkTable() {
        return createTableDef(
            [
                { name: 'bezirknr', type: 'INTEGER', isPK: true },
                { name: 'name', type: 'TEXT', isPK: false },
                { name: 'hauptmann', type: 'INTEGER', isPK: false }
            ],
            [
                [1, 'Oberburg', 10],
                [2, 'Markthof', 11],
                [3, 'Suedring', 12]
            ]
        );
    }

    function createOberburgBewohnerTable() {
        return createTableDef(
            [
                { name: 'bewohnernr', type: 'INTEGER', isPK: true },
                { name: 'name', type: 'TEXT', isPK: false },
                { name: 'bezirknr', type: 'INTEGER', isPK: false },
                { name: 'geschlecht', type: 'TEXT', isPK: false },
                { name: 'beruf', type: 'TEXT', isPK: false },
                { name: 'gold', type: 'INTEGER', isPK: false },
                { name: 'status', type: 'TEXT', isPK: false }
            ],
            [
                [10, 'Albrecht Falk', 1, 'm', 'Hauptmann', 260, 'wachsam'],
                [11, 'Hedda Kauf', 2, 'w', 'Kaufmann', 180, 'friedlich'],
                [12, 'Torben Stahl', 1, 'm', 'Waffenschmied', 140, 'friedlich'],
                [13, 'Roderich Grimm', 1, 'm', 'Haendler', 310, 'aufgebracht'],
                [14, 'Ragna Grimm', 1, 'w', 'Baecker', 230, 'aufgebracht'],
                [15, 'Mira Hager', 2, 'w', 'Kaufmann', 170, 'friedlich'],
                [16, 'Borin Teig', 2, 'm', 'Baecker', 95, 'friedlich'],
                [17, 'Edda Korn', 2, 'w', 'Koch', 70, 'friedlich'],
                [18, 'Jarl Pfeil', 3, 'm', 'Kutscher', 110, 'misstrauisch'],
                [19, 'Nora Helm', 3, 'w', 'Haendler', 210, 'friedlich']
            ]
        );
    }

    function createOberburgGegenstandTable() {
        return createTableDef(
            [
                { name: 'gegenstand', type: 'TEXT', isPK: false },
                { name: 'besitzer', type: 'INTEGER', isPK: false }
            ],
            [
                ['Kupferbecher', null],
                ['Siegelring', null],
                ['Weinkrug', null],
                ['Schriftrolle', 13],
                ['Ledertasche', null],
                ['Werkhammer', 12]
            ]
        );
    }

    function createMarkthofBezirkTable() {
        return createTableDef(
            [
                { name: 'bezirknr', type: 'INTEGER', isPK: true },
                { name: 'name', type: 'TEXT', isPK: false },
                { name: 'hauptmann', type: 'INTEGER', isPK: false }
            ],
            [
                [1, 'Suedtor', 4],
                [2, 'Markthof', 12],
                [3, 'Gerbergasse', 13]
            ]
        );
    }

    function createMarkthofBewohnerTable() {
        return createTableDef(
            [
                { name: 'bewohnernr', type: 'INTEGER', isPK: true },
                { name: 'name', type: 'TEXT', isPK: false },
                { name: 'bezirknr', type: 'INTEGER', isPK: false },
                { name: 'geschlecht', type: 'TEXT', isPK: false },
                { name: 'beruf', type: 'TEXT', isPK: false },
                { name: 'gold', type: 'INTEGER', isPK: false },
                { name: 'status', type: 'TEXT', isPK: false }
            ],
            [
                [1, 'Baldur Laib', 1, 'm', 'Baecker', 850, 'friedlich'],
                [2, 'Lennart Eisen', 3, 'm', 'Waffenschmied', 280, 'friedlich'],
                [3, 'Klara Krume', 1, 'w', 'Baecker', 350, 'friedlich'],
                [4, 'Gregor Zins', 1, 'm', 'Kaufmann', 250, 'friedlich'],
                [5, 'Kaspar Klinge', 2, 'm', 'Schmied', 650, 'boese'],
                [6, 'Borik Kessel', 2, 'm', 'Koch', 4850, 'boese'],
                [7, 'Udo Kessel', 3, 'm', 'Koch', 3250, 'boese'],
                [8, 'Falk Faehre', 2, 'm', 'Faehrmann', 490, 'gefangen'],
                [9, 'Tabea Teig', 1, 'w', 'Baecker', 550, 'boese'],
                [10, 'Oskar Hammer', 1, 'm', 'Schmied', 600, 'friedlich'],
                [11, 'Rika Klinge', 2, 'w', 'Magd', 10, 'boese'],
                [12, 'Bruno Markt', 2, 'm', 'Haendler', 680, 'friedlich'],
                [13, 'Konrad Feder', 3, 'm', 'Schreiber', 420, 'friedlich'],
                [14, 'Enno Stahl', 3, 'm', 'Waffenschmied', 510, 'boese'],
                [15, 'Lene Handel', 1, 'w', 'Haendler', 680, 'friedlich'],
                [16, 'Ida Muenz', 1, 'w', 'Haendler', 770, 'boese'],
                [17, 'Hannes Pfeffer', 3, 'm', 'Koch', 990, 'friedlich'],
                [18, 'Ruprecht Huf', 3, 'm', 'Hufschmied', 390, 'friedlich'],
                [19, 'Agnes Herd', 3, 'w', 'Koch', 2280, 'friedlich']
            ]
        );
    }

    function createMarkthofGegenstandTable() {
        return createTableDef(
            [
                { name: 'gegenstand', type: 'TEXT', isPK: false },
                { name: 'besitzer', type: 'INTEGER', isPK: false }
            ],
            [
                ['Gewuerzbeutel', null],
                ['Siegelring', null],
                ['Zinnbecher', null],
                ['Leinenrolle', null],
                ['Holzkiste', null],
                ['Laterne', null]
            ]
        );
    }

    function createMarkthofStorySnapshot() {
        return buildSnapshotFromTables({
            bezirk: createMarkthofBezirkTable(),
            bewohner: createMarkthofBewohnerTable(),
            gegenstand: createMarkthofGegenstandTable()
        });
    }

    function createRabensandBezirkTable() {
        return cloneTableDefWithTextReplacements(createMarkthofBezirkTable(), MARKTHOF_TO_RABENSAND_REPLACEMENTS);
    }

    function createRabensandBewohnerTable() {
        return cloneTableDefWithTextReplacements(createMarkthofBewohnerTable(), MARKTHOF_TO_RABENSAND_REPLACEMENTS);
    }

    function createRabensandGegenstandTable() {
        return cloneTableDefWithTextReplacements(createMarkthofGegenstandTable(), MARKTHOF_TO_RABENSAND_REPLACEMENTS);
    }

    function createRabensandStorySnapshot() {
        return buildSnapshotFromTables({
            bezirk: createRabensandBezirkTable(),
            bewohner: createRabensandBewohnerTable(),
            gegenstand: createRabensandGegenstandTable()
        });
    }

    function createKronfesteBezirkTable() {
        return cloneTableDefWithTextReplacements(createMarkthofBezirkTable(), MARKTHOF_TO_KRONFESTE_REPLACEMENTS);
    }

    function createKronfesteBewohnerTable() {
        return cloneTableDefWithTextReplacements(createMarkthofBewohnerTable(), MARKTHOF_TO_KRONFESTE_REPLACEMENTS);
    }

    function createKronfesteGegenstandTable() {
        return cloneTableDefWithTextReplacements(createMarkthofGegenstandTable(), MARKTHOF_TO_KRONFESTE_REPLACEMENTS);
    }

    function createKronfesteStorySnapshot() {
        return buildSnapshotFromTables({
            bezirk: createKronfesteBezirkTable(),
            bewohner: createKronfesteBewohnerTable(),
            gegenstand: createKronfesteGegenstandTable()
        });
    }

    function createSchmugglerViertelTable() {
        return cloneTableDefWithTextReplacements(createMarkthofBezirkTable(), MARKTHOF_TO_SCHMUGGLER_REPLACEMENTS);
    }

    function createSchmugglerBewohnerTable() {
        return cloneTableDefWithTextReplacements(createMarkthofBewohnerTable(), MARKTHOF_TO_SCHMUGGLER_REPLACEMENTS);
    }

    function createSchmugglerGegenstandTable() {
        return cloneTableDefWithTextReplacements(createMarkthofGegenstandTable(), MARKTHOF_TO_SCHMUGGLER_REPLACEMENTS);
    }

    function createSchmugglerStorySnapshot() {
        return buildSnapshotFromTables({
            viertel: createSchmugglerViertelTable(),
            bewohner: createSchmugglerBewohnerTable(),
            gegenstand: createSchmugglerGegenstandTable()
        });
    }

    function createKupfermineBereichTable() {
        return createTableDef(
            [
                { name: 'bereichnr', type: 'INTEGER', isPK: true },
                { name: 'name', type: 'TEXT', isPK: false },
                { name: 'vorarbeiter', type: 'INTEGER', isPK: false }
            ],
            [
                [1, 'Stollenmund', 1],
                [2, 'Schmelzhof', 6],
                [3, 'Tiefstollen', 13]
            ]
        );
    }

    function createKupfermineArbeiterTable() {
        return createTableDef(
            [
                { name: 'arbeiternr', type: 'INTEGER', isPK: true },
                { name: 'name', type: 'TEXT', isPK: false },
                { name: 'bereichnr', type: 'INTEGER', isPK: false },
                { name: 'geschlecht', type: 'TEXT', isPK: false },
                { name: 'beruf', type: 'TEXT', isPK: false },
                { name: 'gold', type: 'INTEGER', isPK: false },
                { name: 'status', type: 'TEXT', isPK: false }
            ],
            [
                [1, 'Merten Laib', 1, 'm', 'Baecker', 850, 'friedlich'],
                [2, 'Levin Eisen', 3, 'm', 'Waffenschmied', 280, 'friedlich'],
                [3, 'Klara Krume', 1, 'w', 'Baecker', 350, 'friedlich'],
                [4, 'Torben Taler', 1, 'm', 'Kaufmann', 250, 'friedlich'],
                [5, 'Kuno Erz', 3, 'm', 'Schmied', 650, 'boese'],
                [6, 'Bardo Kessel', 2, 'm', 'Koch', 4850, 'boese'],
                [7, 'Udo Kessel', 3, 'm', 'Koch', 3250, 'boese'],
                [8, 'Falk Seil', 2, 'm', 'Aufzugfuehrer', 490, 'gefangen'],
                [9, 'Tilda Teig', 1, 'w', 'Baecker', 550, 'boese'],
                [10, 'Oskar Hammer', 1, 'm', 'Schmied', 600, 'friedlich'],
                [11, 'Runa Erz', 3, 'w', 'Stollenhilfe', 10, 'boese'],
                [12, 'Bruno Schurf', 2, 'm', 'Haendler', 680, 'friedlich'],
                [13, 'Konrad Karte', 3, 'm', 'Vermesser', 420, 'friedlich'],
                [14, 'Enno Stahl', 3, 'm', 'Waffenschmied', 510, 'boese'],
                [15, 'Lene Handel', 2, 'w', 'Haendler', 680, 'friedlich'],
                [16, 'Ida Muenz', 1, 'w', 'Haendler', 770, 'boese'],
                [17, 'Hannes Pfeffer', 3, 'm', 'Koch', 990, 'friedlich'],
                [18, 'Ruprecht Huf', 3, 'm', 'Hufschmied', 390, 'friedlich'],
                [19, 'Agnes Herd', 2, 'w', 'Koch', 2280, 'friedlich']
            ]
        );
    }

    function createKupfermineGegenstandTable() {
        return createTableDef(
            [
                { name: 'gegenstand', type: 'TEXT', isPK: false },
                { name: 'besitzer', type: 'INTEGER', isPK: false }
            ],
            [
                ['Erzlampe', null],
                ['Kupferring', null],
                ['Zinnbecher', null],
                ['Seilrolle', null],
                ['Werkzeugkiste', null],
                ['Grubenhelm', null]
            ]
        );
    }

    function createKupfermineStorySnapshot() {
        return buildSnapshotFromTables({
            bereich: createKupfermineBereichTable(),
            arbeiter: createKupfermineArbeiterTable(),
            gegenstand: createKupfermineGegenstandTable()
        });
    }

    function createSteinbruchBereichTable() {
        return cloneTableDefWithTextReplacements(createKupfermineBereichTable(), KUPFERMINE_TO_STEINBRUCH_REPLACEMENTS);
    }

    function createSteinbruchArbeiterTable() {
        return cloneTableDefWithTextReplacements(createKupfermineArbeiterTable(), KUPFERMINE_TO_STEINBRUCH_REPLACEMENTS);
    }

    function createSteinbruchGegenstandTable() {
        return cloneTableDefWithTextReplacements(createKupfermineGegenstandTable(), KUPFERMINE_TO_STEINBRUCH_REPLACEMENTS);
    }

    function createSteinbruchStorySnapshot() {
        return buildSnapshotFromTables({
            bereich: createSteinbruchBereichTable(),
            arbeiter: createSteinbruchArbeiterTable(),
            gegenstand: createSteinbruchGegenstandTable()
        });
    }

    function createWachturmBezirkTable() {
        return cloneTableDefWithTextReplacements(createKronfesteBezirkTable(), KRONFESTE_TO_WACHTURM_REPLACEMENTS);
    }

    function createWachturmBewohnerTable() {
        return cloneTableDefWithTextReplacements(createKronfesteBewohnerTable(), KRONFESTE_TO_WACHTURM_REPLACEMENTS);
    }

    function createWachturmGegenstandTable() {
        return cloneTableDefWithTextReplacements(createKronfesteGegenstandTable(), KRONFESTE_TO_WACHTURM_REPLACEMENTS);
    }

    function createWachturmStorySnapshot() {
        return buildSnapshotFromTables({
            bezirk: createWachturmBezirkTable(),
            bewohner: createWachturmBewohnerTable(),
            gegenstand: createWachturmGegenstandTable()
        });
    }

    function createDornwallViertelTable() {
        return cloneTableDefWithTextReplacements(createSchmugglerViertelTable(), SCHMUGGLER_TO_DORNWALL_REPLACEMENTS);
    }

    function createDornwallBewohnerTable() {
        return cloneTableDefWithTextReplacements(createSchmugglerBewohnerTable(), SCHMUGGLER_TO_DORNWALL_REPLACEMENTS);
    }

    function createDornwallGegenstandTable() {
        return cloneTableDefWithTextReplacements(createSchmugglerGegenstandTable(), SCHMUGGLER_TO_DORNWALL_REPLACEMENTS);
    }

    function createDornwallStorySnapshot() {
        return buildSnapshotFromTables({
            viertel: createDornwallViertelTable(),
            bewohner: createDornwallBewohnerTable(),
            gegenstand: createDornwallGegenstandTable()
        });
    }

    function createOberburgStorySnapshot() {
        return buildSnapshotFromTables({
            bezirk: createOberburgBezirkTable(),
            bewohner: createOberburgBewohnerTable(),
            gegenstand: createOberburgGegenstandTable()
        });
    }

    function buildActiveStoryDatabaseSnapshot() {
        const normalizedStoryPath = normalizeLessonTitle(activeStoryTitleConfig?.sourcePath || DEFAULT_ACTIVE_STORY_PATH);
        if (normalizedStoryPath.includes(normalizeLessonTitle('Die Händler von Rabensand'))) {
            return createRabensandStorySnapshot();
        }
        if (normalizedStoryPath.includes(normalizeLessonTitle('Das Siegel der Kronfeste'))) {
            return createKronfesteStorySnapshot();
        }
        if (normalizedStoryPath.includes(normalizeLessonTitle('Die Spur des Schmugglers'))) {
            return createSchmugglerStorySnapshot();
        }
        if (normalizedStoryPath.includes(normalizeLessonTitle('Sturm auf den Wachturm'))) {
            return createWachturmStorySnapshot();
        }
        if (normalizedStoryPath.includes(normalizeLessonTitle('Die Tore von Steinbruch'))) {
            return createSteinbruchStorySnapshot();
        }
        if (normalizedStoryPath.includes(normalizeLessonTitle('Der letzte Kurier von Dornwall'))) {
            return createDornwallStorySnapshot();
        }
        if (normalizedStoryPath.includes(normalizeLessonTitle('Das Gold der Kupfermine'))) {
            return createKupfermineStorySnapshot();
        }
        if (normalizedStoryPath.includes(normalizeLessonTitle('Das Geheimnis des Markthofs'))) {
            return createMarkthofStorySnapshot();
        }
        if (normalizedStoryPath.includes(normalizeLessonTitle('Flucht aus der Zitadelle'))) {
            return createOberburgStorySnapshot();
        }
        return null;
    }

    function buildSnapshotFromProfile(profile = '', toolCode = '') {
        const normalizedProfile = normalizeLessonTitle(profile);

        if (normalizedProfile === 'empty') {
            return createEmptySimulationData();
        }
        if (normalizedProfile === 'demo') {
            return buildSnapshotFromTables({}, { includeDemo: true });
        }
        if (normalizedProfile === 'demo-analytics') {
            return buildSnapshotFromTables({ scores: createScoresTable() }, { includeDemo: true });
        }
        if (normalizedProfile === 'demo-null-users') {
            return buildSnapshotFromTables(
                {
                    users: createDemoUsersTable({ includeNullName: true }),
                    logs: createDemoLogsTable()
                },
                { includeDemo: true }
            );
        }
        if (normalizedProfile === 'demo-students') {
            return buildSnapshotFromTables({ students: createStudentsTable() }, { includeDemo: true });
        }
        if (normalizedProfile === 'students-empty') {
            return buildSnapshotFromTables({ students: createEmptyStudentsTable() }, { includeDemo: true });
        }
        if (normalizedProfile === 'employees-basic') {
            return buildSnapshotFromTables({ employees: createEmployeesTable(false) });
        }
        if (normalizedProfile === 'employees-with-role') {
            return buildSnapshotFromTables({ employees: createEmployeesTable(true) });
        }
        if (normalizedProfile === 'customers') {
            return buildSnapshotFromTables({ customers: createCustomersTable() });
        }
        if (normalizedProfile === 'demo-reports') {
            return buildSnapshotFromTables({ reports: createReportsTable() }, { includeDemo: true });
        }
        if (normalizedProfile === 'products-empty') {
            return buildSnapshotFromTables({ products: createProductsTable() }, { includeDemo: true });
        }

        return normalizedProfile ? null : buildToolDatabasePreset(toolCode);
    }

    function resolveLessonDatabaseProfile(toolCode, lessonPathKey = '', lessonTitle = '') {
        const title = normalizeLessonTitle(lessonTitle);
        const pathKey = normalizeLessonTitle(lessonPathKey);

        if (toolCode === 'ddl') {
            if (pathKey.includes('alter table > drop column')) return 'employees-with-role';
            if (pathKey.includes('alter table')) return 'employees-basic';
            if (pathKey.includes('foreign key')) return 'customers';
            return 'empty';
        }

        if (toolCode === 'dml') {
            if (title === 'insert') return 'students-empty';
            if (title === 'stammdatenpflege') return 'products-empty';
            if (title === 'bereinigung') return 'demo';
            return 'demo-students';
        }

        if (toolCode === 'dql') return 'demo';
        if (toolCode === 'dcl') return 'demo-reports';
        if (toolCode === 'tcl') return 'demo';
        return '';
    }

    function buildLessonDatabasePreset(toolCode, lesson, lessonPathParts = [], inheritedProfile = '') {
        // Central lesson-to-database mapping.
        // Priority: explicit profile in JSON > inherited profile > computed lesson profile.
        const lessonPathKey = normalizeLessonPathKey(lessonPathParts);
        const ownProfile = normalizeLessonTitle(lesson?.databaseProfile || '');
        const inherited = normalizeLessonTitle(inheritedProfile || '');
        const resolvedProfile = ownProfile
            || inherited
            || resolveLessonDatabaseProfile(toolCode, lessonPathKey, lesson?.title || '');

        const snapshot = buildSnapshotFromProfile(resolvedProfile, toolCode);
        if (snapshot) return snapshot;
        return buildToolDatabasePreset(toolCode);
    }

    function assignLessonSnapshotsForTool(tool) {
        // Walk every lesson node (including nested nodes) and inject a snapshot
        // when none is explicitly defined in folderTree.json.
        const walk = (lesson, pathParts = [], inheritedProfile = '') => {
            if (!lesson) return;
            const currentPath = [...pathParts, String(lesson?.title || '').trim()].filter(Boolean);
            const ownProfile = String(lesson?.databaseProfile || '').trim();
            const nextProfile = ownProfile || inheritedProfile;
            if (!lesson.databaseSnapshot) {
                lesson.databaseSnapshot = buildLessonDatabasePreset(tool.code, lesson, currentPath, nextProfile);
            }
            (lesson.children || []).forEach((child) => walk(child, currentPath, nextProfile));
        };

        (tool.lessonRoots || []).forEach((lesson) => walk(lesson, [], ''));
    }

    function escapeRegExp(value = '') {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function inferLessonKeyword(title = '', toolCode = '') {
        const tokenMatches = String(title || '').toUpperCase().match(/\b[A-Z]{2,}\b/g) || [];
        const blacklist = new Set(['LEVEL', 'UEBERSICHT']);
        const tokens = [...new Set(tokenMatches.filter((token) => !blacklist.has(token)))];
        if (tokens.length > 0) return tokens.join(' | ');
        return String(toolCode || 'sql').toUpperCase();
    }

    function inferTaskCheckFromText(taskText = '') {
        const text = String(taskText || '').trim();
        if (!text) return null;

        const createMatch = text.match(/\b(?:Erstelle|Create)\s+`([^`]+)`/i);
        const quotedTokens = [...text.matchAll(/`([^`]+)`/g)].map((entry) => String(entry[1] || '').trim()).filter(Boolean);
        const tableName = createMatch ? String(createMatch[1]).toLowerCase() : '';

        if (tableName) {
            const columnCandidates = [];
            let consumedTable = false;
            quotedTokens.forEach((token) => {
                if (!consumedTable && token.toLowerCase() === tableName) {
                    consumedTable = true;
                    return;
                }
                const columnName = token.split(/\s+/)[0].replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
                if (columnName) columnCandidates.push(columnName);
            });
            const uniqueColumns = [...new Set(columnCandidates)];

            if (uniqueColumns.length > 0) {
                return { type: 'table-columns', table: tableName, columns: uniqueColumns };
            }

            return {
                type: 'statement-regex',
                pattern: `\\bCREATE\\s+TABLE\\s+${escapeRegExp(tableName)}\\b`,
                flags: 'i'
            };
        }

        return null;
    }

    function parseFolderTreeMarkdown(markdownText = '') {
        const lines = String(markdownText || '').split(/\r?\n/);
        const parsed = {
            rootLabel: '',
            tools: [],
            toolLabels: []
        };

        let currentTool = null;
        let currentLesson = null;
        let lessonStack = [];
        let lessonCounter = 0;
        let taskCounter = 0;

        lines.forEach((rawLine) => {
            const headingMatch = String(rawLine || '').match(/^\s*(#{1,6})\s+(.*?)\s*$/);
            if (headingMatch) {
                const level = headingMatch[1].length;
                const title = String(headingMatch[2] || '').trim();
                if (!title) return;

                if (level === 1) {
                    parsed.rootLabel = title;
                    return;
                }

                if (level === 2) {
                    const toolId = sanitizeClassName(title) || `tool-${parsed.tools.length + 1}`;
                    const toolCode = extractToolCode(title);
                    const tool = {
                        id: toolId,
                        code: toolCode,
                        label: title,
                        lessons: [],
                        lessonRoots: []
                    };
                    parsed.tools.push(tool);
                    parsed.toolLabels.push(title);
                    currentTool = tool;
                    currentLesson = null;
                    lessonStack = [];
                    lessonCounter = 0;
                    taskCounter = 0;
                    return;
                }

                if (level >= 3 && currentTool) {
                    lessonCounter += 1;
                    const lessonId = `${currentTool.id}-lesson-${lessonCounter}-${sanitizeClassName(title) || 'item'}`;
                    const lesson = {
                        id: lessonId,
                        title,
                        keyword: inferLessonKeyword(title, currentTool.code),
                        level: Math.max(1, level - 2),
                        bodyLines: [],
                        tasks: [],
                        children: [],
                        databaseProfile: '',
                        databaseSnapshot: null
                    };

                    while (lessonStack.length > 0 && lessonStack[lessonStack.length - 1].level >= lesson.level) {
                        lessonStack.pop();
                    }

                    if (lessonStack.length === 0) {
                        currentTool.lessonRoots.push(lesson);
                    } else {
                        lessonStack[lessonStack.length - 1].children.push(lesson);
                    }

                    lessonStack.push(lesson);
                    currentTool.lessons.push(lesson);
                    currentLesson = lesson;
                    taskCounter = 0;
                }
                return;
            }

            if (!currentLesson) return;
            const contentLine = String(rawLine || '').replace(/^\s+/, '').trimEnd();
            const trimmed = contentLine.trim();
            if (!trimmed) return;

            if (/^[_-]{10,}$/.test(trimmed)) {
                return;
            }

            const taskMatch = trimmed.match(/^(?:[-*]\s*)?\[\s*\]\s*(.+)$/);
            if (taskMatch) {
                taskCounter += 1;
                const taskText = String(taskMatch[1] || '').trim();
                if (!taskText) return;
                currentLesson.tasks.push({
                    id: `${currentLesson.id}-task-${taskCounter}`,
                    text: taskText,
                    check: inferTaskCheckFromText(taskText)
                });
                return;
            }

            currentLesson.bodyLines.push(trimmed);
        });

        return parsed;
    }

    function parseFolderTreeJson(rawTree = {}) {
        // Runtime source of truth for lesson content.
        // Supports both compact authoring (string tasks) and explicit objects.
        const safeRootLabel = String(rawTree?.rootLabel || LESSON_TREE_FALLBACK.rootLabel).trim() || LESSON_TREE_FALLBACK.rootLabel;
        const toolsSource = Array.isArray(rawTree?.tools) ? rawTree.tools : [];
        const parsed = {
            rootLabel: safeRootLabel,
            tools: [],
            toolLabels: []
        };

        const normalizeTaskEntries = (tasksSource, lessonId) => {
            const tasks = Array.isArray(tasksSource) ? tasksSource : [];
            let taskCounter = 0;
            return tasks
                .map((taskEntry) => {
                    const isTaskObject = Boolean(taskEntry && typeof taskEntry === 'object' && !Array.isArray(taskEntry));
                    const taskText = typeof taskEntry === 'string'
                        ? taskEntry
                        : String(taskEntry?.text || '').trim();
                    if (!taskText) return null;
                    taskCounter += 1;
                    const explicitTaskId = isTaskObject ? String(taskEntry?.id || '').trim() : '';
                    const explicitCheck = (isTaskObject && taskEntry.check && typeof taskEntry.check === 'object')
                        ? deepClone(taskEntry.check)
                        : null;
                    return {
                        id: explicitTaskId || `${lessonId}-task-${taskCounter}`,
                        text: taskText,
                        check: explicitCheck || inferTaskCheckFromText(taskText),
                        unlockIds: isTaskObject ? normalizeSqlCoreUnlockInputIds(taskEntry.unlockIds || []) : []
                    };
                })
                .filter(Boolean);
        };

        const normalizeLessonNodeFromJson = (lessonEntry, toolId, lineage = [], fallbackIndex = 1) => {
            const title = stripTokenIdFromTitle(String(lessonEntry?.title || `Lektion ${fallbackIndex}`))
                || `Lektion ${fallbackIndex}`;
            const pathSlug = [...lineage, sanitizeClassName(title) || `item-${fallbackIndex}`].join('-');
            const lessonId = String(lessonEntry?.id || `${toolId}-${pathSlug}`).trim() || `${toolId}-${pathSlug}`;
            const bodyText = String(lessonEntry?.body || '').trim();
            const bodyLines = bodyText
                ? bodyText.split(/\r?\n/).map((line) => String(line || '').trimEnd()).filter((line) => line.trim().length > 0)
                : [];

            const childrenSource = Array.isArray(lessonEntry?.children)
                ? lessonEntry.children
                : [];
            const children = childrenSource.map((child, childIndex) => normalizeLessonNodeFromJson(
                child,
                toolId,
                [...lineage, sanitizeClassName(title) || `item-${fallbackIndex}`],
                childIndex + 1
            ));

            return {
                id: lessonId,
                title,
                level: Math.max(1, Number(lessonEntry?.level) || (lineage.length + 1)),
                bodyLines,
                tasks: normalizeTaskEntries(lessonEntry?.tasks, lessonId),
                children,
                databaseProfile: String(lessonEntry?.databaseProfile || '').trim(),
                databaseSnapshot: lessonEntry?.databaseSnapshot || null
            };
        };

        toolsSource.forEach((toolEntry, toolIndex) => {
            const label = String(toolEntry?.label || `Werkzeug ${toolIndex + 1}`).trim() || `Werkzeug ${toolIndex + 1}`;
            const toolId = String(toolEntry?.id || sanitizeClassName(label) || `tool-${toolIndex + 1}`).trim() || `tool-${toolIndex + 1}`;
            const lessonsSource = Array.isArray(toolEntry?.lessonRoots)
                ? toolEntry.lessonRoots
                : (Array.isArray(toolEntry?.lessons) ? toolEntry.lessons : []);

            const lessonRoots = lessonsSource.map((lessonEntry, lessonIndex) => normalizeLessonNodeFromJson(
                lessonEntry,
                toolId,
                [],
                lessonIndex + 1
            ));

            parsed.tools.push({
                id: toolId,
                code: extractToolCode(label),
                label,
                lessonRoots
            });
            parsed.toolLabels.push(label);
        });

        return parsed;
    }

    function extractStoryFolderLabelFromPath(path = '') {
        const pathParts = String(path || '').split('/').filter(Boolean);
        if (pathParts.length >= 2) {
            return String(pathParts[1] || '').trim() || 'Story';
        }
        if (pathParts.length === 1) {
            return String(pathParts[0] || '').replace(/\.[^.]+$/u, '').trim() || 'Story';
        }
        return 'Story';
    }

    function normalizeStorySourceEntries(sourceEntries = []) {
        const seenKeys = new Set();
        return (Array.isArray(sourceEntries) ? sourceEntries : [])
            .map((entry, index) => {
                const isObjectEntry = Boolean(entry && typeof entry === 'object' && !Array.isArray(entry));
                const sourcePath = typeof entry === 'string'
                    ? entry
                    : String(entry?.path || entry?.sourcePath || '').trim();
                const path = String(sourcePath || '').trim();
                const explicitLabel = isObjectEntry
                    ? String(entry?.folderLabel || entry?.label || '').trim()
                    : '';
                const fallbackLabel = extractStoryFolderLabelFromPath(path);
                const folderLabel = explicitLabel || fallbackLabel || `Story ${index + 1}`;
                const folderId = String(isObjectEntry ? (entry?.folderId || entry?.id || '') : '').trim()
                    || `story-folder-${sanitizeClassName(path || folderLabel) || `source-${index + 1}`}`;
                const dedupeKey = path ? `path:${path}` : `folder:${folderId}`;
                if (seenKeys.has(dedupeKey)) return null;
                seenKeys.add(dedupeKey);

                return {
                    path,
                    folderLabel,
                    folderId,
                    optional: Boolean(isObjectEntry && entry?.optional)
                };
            })
            .filter(Boolean);
    }

    function buildStoryFolderBlueprint(sourceEntries = []) {
        const folderMap = new Map();
        const orderedFolders = [];

        (Array.isArray(sourceEntries) ? sourceEntries : []).forEach((entry, index) => {
            const label = String(entry?.folderLabel || '').trim() || `Story ${index + 1}`;
            const id = String(entry?.folderId || '').trim()
                || `story-folder-${sanitizeClassName(label) || `item-${index + 1}`}`;
            if (folderMap.has(id)) return;

            const folder = { id, label };
            folderMap.set(id, folder);
            orderedFolders.push(folder);
        });

        return orderedFolders;
    }

    async function resolveStorySourceConfig(mode = activeLessonMode) {
        const resolvedMode = resolveLessonMode(mode);
        let rootLabel = STORY_TREE_FALLBACK.rootLabel;
        let defaultStoryPath = String(DEFAULT_ACTIVE_STORY_PATH_BY_MODE[resolvedMode] || DEFAULT_ACTIVE_STORY_PATH).trim() || DEFAULT_ACTIVE_STORY_PATH;

        try {
            const response = await fetch(encodeURI(STORY_SOURCE_INDEX_PATH), { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const manifest = await response.json();
            const manifestRootLabel = String(manifest?.rootLabelByMode?.[resolvedMode] || manifest?.rootLabel || '').trim();
            const manifestDefaultPath = String(manifest?.defaultStoryPath || '').trim();
            const manifestModeDefaultPath = String(manifest?.defaultStoryPathByMode?.[resolvedMode] || '').trim();
            if (manifestRootLabel) rootLabel = manifestRootLabel;
            if (manifestModeDefaultPath) {
                defaultStoryPath = manifestModeDefaultPath;
            } else if (manifestDefaultPath) {
                defaultStoryPath = manifestDefaultPath;
            }

            const modeEntries = Array.isArray(manifest?.storiesByMode?.[resolvedMode])
                ? manifest.storiesByMode[resolvedMode]
                : null;
            const manifestEntries = Array.isArray(modeEntries)
                ? modeEntries
                : (Array.isArray(manifest?.stories)
                    ? manifest.stories
                    : (Array.isArray(manifest?.paths) ? manifest.paths : []));
            const normalizedManifestEntries = normalizeStorySourceEntries(manifestEntries);
            if (normalizedManifestEntries.length > 0) {
                return {
                    rootLabel,
                    defaultStoryPath,
                    sourceEntries: normalizedManifestEntries
                };
            }
        } catch (error) {
            console.warn(`[StoryTree] ${STORY_SOURCE_INDEX_PATH} konnte nicht geladen werden.`, error);
        }

        return {
            rootLabel,
            defaultStoryPath,
            sourceEntries: normalizeStorySourceEntries(
                STORY_SOURCE_FALLBACKS_BY_MODE[resolvedMode]
                || STORY_SOURCE_FALLBACKS_BY_MODE.easy
                || []
            )
        };
    }

    function ensureUniqueStoryTitleIds(titles = []) {
        const seenIds = new Set();
        return (Array.isArray(titles) ? titles : [])
            .map((storyTitle, index) => {
                if (!storyTitle || typeof storyTitle !== 'object' || Array.isArray(storyTitle)) return null;
                const cloned = { ...storyTitle };
                const originalId = String(cloned.id || '').trim() || `story-title-${index + 1}`;
                let safeId = originalId;
                if (seenIds.has(safeId)) {
                    const baseId = `${sanitizeClassName(cloned.folderId || cloned.folderLabel || '') || 'story'}-${sanitizeClassName(originalId) || 'item'}`;
                    safeId = baseId;
                    let duplicateCounter = 2;
                    while (seenIds.has(safeId)) {
                        safeId = `${baseId}-${duplicateCounter}`;
                        duplicateCounter += 1;
                    }
                }
                seenIds.add(safeId);
                cloned.id = safeId;
                return cloned;
            })
            .filter(Boolean);
    }

    function groupStoryTitlesByFolder(titles = [], folderBlueprint = storyFolderBlueprint) {
        const folderMap = new Map();
        const orderedFolders = [];

        const ensureFolder = (folderId, folderLabel, fallbackIndex = 0) => {
            const safeLabel = String(folderLabel || '').trim() || `Story ${fallbackIndex + 1}`;
            const safeId = String(folderId || '').trim()
                || `story-folder-${sanitizeClassName(safeLabel) || `item-${fallbackIndex + 1}`}`;
            let folder = folderMap.get(safeId);
            if (!folder) {
                folder = { id: safeId, label: safeLabel, titles: [] };
                folderMap.set(safeId, folder);
                orderedFolders.push(folder);
            }
            return folder;
        };

        (Array.isArray(folderBlueprint) ? folderBlueprint : []).forEach((entry, index) => {
            ensureFolder(entry?.id || entry?.folderId, entry?.label || entry?.folderLabel, index);
        });

        (Array.isArray(titles) ? titles : []).forEach((storyTitle, storyIndex) => {
            const fallbackLabel = `Story ${storyIndex + 1}`;
            const folderLabel = String(storyTitle?.folderLabel || fallbackLabel).trim() || fallbackLabel;
            const folderId = String(storyTitle?.folderId || '').trim()
                || `story-folder-${sanitizeClassName(folderLabel) || `item-${storyIndex + 1}`}`;
            const folder = ensureFolder(folderId, folderLabel, storyIndex);
            folder.titles.push(storyTitle);
        });

        return orderedFolders;
    }

    function parseStoriesJson(rawStories = {}, options = {}) {
        const safeRootLabel = String(rawStories?.rootLabel || STORY_TREE_FALLBACK.rootLabel).trim() || STORY_TREE_FALLBACK.rootLabel;
        const titlesSource = Array.isArray(rawStories?.titles) ? rawStories.titles : [];
        const allowedStatus = new Set(['neu', 'aktiv', 'gelesen']);
        const sourcePath = String(options?.sourcePath || '').trim();
        const folderLabel = String(options?.folderLabel || extractStoryFolderLabelFromPath(sourcePath)).trim() || 'Story';
        const folderId = String(options?.folderId || '').trim()
            || `story-folder-${sanitizeClassName(sourcePath || folderLabel) || 'story'}`;
        const normalizeAdvanceRule = (rule) => {
            if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return null;
            return deepClone(rule);
        };
        const titles = titlesSource
            .map((entry, index) => {
                const safeTitle = String(entry?.title || '').trim();
                if (!safeTitle) return null;
                const safeId = String(entry?.id || `story-title-${index + 1}-${sanitizeClassName(safeTitle) || 'item'}`).trim()
                    || `story-title-${index + 1}`;
                const stepLabel = String(entry?.stepLabel || '').trim();
                const subtitle = String(entry?.subtitle || '').trim();
                const treeLabel = String(entry?.treeLabel || '').trim();
                const rawStatus = String(entry?.status || '').trim().toLowerCase();
                const status = allowedStatus.has(rawStatus) ? rawStatus : (index === 0 ? 'aktiv' : 'neu');
                const guideScenes = Array.isArray(entry?.guideScenes)
                    ? entry.guideScenes
                        .map((scene, sceneIndex) => {
                            const dialogueTurns = normalizeGuideDialogueTurns(scene);
                            const text = dialogueTurns.map((turn) => turn.text).join('\n').trim();
                            if (!text) return null;
                            return {
                                id: String(scene?.id || `${safeId}-scene-${sceneIndex + 1}`),
                                speaker: dialogueTurns[0]?.speaker || (String(scene?.speaker || 'Guide').trim() || 'Guide'),
                                text,
                                dialogueTurns,
                                sceneTitle: String(scene?.sceneTitle || '').trim(),
                                objective: String(scene?.objective || '').trim(),
                                advanceHint: String(scene?.advanceHint || '').trim(),
                                editorComment: String(scene?.editorComment || '').trim(),
                                starterSql: String(scene?.starterSql || '').trim(),
                                successMessage: String(scene?.successMessage || '').trim(),
                                advanceOn: normalizeAdvanceRule(scene?.advanceOn),
                                unlockIds: normalizeSqlCoreUnlockInputIds(scene?.unlockIds || [])
                            };
                        })
                        .filter(Boolean)
                    : [];

                return {
                    id: safeId,
                    title: safeTitle,
                    treeLabel,
                    stepLabel,
                    subtitle,
                    status,
                    guideScenes,
                    sourcePath,
                    folderLabel,
                    folderId
                };
            })
            .filter(Boolean);

        return {
            rootLabel: safeRootLabel,
            titles
        };
    }

    function getStoryTitleById(storyTitleId) {
        return (storyTreeModel.titles || []).find((entry) => entry.id === storyTitleId) || null;
    }

    function readStoredStoryProgressPayload() {
        if (!window?.localStorage) return null;
        try {
            const raw = window.localStorage.getItem(STORY_PROGRESS_STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
            return parsed;
        } catch (error) {
            console.warn('[StoryProgress] Konnte localStorage-Daten nicht lesen.', error);
            return null;
        }
    }

    function persistStoryProgress() {
        if (!window?.localStorage) return;
        const titles = Array.isArray(storyTreeModel?.titles) ? storyTreeModel.titles : [];
        if (titles.length === 0) return;

        const stories = {};
        titles.forEach((storyTitle) => {
            const runtimeEntry = getStoryRuntimeEntry(storyTitle);
            if (!runtimeEntry) return;
            stories[storyTitle.id] = {
                status: normalizeStoryStatus(runtimeEntry.status, storyTitle.status),
                sceneIndex: clampStorySceneIndex(runtimeEntry.sceneIndex, getStorySceneCount(storyTitle)),
                completed: Boolean(runtimeEntry.completed),
                readySceneIds: storyProgressLiveChecks.normalizeStoryReadySceneIds(runtimeEntry.readySceneIds)
            };
        });

        const payload = {
            version: 1,
            activeStoryTitleId: String(activeStoryTitleId || ''),
            stories,
            savedAt: Date.now()
        };

        try {
            window.localStorage.setItem(STORY_PROGRESS_STORAGE_KEY, JSON.stringify(payload));
        } catch (error) {
            console.warn('[StoryProgress] Konnte localStorage-Daten nicht speichern.', error);
        }
    }

    function restoreStoryProgressFromStorage() {
        const payload = readStoredStoryProgressPayload();
        if (!payload) return false;

        const titles = Array.isArray(storyTreeModel?.titles) ? storyTreeModel.titles : [];
        if (titles.length === 0) return false;
        const titleById = new Map(titles.map((entry) => [entry.id, entry]));
        const persistedStories = payload && payload.stories && typeof payload.stories === 'object' && !Array.isArray(payload.stories)
            ? payload.stories
            : {};

        Object.entries(persistedStories).forEach(([storyId, snapshot]) => {
            const storyTitle = titleById.get(String(storyId || ''));
            if (!storyTitle || !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return;
            const runtimeEntry = getStoryRuntimeEntry(storyTitle);
            if (!runtimeEntry) return;

            const persistedSceneIndex = Number(snapshot.sceneIndex);
            runtimeEntry.sceneIndex = clampStorySceneIndex(
                Number.isFinite(persistedSceneIndex) ? persistedSceneIndex : runtimeEntry.sceneIndex,
                getStorySceneCount(storyTitle)
            );
            runtimeEntry.status = normalizeStoryStatus(snapshot.status, storyTitle.status);
            runtimeEntry.completed = Boolean(snapshot.completed) || runtimeEntry.status === 'gelesen';
            runtimeEntry.readySceneIds = storyProgressLiveChecks.normalizeStoryReadySceneIds(snapshot.readySceneIds);
        });

        const persistedActiveId = String(payload.activeStoryTitleId || '').trim();
        if (persistedActiveId && titleById.has(persistedActiveId)) {
            activeStoryTitleId = persistedActiveId;
        }

        const activeStory = getStoryTitleById(activeStoryTitleId);
        if (activeStory) {
            const runtimeEntry = getStoryRuntimeEntry(activeStory);
            if (runtimeEntry) {
                activeStorySceneIndex = clampStorySceneIndex(runtimeEntry.sceneIndex, getStorySceneCount(activeStory));
                runtimeEntry.sceneIndex = activeStorySceneIndex;
            }
        }

        return true;
    }

    function removeStoredStoryProgress() {
        if (!window?.localStorage) return;
        try {
            window.localStorage.removeItem(STORY_PROGRESS_STORAGE_KEY);
        } catch (error) {
            console.warn('[StoryProgress] Konnte localStorage-Eintrag nicht loeschen.', error);
        }
    }

    function resetStoryProgressToDefaults() {
        const titles = Array.isArray(storyTreeModel?.titles) ? storyTreeModel.titles : [];
        setStoryAutoAdvanceNotice('');
        pendingStoryAdvanceParseResult = null;
        storyRuntimeState.clear();

        titles.forEach((storyTitle, storyIndex) => {
            const runtimeEntry = getStoryRuntimeEntry(storyTitle);
            if (!runtimeEntry) return;
            runtimeEntry.sceneIndex = 0;
            runtimeEntry.completed = false;
            runtimeEntry.readySceneIds = [];
            runtimeEntry.status = storyIndex === 0 ? 'aktiv' : 'neu';
        });

        const firstStory = titles[0] || null;
        activeStoryTitleId = firstStory?.id || '';
        activeStoryTitleConfig = firstStory;
        activeStorySceneIndex = 0;
        ensureActiveStoryVisible(titles);
        persistStoryProgress();
        updateGuideWindowStoryHint();
        renderLessonTree(tutorialTreeModel);
    }

    function normalizeStoryStatus(status = '', fallback = 'neu') {
        const normalized = String(status || '').trim().toLowerCase();
        if (normalized === 'aktiv' || normalized === 'gelesen' || normalized === 'neu') return normalized;
        const fallbackNormalized = String(fallback || 'neu').trim().toLowerCase();
        if (fallbackNormalized === 'aktiv' || fallbackNormalized === 'gelesen') return fallbackNormalized;
        return 'neu';
    }

    function getStorySceneCount(storyTitleConfig = null) {
        return collectGuideScenes(storyTitleConfig).length;
    }

    function isGuideWindowStorySelectionActive() {
        return activeGuideSelectionScope === 'story' && hasExplicitStorySelection && Boolean(activeStoryTitleConfig);
    }

    function syncGuideWindowVisibility() {
        if (!rightDrawer) return;
        const isVisible = isGuideWindowStorySelectionActive();
        rightDrawer.hidden = !isVisible;
        rightDrawer.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
    }

    function formatStoryTreeLabel(storyTitleConfig = null, storyIndex = 0) {
        const explicitLabel = String(storyTitleConfig?.treeLabel || '').trim();
        if (explicitLabel) return explicitLabel;
        const rawTitle = String(storyTitleConfig?.title || '').trim();
        const chapterMatch = rawTitle.match(/^Kapitel\s*(\d+)\s*:\s*(.+)$/i);
        if (chapterMatch) {
            return `${chapterMatch[1]} ${chapterMatch[2]}`;
        }
        if (!rawTitle) return `${storyIndex + 1} Story`;
        return `${storyIndex + 1} ${rawTitle}`;
    }

    function getStoryVisibleUpperIndex(titles = storyTreeModel.titles || []) {
        const safeTitles = Array.isArray(titles) ? titles : [];
        if (safeTitles.length === 0) return -1;
        if (STORY_SHOW_ALL_FOR_TEST) return safeTitles.length - 1;

        let contiguousCompletedIndex = -1;
        for (let index = 0; index < safeTitles.length; index += 1) {
            const runtimeEntry = getStoryRuntimeEntry(safeTitles[index]);
            if (runtimeEntry?.completed) {
                contiguousCompletedIndex = index;
                continue;
            }
            break;
        }

        return Math.min(safeTitles.length - 1, contiguousCompletedIndex + 1);
    }

    function ensureActiveStoryVisible(titles = storyTreeModel.titles || []) {
        const safeTitles = Array.isArray(titles) ? titles : [];
        if (safeTitles.length === 0) {
            activeStoryTitleId = '';
            activeStoryTitleConfig = null;
            activeStorySceneIndex = 0;
            return;
        }

        const visibleUpperIndex = getStoryVisibleUpperIndex(safeTitles);
        const activeIndex = safeTitles.findIndex((storyTitle) => storyTitle.id === activeStoryTitleId);
        const clampedVisibleIndex = Math.max(0, visibleUpperIndex);
        if (activeIndex === -1 || activeIndex > visibleUpperIndex) {
            const fallbackStory = safeTitles[clampedVisibleIndex] || safeTitles[0];
            activeStoryTitleId = fallbackStory.id;
            activeStoryTitleConfig = fallbackStory;
            const runtimeEntry = getStoryRuntimeEntry(fallbackStory);
            const sceneCount = getStorySceneCount(fallbackStory);
            activeStorySceneIndex = clampStorySceneIndex(runtimeEntry?.sceneIndex || 0, sceneCount);
            if (runtimeEntry) runtimeEntry.sceneIndex = activeStorySceneIndex;
            return;
        }

        const activeStory = safeTitles[activeIndex];
        activeStoryTitleConfig = activeStory;
        const runtimeEntry = getStoryRuntimeEntry(activeStory);
        const sceneCount = getStorySceneCount(activeStory);
        activeStorySceneIndex = clampStorySceneIndex(runtimeEntry?.sceneIndex || 0, sceneCount);
        if (runtimeEntry) runtimeEntry.sceneIndex = activeStorySceneIndex;
    }

    function clampStorySceneIndex(index, sceneCount) {
        if (!Number.isFinite(index)) return 0;
        if (sceneCount <= 0) return 0;
        return Math.max(0, Math.min(sceneCount - 1, Math.floor(index)));
    }

    function getStoryRuntimeEntry(storyTitleConfig = null) {
        if (!storyTitleConfig?.id) return null;
        let runtimeEntry = storyRuntimeState.get(storyTitleConfig.id);
        if (!runtimeEntry) {
            const initialStatus = normalizeStoryStatus(storyTitleConfig.status, 'neu');
            runtimeEntry = {
                status: initialStatus,
                sceneIndex: 0,
                completed: initialStatus === 'gelesen',
                readySceneIds: []
            };
            storyRuntimeState.set(storyTitleConfig.id, runtimeEntry);
        }

        const sceneCount = getStorySceneCount(storyTitleConfig);
        runtimeEntry.sceneIndex = clampStorySceneIndex(runtimeEntry.sceneIndex, sceneCount);
        runtimeEntry.status = normalizeStoryStatus(runtimeEntry.status, storyTitleConfig.status);
        runtimeEntry.readySceneIds = storyProgressLiveChecks.normalizeStoryReadySceneIds(runtimeEntry.readySceneIds);
        if (runtimeEntry.completed) {
            runtimeEntry.status = 'gelesen';
        }
        return runtimeEntry;
    }

    function getEffectiveStoryStatus(storyTitleConfig = null) {
        if (!storyTitleConfig) return 'neu';
        const runtimeEntry = getStoryRuntimeEntry(storyTitleConfig);
        if (storyTitleConfig.id === activeStoryTitleId) return 'aktiv';
        if (runtimeEntry?.completed || runtimeEntry?.status === 'gelesen') return 'gelesen';
        const normalized = normalizeStoryStatus(runtimeEntry?.status, storyTitleConfig.status);
        return normalized === 'aktiv' ? 'neu' : normalized;
    }

    function getStorySceneProgressLabel(storyTitleConfig = null, options = {}) {
        const { preferActive = false } = options;
        const sceneCount = getStorySceneCount(storyTitleConfig);
        if (sceneCount <= 0) return 'Szene -';
        const runtimeEntry = getStoryRuntimeEntry(storyTitleConfig);
        const runtimeIndex = runtimeEntry ? runtimeEntry.sceneIndex : 0;
        const activeIndex = storyTitleConfig?.id === activeStoryTitleId ? activeStorySceneIndex : runtimeIndex;
        const sceneIndex = preferActive
            ? clampStorySceneIndex(activeIndex, sceneCount)
            : clampStorySceneIndex(runtimeIndex, sceneCount);
        return `Szene ${sceneIndex + 1}/${sceneCount}`;
    }

    function collectGuideScenes(storyTitleConfig = null) {
        if (!storyTitleConfig || !Array.isArray(storyTitleConfig.guideScenes)) return [];
        return storyTitleConfig.guideScenes
            .map((scene, sceneIndex) => {
                const dialogueTurns = normalizeGuideDialogueTurns(scene);
                const text = dialogueTurns.map((turn) => turn.text).join('\n').trim();
                if (!text) return null;
                return {
                    id: String(scene?.id || `${storyTitleConfig.id}-scene-${sceneIndex + 1}`),
                    speaker: dialogueTurns[0]?.speaker || (String(scene?.speaker || 'Guide').trim() || 'Guide'),
                    text,
                    dialogueTurns,
                    sceneTitle: String(scene?.sceneTitle || '').trim(),
                    objective: String(scene?.objective || '').trim(),
                    advanceHint: String(scene?.advanceHint || '').trim(),
                    editorComment: String(scene?.editorComment || '').trim(),
                    starterSql: String(scene?.starterSql || '').trim(),
                    successMessage: String(scene?.successMessage || '').trim(),
                    unlockIds: normalizeSqlCoreUnlockInputIds(scene?.unlockIds || []),
                    advanceOn: scene?.advanceOn && typeof scene.advanceOn === 'object' && !Array.isArray(scene.advanceOn)
                        ? deepClone(scene.advanceOn)
                        : null
                };
            })
            .filter(Boolean);
    }

    function computeSpeakerHue(speaker = 'Guide') {
        const input = String(speaker || 'Guide');
        let hash = 0;
        for (let index = 0; index < input.length; index += 1) {
            hash = ((hash << 5) - hash) + input.charCodeAt(index);
            hash |= 0;
        }
        return Math.abs(hash) % 360;
    }

    function setStoryAutoAdvanceNotice(text = '', durationMs = 2200) {
        storyAutoAdvanceNoticeText = String(text || '').trim();
        if (storyAutoAdvanceNoticeTimer) {
            clearTimeout(storyAutoAdvanceNoticeTimer);
            storyAutoAdvanceNoticeTimer = null;
        }
        if (!storyAutoAdvanceNoticeText) return;
        storyAutoAdvanceNoticeTimer = setTimeout(() => {
            storyAutoAdvanceNoticeText = '';
            storyAutoAdvanceNoticeTimer = null;
            updateGuideWindowStoryHint();
        }, Math.max(600, Number(durationMs) || 2200));
    }

    function describeStoryAdvanceRule(advanceOn = null) {
        if (!advanceOn || typeof advanceOn !== 'object' || Array.isArray(advanceOn)) {
            return 'Auto-Fortschritt bei erfolgreichem SQL-Run.';
        }

        const checkType = String(advanceOn.type || '').trim().toLowerCase();
        if (checkType === 'statement-contains' && Array.isArray(advanceOn.tokens) && advanceOn.tokens.length > 0) {
            return `Bedingung: SQL enthaelt ${advanceOn.tokens.join(' + ')}.`;
        }
        if (checkType === 'statement-regex' && advanceOn.pattern) {
            return `Bedingung: SQL passt auf /${String(advanceOn.pattern)}/.`;
        }
        if (Array.isArray(advanceOn.all) && advanceOn.all.length > 0) {
            return 'Bedingung: alle Teilbedingungen erfuellen.';
        }
        if (Array.isArray(advanceOn.any) && advanceOn.any.length > 0) {
            return 'Bedingung: mindestens eine Teilbedingung erfuellen.';
        }
        return 'Bedingung: Szenen-Check erfuellen.';
    }

    function normalizeStoryHintSqlText(value = '') {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/;+\s*$/u, '');
    }

    function unwrapStoryHintSqlText(value = '') {
        let normalized = String(value || '').trim();
        normalized = normalized.replace(/^\s*Fuehre\s+aus:\s*/iu, '');
        normalized = normalized.replace(/^\s*Nutze\s+/iu, '');
        normalized = normalized.trim();
        const wrappedMatch = normalized.match(/^`(.+)`\.?$/u);
        if (wrappedMatch) {
            normalized = String(wrappedMatch[1] || '').trim();
        }
        return normalizeStoryHintSqlText(normalized);
    }

    function looksLikeSqlSolutionText(value = '') {
        const normalized = String(value || '').trim();
        if (!normalized) return false;
        if (!/^(Fuehre\s+aus:|Nutze\b)/iu.test(normalized)) return false;
        return /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE)\b/iu.test(normalized);
    }

    function joinStoryHintFragments(fragments = []) {
        const safeFragments = (Array.isArray(fragments) ? fragments : [])
            .map((entry) => String(entry || '').trim())
            .filter(Boolean);
        if (safeFragments.length === 0) return '';
        if (safeFragments.length === 1) return safeFragments[0];
        if (safeFragments.length === 2) return `${safeFragments[0]} und ${safeFragments[1]}`;
        return `${safeFragments.slice(0, -1).join(', ')} und ${safeFragments[safeFragments.length - 1]}`;
    }

    function formatStoryHintWrappedList(values = []) {
        const safeValues = [...new Set((Array.isArray(values) ? values : [])
            .map((entry) => String(entry || '').trim())
            .filter(Boolean))];
        return joinStoryHintFragments(safeValues.map((entry) => `\`${entry}\``));
    }

    function summarizeStoryCreateTableHint(sql = '') {
        const normalized = normalizeStoryHintSqlText(sql);
        const tableMatch = normalized.match(/^CREATE\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s*\((.+)\)$/iu);
        if (!tableMatch) {
            return 'Nutze CREATE TABLE und vergebe die geforderten Datentypen.';
        }

        const tableName = String(tableMatch[1] || '').trim();
        const columnDefs = String(tableMatch[2] || '')
            .split(',')
            .map((part) => String(part || '').trim())
            .map((part) => {
                const match = part.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z][A-Za-z0-9()]*)/u);
                if (!match) return '';
                return `${match[1]} ${String(match[2] || '').toUpperCase()}`;
            })
            .filter(Boolean);

        if (columnDefs.length === 0) {
            return `Lege \`${tableName}\` an und vergebe die geforderten Datentypen.`;
        }

        return `Lege \`${tableName}\` an und verwende diese Spaltentypen: ${formatStoryHintWrappedList(columnDefs)}.`;
    }

    function summarizeStoryInsertHint(sql = '') {
        const normalized = normalizeStoryHintSqlText(sql);
        const tableMatch = normalized.match(/^INSERT\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)/iu);
        if (!tableMatch) {
            return 'Nutze INSERT INTO und trage die geforderten Werte in die passenden Spalten ein.';
        }

        const tableName = String(tableMatch[1] || '').trim();
        return `Nutze INSERT INTO fuer \`${tableName}\` und trage die geforderten Werte in die passenden Spalten ein.`;
    }

    function summarizeStoryUpdateHint(sql = '') {
        const normalized = normalizeStoryHintSqlText(sql);
        const tableMatch = normalized.match(/^UPDATE\s+([A-Za-z_][A-Za-z0-9_]*)\s+/iu);
        if (!tableMatch) {
            return 'Nutze UPDATE, setze die benoetigten Werte neu und grenze die betroffenen Zeilen mit WHERE ein.';
        }

        const tableName = String(tableMatch[1] || '').trim();
        const setMatch = normalized.match(/\bSET\s+(.+?)(?:\bWHERE\b|$)/iu);
        const setColumns = String(setMatch?.[1] || '')
            .split(',')
            .map((part) => String(part || '').trim())
            .map((part) => {
                const match = part.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/u);
                return match ? String(match[1] || '').trim() : '';
            })
            .filter(Boolean);
        const columnText = setColumns.length > 0
            ? ` und setze ${formatStoryHintWrappedList(setColumns)} neu`
            : '';
        const whereText = /\bWHERE\b/iu.test(normalized)
            ? ' und grenze die betroffenen Zeilen mit WHERE ein'
            : '';
        return `Nutze UPDATE auf \`${tableName}\`${columnText}${whereText}.`;
    }

    function summarizeStoryDeleteHint(sql = '') {
        const normalized = normalizeStoryHintSqlText(sql);
        const tableMatch = normalized.match(/^DELETE\s+FROM\s+([A-Za-z_][A-Za-z0-9_]*)/iu);
        if (!tableMatch) {
            return 'Nutze DELETE FROM und grenze die betroffenen Zeilen mit WHERE ein.';
        }

        const tableName = String(tableMatch[1] || '').trim();
        const whereText = /\bWHERE\b/iu.test(normalized)
            ? ' und grenze die betroffenen Zeilen mit WHERE ein'
            : '';
        return `Nutze DELETE FROM fuer \`${tableName}\`${whereText}.`;
    }

    function summarizeStorySelectHint(sql = '') {
        const normalized = normalizeStoryHintSqlText(sql);
        const tables = [...new Set(
            [...normalized.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)\b/giu)]
                .map((match) => String(match[1] || '').trim())
                .filter(Boolean)
        )];
        const fragments = [];

        if (/\bJOIN\b/iu.test(normalized)) fragments.push('verbinde die Tabellen per JOIN');
        if (/\bWHERE\b/iu.test(normalized)) fragments.push('filtere mit WHERE');
        if (/\bGROUP\s+BY\b/iu.test(normalized)) fragments.push('gruppiere mit GROUP BY');
        if (/\bHAVING\b/iu.test(normalized)) fragments.push('pruefe die Gruppen mit HAVING');
        if (/\bORDER\s+BY\b/iu.test(normalized)) fragments.push('sortiere mit ORDER BY');
        if (/\bDISTINCT\b/iu.test(normalized)) fragments.push('verwende DISTINCT');
        if (/\(\s*SELECT\b/iu.test(normalized)) fragments.push('arbeite mit einer Unterabfrage');

        const aggregateTokens = [];
        if (/\bCOUNT\s*\(/iu.test(normalized)) aggregateTokens.push('COUNT');
        if (/\bSUM\s*\(/iu.test(normalized)) aggregateTokens.push('SUM');
        if (/\bAVG\s*\(/iu.test(normalized)) aggregateTokens.push('AVG');
        if (aggregateTokens.length > 0) {
            fragments.push(`nutze ${joinStoryHintFragments(aggregateTokens)} fuer die Auswertung`);
        }

        const tableText = tables.length > 0
            ? ` auf ${formatStoryHintWrappedList(tables)}`
            : '';
        const fragmentText = joinStoryHintFragments(fragments);
        if (!fragmentText) {
            return `Nutze SELECT${tableText}.`;
        }
        return `Nutze SELECT${tableText}, ${fragmentText}.`;
    }

    function summarizeStorySqlHint(sql = '') {
        const normalized = normalizeStoryHintSqlText(sql);
        if (!normalized) return '';
        if (/^CREATE\s+TABLE\b/iu.test(normalized)) return summarizeStoryCreateTableHint(normalized);
        if (/^INSERT\s+INTO\b/iu.test(normalized)) return summarizeStoryInsertHint(normalized);
        if (/^UPDATE\b/iu.test(normalized)) return summarizeStoryUpdateHint(normalized);
        if (/^DELETE\s+FROM\b/iu.test(normalized)) return summarizeStoryDeleteHint(normalized);
        if (/^SELECT\b/iu.test(normalized)) return summarizeStorySelectHint(normalized);
        return '';
    }

    function resolveStorySceneAdvanceHint(scene = null) {
        if (!scene) return '';
        const explicitHint = String(scene.advanceHint || '').trim();
        if (explicitHint && !looksLikeSqlSolutionText(explicitHint)) {
            return explicitHint;
        }

        const hintSql = String(scene.starterSql || '').trim() || unwrapStoryHintSqlText(explicitHint);
        const summarizedHint = summarizeStorySqlHint(hintSql);
        if (summarizedHint) return summarizedHint;
        if (explicitHint) return explicitHint;
        return describeStoryAdvanceRule(scene.advanceOn);
    }

    function getActiveStorySceneData(storyTitleConfig = activeStoryTitleConfig) {
        const storyScenes = collectGuideScenes(storyTitleConfig);
        if (!storyTitleConfig || storyScenes.length === 0) {
            return { scene: null, sceneIndex: 0, sceneCount: 0, scenes: storyScenes };
        }

        const runtimeEntry = getStoryRuntimeEntry(storyTitleConfig);
        const sceneIndex = clampStorySceneIndex(
            storyTitleConfig.id === activeStoryTitleId
                ? activeStorySceneIndex
                : (runtimeEntry?.sceneIndex || 0),
            storyScenes.length
        );
        const scene = storyScenes[sceneIndex] || null;
        return {
            scene,
            sceneIndex,
            sceneCount: storyScenes.length,
            scenes: storyScenes
        };
    }

    function isStorySceneReady(storyTitleConfig = activeStoryTitleConfig, scene = null) {
        if (!storyTitleConfig || !scene) return false;
        const runtimeEntry = getStoryRuntimeEntry(storyTitleConfig);
        return storyProgressLiveChecks.isStorySceneReady(runtimeEntry, scene);
    }

    function isStoryTitleReady(storyTitleConfig = null) {
        if (!storyTitleConfig) return false;
        const runtimeEntry = getStoryRuntimeEntry(storyTitleConfig);
        if (!runtimeEntry) return false;
        if (runtimeEntry.completed) return true;
        return storyProgressLiveChecks.normalizeStoryReadySceneIds(runtimeEntry.readySceneIds).length > 0;
    }

    function markStorySceneReady(storyTitleConfig = activeStoryTitleConfig, scene = null, options = {}) {
        const { suppressNotice = false } = options;
        if (!storyTitleConfig || !scene) {
            return { isReady: false, hasChanges: false };
        }

        const runtimeEntry = getStoryRuntimeEntry(storyTitleConfig);
        if (!runtimeEntry) {
            return { isReady: false, hasChanges: false };
        }

        if (!scene.advanceOn) {
            return { isReady: true, hasChanges: false };
        }

        const readyResult = storyProgressLiveChecks.markStorySceneReady(runtimeEntry, scene.id);
        runtimeEntry.readySceneIds = readyResult.readySceneIds;
        if (!readyResult.hasChanges) {
            return readyResult;
        }

        applySqlCoreStorySceneSuccessBridge(scene);
        persistStoryProgress();
        if (!suppressNotice) {
            const noticeText = String(scene.successMessage || '').trim() || 'Kapitel freigeschaltet. Mit Fertig weiter.';
            setStoryAutoAdvanceNotice(noticeText, 3200);
        }
        return readyResult;
    }

    function evaluateActiveStorySceneProgress(parseResult = null, options = {}) {
        const { showBlockedNotice = false } = options;
        if (!activeStoryTitleConfig || !parseResult || parseResult.error) return false;
        if (hasErrorDiagnostics(parseResult.diagnostics || [])) return false;
        const { scene } = getActiveStorySceneData(activeStoryTitleConfig);
        if (!scene) return false;

        if (isActiveStorySceneAdvanceConditionSatisfied(parseResult)) {
            const readyResult = markStorySceneReady(activeStoryTitleConfig, scene);
            if (readyResult.hasChanges) {
                updateGuideWindowStoryHint();
                renderLessonTree(tutorialTreeModel);
            }
            return true;
        }

        if (showBlockedNotice) {
            const sceneHint = getActiveStorySceneAdvanceHint();
            const hintText = sceneHint ? `Noch gesperrt: ${sceneHint}` : 'Noch gesperrt: Szenenbedingung nicht erfuellt.';
            setStoryAutoAdvanceNotice(hintText, 3200);
            updateGuideWindowStoryHint();
        }

        return false;
    }

    function isActiveStorySceneAdvanceConditionSatisfied(parseResult = null) {
        if (!activeStoryTitleConfig || !parseResult || parseResult.error) return false;
        if (hasErrorDiagnostics(parseResult.diagnostics || [])) return false;
        const { scene } = getActiveStorySceneData(activeStoryTitleConfig);
        if (!scene) return false;
        if (!scene.advanceOn) return true;
        const checkContext = {
            selectPreviews: collectSelectResultPreviews(parseResult, 256)
        };
        return isTaskCheckSolved(scene.advanceOn, parseResult, checkContext);
    }

    function getActiveStorySceneAdvanceHint() {
        const { scene } = getActiveStorySceneData(activeStoryTitleConfig);
        if (!scene) return '';
        return resolveStorySceneAdvanceHint(scene);
    }

    function advanceActiveStorySceneFromReadyState() {
        if (!activeStoryTitleConfig) return;
        const storyScenes = collectGuideScenes(activeStoryTitleConfig);
        if (storyScenes.length === 0) return;
        const currentScene = storyScenes[activeStorySceneIndex] || null;
        if (!currentScene) return;
        if (!isStorySceneReady(activeStoryTitleConfig, currentScene)) {
            const sceneHint = resolveStorySceneAdvanceHint(currentScene);
            const hintText = sceneHint ? `Noch gesperrt: ${sceneHint}` : 'Noch gesperrt: Gib zuerst den passenden SQL-Befehl ein.';
            setStoryAutoAdvanceNotice(hintText, 3200);
            updateGuideWindowStoryHint();
            return;
        }

        const runtimeEntry = getStoryRuntimeEntry(activeStoryTitleConfig);
        if (!runtimeEntry) return;

        const storyIds = (Array.isArray(storyTreeModel?.titles) ? storyTreeModel.titles : [])
            .map((storyTitle) => String(storyTitle?.id || '').trim())
            .filter(Boolean);
        const advanceResult = storyProgressLiveChecks.advanceStoryProgress({
            storyIds,
            activeStoryId: activeStoryTitleConfig.id,
            sceneCount: storyScenes.length,
            sceneIndex: activeStorySceneIndex,
            currentSceneReady: true,
            completedStory: runtimeEntry.completed
        });

        if (!advanceResult.allowed) {
            updateGuideWindowStoryHint();
            return;
        }

        runtimeEntry.sceneIndex = clampStorySceneIndex(activeStorySceneIndex, storyScenes.length);
        runtimeEntry.completed = Boolean(advanceResult.completedStory);
        runtimeEntry.status = runtimeEntry.completed ? 'gelesen' : 'aktiv';

        if (!advanceResult.completedStory) {
            activeStorySceneIndex = clampStorySceneIndex(advanceResult.nextSceneIndex, storyScenes.length);
            runtimeEntry.sceneIndex = activeStorySceneIndex;
            setStoryAutoAdvanceNotice('Szene abgeschlossen. Naechste Szene geoeffnet.', 3200);
        } else if (advanceResult.openedNextStory) {
            const nextStoryTitle = getStoryTitleById(advanceResult.nextStoryId);
            activeGuideSelectionScope = 'story';
            activeStoryTitleId = nextStoryTitle?.id || '';
            activeStoryTitleConfig = nextStoryTitle || null;
            const nextRuntimeEntry = getStoryRuntimeEntry(nextStoryTitle);
            if (nextRuntimeEntry) {
                nextRuntimeEntry.status = nextRuntimeEntry.completed ? 'gelesen' : 'aktiv';
                activeStorySceneIndex = clampStorySceneIndex(nextRuntimeEntry.sceneIndex, getStorySceneCount(nextStoryTitle));
                nextRuntimeEntry.sceneIndex = activeStorySceneIndex;
            } else {
                activeStorySceneIndex = 0;
            }
            setStoryAutoAdvanceNotice('Kapitel abgeschlossen. Naechster Teil geoeffnet.', 3200);
        } else {
            setStoryAutoAdvanceNotice('Story abgeschlossen.', 3200);
        }

        persistStoryProgress();
        scheduleLiveStoryReadinessEvaluation(0);
        updateGuideWindowStoryHint();
        renderLessonTree(tutorialTreeModel);
    }

    function navigateActiveStoryScene(direction = 1) {
        if (!activeStoryTitleConfig) return;
        const storyScenes = collectGuideScenes(activeStoryTitleConfig);
        if (storyScenes.length === 0) return;

        const runtimeEntry = getStoryRuntimeEntry(activeStoryTitleConfig);
        if (!runtimeEntry) return;
        const delta = direction < 0 ? -1 : 1;
        const nextSceneIndex = clampStorySceneIndex(activeStorySceneIndex + delta, storyScenes.length);

        if (nextSceneIndex !== activeStorySceneIndex) {
            activeStorySceneIndex = nextSceneIndex;
            runtimeEntry.sceneIndex = nextSceneIndex;
        }

        runtimeEntry.status = 'aktiv';
        setStoryAutoAdvanceNotice('');

        persistStoryProgress();
        updateGuideWindowStoryHint();
        renderLessonTree(tutorialTreeModel);
    }

    function renderGuideWindowStoryStage(storyTitleConfig = activeStoryTitleConfig, scenes = null) {
        if (!guideStoryStageEl) return;
        guideStoryStageEl.innerHTML = '';
        const storyScenes = Array.isArray(scenes) ? scenes : collectGuideScenes(storyTitleConfig);
        if (!storyTitleConfig || storyScenes.length === 0) {
            guideStoryStageEl.classList.add('is-empty');
            return;
        }

        const runtimeEntry = getStoryRuntimeEntry(storyTitleConfig);
        const sceneCount = storyScenes.length;
        activeStorySceneIndex = clampStorySceneIndex(
            storyTitleConfig.id === activeStoryTitleId
                ? activeStorySceneIndex
                : (runtimeEntry?.sceneIndex || 0),
            sceneCount
        );
        if (runtimeEntry) {
            runtimeEntry.sceneIndex = activeStorySceneIndex;
        }
        const activeScene = storyScenes[activeStorySceneIndex] || storyScenes[0];
        const activeSceneReady = isStorySceneReady(storyTitleConfig, activeScene);

        guideStoryStageEl.classList.remove('is-empty');

        const header = document.createElement('header');
        header.className = 'guide-story-header';

        const controlsEl = document.createElement('div');
        controlsEl.className = 'guide-story-controls';

        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'guide-story-nav-btn';
        prevBtn.textContent = 'Zurück';
        prevBtn.disabled = activeStorySceneIndex <= 0;
        prevBtn.addEventListener('click', () => navigateActiveStoryScene(-1));

        const counterEl = document.createElement('span');
        counterEl.className = 'guide-story-counter';
        counterEl.textContent = `${activeStorySceneIndex + 1} / ${sceneCount}`;

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'guide-story-nav-btn';
        nextBtn.textContent = activeStorySceneIndex >= sceneCount - 1 ? 'Fertig' : 'Weiter';
        nextBtn.disabled = !activeSceneReady;
        if (activeSceneReady) {
            nextBtn.classList.add('is-ready');
        }
        nextBtn.addEventListener('click', () => advanceActiveStorySceneFromReadyState());

        controlsEl.appendChild(prevBtn);
        controlsEl.appendChild(counterEl);
        controlsEl.appendChild(nextBtn);
        header.appendChild(controlsEl);

        if (activeScene) {
            const gateEl = document.createElement('div');
            gateEl.className = 'guide-story-gate';
            if (activeSceneReady) {
                gateEl.classList.add('is-ready');
            }
            gateEl.textContent = resolveStorySceneAdvanceHint(activeScene);
            header.appendChild(gateEl);

            if (activeScene.sceneTitle || activeScene.objective) {
                const missionEl = document.createElement('section');
                missionEl.className = 'guide-story-mission';

                if (activeScene.objective) {
                    const missionTextEl = document.createElement('p');
                    missionTextEl.className = 'guide-story-mission-text';
                    missionTextEl.textContent = activeScene.objective;
                    missionEl.appendChild(missionTextEl);
                }

                header.appendChild(missionEl);
            }
        }

        if (storyAutoAdvanceNoticeText) {
            const noticeEl = document.createElement('div');
            noticeEl.className = 'guide-story-advance-notice';
            noticeEl.textContent = storyAutoAdvanceNoticeText;
            header.appendChild(noticeEl);
        }

        guideStoryStageEl.appendChild(header);

        const sceneList = document.createElement('div');
        sceneList.className = 'guide-scene-list';
        const dialogueTurns = normalizeGuideDialogueTurns(activeScene);

        dialogueTurns.forEach((turn, turnIndex) => {
            const alignRight = (activeStorySceneIndex + turnIndex) % 2 === 1;
            const row = document.createElement('article');
            row.className = `guide-scene-row ${alignRight ? 'side-right' : 'side-left'}`;
            row.style.setProperty('--scene-delay-ms', `${turnIndex * 70}ms`);

            const avatar = document.createElement('div');
            avatar.className = 'guide-avatar';
            avatar.style.setProperty('--speaker-hue', String(computeSpeakerHue(turn.speaker)));

            const face = document.createElement('span');
            face.className = 'guide-avatar-face';
            face.setAttribute('aria-hidden', 'true');

            const name = document.createElement('span');
            name.className = 'guide-avatar-name';
            name.textContent = turn.speaker;

            avatar.appendChild(face);
            avatar.appendChild(name);

            const bubble = document.createElement('div');
            bubble.className = 'guide-speech-bubble';

            const text = document.createElement('p');
            text.className = 'guide-speech-text';
            text.textContent = turn.text;
            bubble.appendChild(text);

            if (alignRight) {
                row.appendChild(bubble);
                row.appendChild(avatar);
            } else {
                row.appendChild(avatar);
                row.appendChild(bubble);
            }

            sceneList.appendChild(row);
        });

        guideStoryStageEl.appendChild(sceneList);
    }

    function updateGuideWindowStoryHint() {
        syncGuideWindowVisibility();
        if (!isGuideWindowStorySelectionActive()) {
            renderGuideWindowStoryStage(null, []);
            if (guideWindowNoteEl) {
                guideWindowNoteEl.classList.remove('is-hidden');
                guideWindowNoteEl.textContent = defaultGuideWindowNoteText || 'Guide-Window bereit.';
            }
            return;
        }

        const storyScenes = collectGuideScenes(activeStoryTitleConfig);
        renderGuideWindowStoryStage(activeStoryTitleConfig, storyScenes);

        if (!guideWindowNoteEl) return;
        if (!activeStoryTitleConfig) {
            guideWindowNoteEl.classList.remove('is-hidden');
            guideWindowNoteEl.textContent = defaultGuideWindowNoteText || 'Guide-Window bereit.';
            return;
        }

        if (storyScenes.length === 0) {
            guideWindowNoteEl.classList.remove('is-hidden');
            guideWindowNoteEl.textContent = `Story aktiv: ${activeStoryTitleConfig.title}`;
            return;
        }

        guideWindowNoteEl.classList.add('is-hidden');
        guideWindowNoteEl.textContent = defaultGuideWindowNoteText || 'Guide-Window bereit.';
    }

    function activateStoryTitle(storyTitleId) {
        const storyTitle = getStoryTitleById(storyTitleId);
        if (!storyTitle) return;
        const storyTitles = Array.isArray(storyTreeModel?.titles) ? storyTreeModel.titles : [];
        const requestedIndex = storyTitles.findIndex((entry) => entry.id === storyTitleId);
        const visibleUpperIndex = getStoryVisibleUpperIndex(storyTitles);
        if (requestedIndex > visibleUpperIndex) {
            return;
        }
        setStoryAutoAdvanceNotice('');

        if (activeStoryTitleConfig && activeStoryTitleConfig.id !== storyTitle.id) {
            const previousStoryRuntimeEntry = getStoryRuntimeEntry(activeStoryTitleConfig);
            if (previousStoryRuntimeEntry && previousStoryRuntimeEntry.status === 'aktiv') {
                previousStoryRuntimeEntry.status = previousStoryRuntimeEntry.completed ? 'gelesen' : 'neu';
            }
        }

        activeGuideSelectionScope = 'story';
        hasExplicitStorySelection = true;
        activeStoryTitleId = storyTitle.id;
        activeStoryTitleConfig = storyTitle;
        const runtimeEntry = getStoryRuntimeEntry(storyTitle);
        const sceneCount = getStorySceneCount(storyTitle);
        if (runtimeEntry) {
            runtimeEntry.status = 'aktiv';
            activeStorySceneIndex = clampStorySceneIndex(runtimeEntry.sceneIndex, sceneCount);
            runtimeEntry.sceneIndex = activeStorySceneIndex;
        } else {
            activeStorySceneIndex = 0;
        }

        persistStoryProgress();
        updateGuideWindowStoryHint();
        renderLessonTree(tutorialTreeModel);
    }

    function createFallbackLessonsForTool(toolLabel = '') {
        const toolCode = extractToolCode(toolLabel);
        return [
            {
                id: `${sanitizeClassName(toolLabel)}-overview`,
                title: 'Übersicht',
                keyword: String(toolCode || 'sql').toUpperCase(),
                level: 1,
                body: 'Lektion folgt in folderTree.json.',
                tasks: [],
                commandRange: '0-1 SQL-Commands',
                children: [],
                databaseProfile: '',
                databaseSnapshot: null
            }
        ];
    }

    function normalizeLessonNode(node, fallbackPrefix, fallbackIndex) {
        const safeId = String(node?.id || `${fallbackPrefix}-lesson-${fallbackIndex}`).trim() || `${fallbackPrefix}-lesson-${fallbackIndex}`;
        const safeTitle = stripTokenIdFromTitle(String(node?.title || `Lektion ${fallbackIndex}`))
            || `Lektion ${fallbackIndex}`;
        const safeLevel = Math.max(1, Number(node?.level) || 1);
        const safeKeyword = String(node?.keyword || inferLessonKeyword(safeTitle)).trim() || 'SQL';
        const bodyText = Array.isArray(node?.bodyLines)
            ? node.bodyLines.join('\n').trim()
            : String(node?.body || '').trim();
        const tasks = Array.isArray(node?.tasks)
            ? node.tasks.map((task, taskIndex) => {
                const taskText = String(task?.text || 'Aufgabe');
                const derivedCheck = task?.check || lessonTaskLiveChecks.deriveTaskCheck(taskText, {
                    lessonTitle: safeTitle,
                    lessonBody: bodyText,
                    keyword: safeKeyword
                });
                return {
                    id: String(task?.id || `${safeId}-task-${taskIndex + 1}`).trim() || `${safeId}-task-${taskIndex + 1}`,
                    text: taskText,
                    check: derivedCheck || null,
                    unlockIds: normalizeSqlCoreUnlockInputIds(task?.unlockIds || [])
                };
            })
            : [];
        const children = Array.isArray(node?.children)
            ? node.children.map((child, childIndex) => normalizeLessonNode(child, safeId, childIndex + 1))
            : [];

        return {
            id: safeId,
            title: safeTitle,
            keyword: safeKeyword,
            level: safeLevel,
            body: bodyText,
            tasks,
            commandRange: String(node?.commandRange || (tasks.length > 0 ? '1-n SQL-Commands' : '0-1 SQL-Commands')),
            children,
            databaseProfile: String(node?.databaseProfile || '').trim(),
            databaseSnapshot: node?.databaseSnapshot || null
        };
    }

    function flattenLessonTreeNodes(nodes = []) {
        const result = [];
        const walk = (entry) => {
            if (!entry) return;
            result.push(entry);
            (entry.children || []).forEach(walk);
        };
        nodes.forEach(walk);
        return result;
    }

    function buildLessonTreeModel(parsedTree = {}) {
        const rootLabel = String(parsedTree.rootLabel || LESSON_TREE_FALLBACK.rootLabel).trim() || LESSON_TREE_FALLBACK.rootLabel;
        const parsedTools = Array.isArray(parsedTree.tools) ? parsedTree.tools : [];

        const toolsFromTree = sortToolsByCanonicalOrder(parsedTools.map((tool, index) => {
            const safeLabel = String(tool?.label || `Werkzeug ${index + 1}`).trim() || `Werkzeug ${index + 1}`;
            const toolCode = extractToolCode(safeLabel);
            const fallbackPrefix = sanitizeClassName(safeLabel) || `tool-${index + 1}`;
            const rootsSource = Array.isArray(tool?.lessonRoots) && tool.lessonRoots.length > 0
                ? tool.lessonRoots
                : createFallbackLessonsForTool(safeLabel);
            const lessonRoots = rootsSource.map((lesson, lessonIndex) => normalizeLessonNode(lesson, fallbackPrefix, lessonIndex + 1));
            const modelEntry = {
                id: String(tool?.id || sanitizeClassName(safeLabel) || `tool-${index + 1}`),
                code: toolCode,
                label: safeLabel,
                lessonRoots,
                databaseSnapshot: buildToolDatabasePreset(toolCode)
            };
            assignLessonSnapshotsForTool(modelEntry);
            modelEntry.lessons = flattenLessonTreeNodes(modelEntry.lessonRoots);
            return modelEntry;
        }));

        if (toolsFromTree.length > 0) {
            return { rootLabel, tools: toolsFromTree };
        }

        const fallbackTools = sortToolsByCanonicalOrder(LESSON_TREE_FALLBACK.toolLabels.map((label, index) => {
            const safeLabel = String(label || `Werkzeug ${index + 1}`).trim() || `Werkzeug ${index + 1}`;
            const toolCode = extractToolCode(safeLabel);
            const modelEntry = {
                id: sanitizeClassName(safeLabel) || `tool-${index + 1}`,
                code: toolCode,
                label: safeLabel,
                lessonRoots: createFallbackLessonsForTool(safeLabel).map((lesson, lessonIndex) => normalizeLessonNode(lesson, sanitizeClassName(safeLabel) || `tool-${index + 1}`, lessonIndex + 1)),
                databaseSnapshot: buildToolDatabasePreset(toolCode)
            };
            assignLessonSnapshotsForTool(modelEntry);
            modelEntry.lessons = flattenLessonTreeNodes(modelEntry.lessonRoots);
            return modelEntry;
        }));

        return { rootLabel, tools: fallbackTools };
    }

    function validateTaskCheckDefinition(check, taskPath, issues) {
        if (!check || typeof check !== 'object') {
            issues.push(`${taskPath}: kein check-Objekt gesetzt`);
            return;
        }

        if (Array.isArray(check.all)) {
            if (check.all.length === 0) {
                issues.push(`${taskPath}: check.all ist leer`);
            } else {
                check.all.forEach((subCheck, index) => validateTaskCheckDefinition(subCheck, `${taskPath}.all[${index}]`, issues));
            }
            return;
        }

        if (Array.isArray(check.any)) {
            if (check.any.length === 0) {
                issues.push(`${taskPath}: check.any ist leer`);
            } else {
                check.any.forEach((subCheck, index) => validateTaskCheckDefinition(subCheck, `${taskPath}.any[${index}]`, issues));
            }
            return;
        }

        const type = String(check.type || '').trim();
        if (!type) {
            issues.push(`${taskPath}: check.type fehlt`);
            return;
        }

        if (!SUPPORTED_TASK_CHECK_TYPES.has(type)) {
            issues.push(`${taskPath}: unbekannter check.type "${type}"`);
        }
    }

    function validateLessonTaskChecks(model) {
        const tools = Array.isArray(model?.tools) ? model.tools : [];
        const issues = [];
        tools.forEach((tool) => {
            (tool.lessons || []).forEach((lesson) => {
                (lesson.tasks || []).forEach((task, taskIndex) => {
                    const taskPath = `${tool.label} > ${lesson.title} > task#${taskIndex + 1}`;
                    validateTaskCheckDefinition(task?.check, taskPath, issues);
                });
            });
        });
        return issues;
    }

    function validateLessonDatabaseProfiles(model) {
        const tools = Array.isArray(model?.tools) ? model.tools : [];
        const issues = [];
        tools.forEach((tool) => {
            (tool.lessons || []).forEach((lesson) => {
                const profile = normalizeLessonTitle(lesson?.databaseProfile || '');
                if (!profile) return;
                if (!SUPPORTED_DATABASE_PROFILES.has(profile)) {
                    issues.push(`${tool.label} > ${lesson.title}: unbekanntes databaseProfile "${profile}"`);
                }
            });
        });
        return issues;
    }

    function getLessonProgressSet(toolId, lessonId) {
        const lessonKey = makeLessonKey(toolId, lessonId);
        if (!lessonTaskProgress.has(lessonKey)) {
            lessonTaskProgress.set(lessonKey, new Set());
        }
        return lessonTaskProgress.get(lessonKey);
    }

    function hasTableWithColumns(tableName, requiredColumns = []) {
        const normalizedTable = String(tableName || '').toLowerCase();
        const table = parser.simulationData?.TABLES?.[normalizedTable];
        if (!table) return false;

        const existingColumns = new Set(
            (table.columns || []).map((col) => String(col?.name || col || '').toLowerCase())
        );
        return requiredColumns.every((columnName) => existingColumns.has(String(columnName || '').toLowerCase()));
    }

    function getTableColumnMeta(tableName, columnName) {
        const normalizedTable = String(tableName || '').toLowerCase();
        const normalizedColumn = String(columnName || '').toLowerCase();
        const table = parser.simulationData?.TABLES?.[normalizedTable];
        if (!table || !Array.isArray(table.columns)) return null;

        const column = table.columns.find((entry) => String(entry?.name || entry || '').toLowerCase() === normalizedColumn);
        if (!column) return null;

        if (typeof column === 'string') {
            return {
                name: normalizedColumn,
                type: 'TEXT',
                isPK: false,
                isUnique: false,
                isNotNull: false,
                isFK: false,
                fkTarget: ''
            };
        }

        const fkTarget = String(column?.fkTarget || '').toLowerCase();
        return {
            name: String(column?.name || normalizedColumn).toLowerCase(),
            type: String(column?.type || 'TEXT').replace(/\s+/g, '').toUpperCase(),
            isPK: Boolean(column?.isPK),
            isUnique: Boolean(column?.isUnique || column?.isPK),
            isNotNull: Boolean(column?.isNotNull || column?.notNull || column?.nullable === false || column?.isPK),
            isFK: Boolean(column?.isFK || fkTarget),
            fkTarget
        };
    }

    function hasTable(tableName) {
        const normalizedTable = String(tableName || '').toLowerCase();
        return Boolean(parser.simulationData?.TABLES?.[normalizedTable]);
    }

    function hasColumn(tableName, columnName) {
        return Boolean(getTableColumnMeta(tableName, columnName));
    }

    function getTableRowsAsObjects(tableName) {
        const normalizedTable = String(tableName || '').toLowerCase();
        const table = parser.simulationData?.TABLES?.[normalizedTable];
        if (!table) return [];

        const columns = Array.isArray(table.columns)
            ? table.columns.map((entry) => String(entry?.name || entry || '').toLowerCase()).filter(Boolean)
            : [];
        const rows = Array.isArray(table.rows) ? table.rows : [];

        return rows.map((row) => {
            if (Array.isArray(row)) {
                const record = {};
                columns.forEach((columnName, index) => {
                    record[columnName] = row[index];
                });
                return record;
            }
            const record = {};
            Object.entries(row || {}).forEach(([key, value]) => {
                record[String(key || '').toLowerCase()] = value;
            });
            return record;
        });
    }

    function rowMatchesWhere(row, where = {}) {
        const criteria = where && typeof where === 'object' ? where : {};
        const criteriaEntries = Object.entries(criteria);
        if (criteriaEntries.length === 0) return false;

        return criteriaEntries.every(([columnName, expectedValue]) => {
            const value = row?.[String(columnName || '').toLowerCase()];
            return compareSqlValues(value, '=', expectedValue);
        });
    }

    function matchesStatementRegex(parseResult, pattern, flags = 'i') {
        let regex = null;
        try {
            regex = new RegExp(pattern, flags || 'i');
        } catch (error) {
            return false;
        }
        const statements = Array.isArray(parseResult?.statements) ? parseResult.statements : [];
        return statements.some((statement) => regex.test(String(statement?.text || '')));
    }

    function statementContainsTokens(parseResult, tokens = []) {
        const normalizedTokens = (Array.isArray(tokens) ? tokens : [])
            .map((token) => String(token || '').trim().toLowerCase())
            .filter(Boolean);
        if (normalizedTokens.length === 0) return false;

        const statements = Array.isArray(parseResult?.statements) ? parseResult.statements : [];
        return statements.some((statement) => {
            const text = String(statement?.text || '').toLowerCase();
            return normalizedTokens.every((token) => text.includes(token));
        });
    }

    function collectSelectResultPreviews(parseResult, maxPreviewRows = 200) {
        const statements = Array.isArray(parseResult?.statements) ? parseResult.statements : [];
        return statements
            .filter((statement) => String(statement?.type || '').toUpperCase() === 'SELECT')
            .map((statement) => {
                const preview = evaluateSelectResult(statement.text, maxPreviewRows);
                if (!preview) return null;
                return {
                    statementIndex: Number(statement.index || 1),
                    columns: Array.isArray(preview.columns) ? [...preview.columns] : [],
                    rows: Array.isArray(preview.rows) ? preview.rows.map((row) => Array.isArray(row) ? [...row] : []) : [],
                    totalRows: Number(preview.totalRows || 0)
                };
            })
            .filter(Boolean);
    }

    function getSelectResultCandidates(selectPreviews = [], check = {}) {
        const previews = Array.isArray(selectPreviews) ? selectPreviews : [];
        if (previews.length === 0) return [];

        const explicitIndex = Number(check.statementIndex);
        if (Number.isFinite(explicitIndex) && explicitIndex > 0) {
            return previews.filter((preview) => preview.statementIndex === explicitIndex);
        }

        const mode = String(check.mode || 'last').toLowerCase();
        if (mode === 'any') return previews;
        return [previews[previews.length - 1]];
    }

    function normalizeResultValue(value) {
        return normalizeComparable(value);
    }

    function normalizeExpectedRows(expectedRows, columns = []) {
        const safeColumns = Array.isArray(columns) ? columns.map((entry) => String(entry || '')) : [];
        const rows = Array.isArray(expectedRows) ? expectedRows : [];
        return rows
            .map((row) => {
                if (Array.isArray(row)) return [...row];
                if (!row || typeof row !== 'object') return null;
                const normalizedRow = {};
                Object.entries(row).forEach(([key, value]) => {
                    normalizedRow[String(key || '').toLowerCase()] = value;
                });
                return safeColumns.map((columnName) => normalizedRow[String(columnName || '').toLowerCase()]);
            })
            .filter(Boolean);
    }

    function matchResultColumns(previewColumns = [], expectedColumns = [], ordered = true) {
        const current = (Array.isArray(previewColumns) ? previewColumns : []).map((entry) => String(entry || '').toLowerCase());
        const expected = (Array.isArray(expectedColumns) ? expectedColumns : []).map((entry) => String(entry || '').toLowerCase());
        if (current.length !== expected.length) return false;
        if (ordered) return current.every((column, index) => column === expected[index]);
        const currentSet = new Set(current);
        return expected.every((column) => currentSet.has(column));
    }

    function matchResultRows(previewRows = [], expectedRows = [], ordered = false) {
        const current = (Array.isArray(previewRows) ? previewRows : []).map((row) => JSON.stringify((Array.isArray(row) ? row : []).map(normalizeResultValue)));
        const expected = (Array.isArray(expectedRows) ? expectedRows : []).map((row) => JSON.stringify((Array.isArray(row) ? row : []).map(normalizeResultValue)));
        if (current.length !== expected.length) return false;

        if (ordered) {
            return current.every((row, index) => row === expected[index]);
        }

        const counts = new Map();
        current.forEach((rowKey) => counts.set(rowKey, (counts.get(rowKey) || 0) + 1));
        for (const expectedKey of expected) {
            const count = counts.get(expectedKey) || 0;
            if (count <= 0) return false;
            counts.set(expectedKey, count - 1);
        }
        return true;
    }

    function isTaskCheckSolved(check, parseResult, context = {}) {
        if (!check || typeof check !== 'object') return false;

        if (Array.isArray(check.all)) {
            if (check.all.length === 0) return false;
            return check.all.every((subCheck) => isTaskCheckSolved(subCheck, parseResult, context));
        }

        if (Array.isArray(check.any)) {
            if (check.any.length === 0) return false;
            return check.any.some((subCheck) => isTaskCheckSolved(subCheck, parseResult, context));
        }

        if (check.type === 'table-columns') {
            return hasTableWithColumns(check.table, check.columns || []);
        }
        if (check.type === 'table-exists') {
            return hasTable(check.table);
        }
        if (check.type === 'table-missing') {
            return !hasTable(check.table);
        }
        if (check.type === 'column-absent') {
            return !hasColumn(check.table, check.column);
        }
        if (check.type === 'column-renamed') {
            return hasColumn(check.table, check.to) && !hasColumn(check.table, check.from);
        }
        if (check.type === 'column-constraint') {
            const meta = getTableColumnMeta(check.table, check.column);
            if (!meta) return false;
            const flag = String(check.flag || '').trim();
            if (!flag || !(flag in meta)) return false;
            const expected = typeof check.value === 'boolean' ? check.value : true;
            return Boolean(meta[flag]) === expected;
        }
        if (check.type === 'column-fk-target') {
            const meta = getTableColumnMeta(check.table, check.column);
            if (!meta) return false;
            const target = String(check.target || '').toLowerCase();
            if (!target) return false;
            return String(meta.fkTarget || '').toLowerCase() === target;
        }
        if (check.type === 'schema-constraint') {
            const meta = getTableColumnMeta(check.table, check.column);
            if (!meta) return false;
            const constraint = String(check.constraint || '').trim().toLowerCase();
            if (constraint === 'pk' || constraint === 'primary-key') return Boolean(meta.isPK);
            if (constraint === 'unique') return Boolean(meta.isUnique);
            if (constraint === 'not-null' || constraint === 'notnull') return Boolean(meta.isNotNull);
            if (constraint === 'fk' || constraint === 'foreign-key') {
                if (!meta.isFK) return false;
                if (!check.target) return true;
                return String(meta.fkTarget || '').toLowerCase() === String(check.target || '').toLowerCase();
            }
            return false;
        }
        if (check.type === 'row-count') {
            const rows = getTableRowsAsObjects(check.table);
            const expected = Number(check.value);
            return Number.isFinite(expected) && rows.length === expected;
        }
        if (check.type === 'row-exists') {
            const rows = getTableRowsAsObjects(check.table);
            return rows.some((row) => rowMatchesWhere(row, check.where || {}));
        }
        if (check.type === 'row-missing') {
            const rows = getTableRowsAsObjects(check.table);
            return !rows.some((row) => rowMatchesWhere(row, check.where || {}));
        }
        if (check.type === 'statement-contains') {
            return statementContainsTokens(parseResult, check.tokens || []);
        }
        if (check.type === 'statement-regex' && check.pattern) {
            return matchesStatementRegex(parseResult, check.pattern, check.flags || 'i');
        }
        if (check.type === 'result-row-count') {
            const candidates = getSelectResultCandidates(context.selectPreviews, check);
            const expected = Number(check.value);
            if (!Number.isFinite(expected)) return false;
            return candidates.some((preview) => Number(preview.totalRows || preview.rows?.length || 0) === expected);
        }
        if (check.type === 'result-columns') {
            const candidates = getSelectResultCandidates(context.selectPreviews, check);
            const ordered = Boolean(check.ordered);
            return candidates.some((preview) => matchResultColumns(preview.columns || [], check.columns || [], ordered));
        }
        if (check.type === 'result-equals') {
            const candidates = getSelectResultCandidates(context.selectPreviews, check);
            const orderedColumns = check.columnOrder !== false;
            const orderedRows = Boolean(check.rowOrder);
            return candidates.some((preview) => {
                const previewColumns = preview.columns || [];
                const expectedColumns = Array.isArray(check.columns) ? check.columns : previewColumns;
                if (!matchResultColumns(previewColumns, expectedColumns, orderedColumns)) return false;
                const expectedRows = normalizeExpectedRows(check.rows || [], expectedColumns);
                return matchResultRows(preview.rows || [], expectedRows, orderedRows);
            });
        }
        return false;
    }

    function isLessonTaskSolved(task, parseResult, context = {}) {
        return isTaskCheckSolved(task?.check || {}, parseResult, context);
    }

    function collectSqlCoreUnlockIdsFromTasks(tasks = []) {
        const source = Array.isArray(tasks) ? tasks : [];
        const unlockIds = [];
        source.forEach((task) => {
            normalizeSqlCoreUnlockInputIds(task?.unlockIds || []).forEach((itemId) => unlockIds.push(itemId));
        });
        return [...new Set(unlockIds)];
    }

    function recordSqlCoreCompletedTaskIds(taskIds = []) {
        const normalizedTaskIds = normalizeSqlCoreUnlockInputIds(taskIds);
        const result = {
            requestedTaskIds: normalizedTaskIds,
            addedTaskIds: [],
            persisted: false
        };
        if (normalizedTaskIds.length === 0) {
            result.persisted = true;
            return result;
        }

        const currentSnapshot = refreshSqlCoreProgressSnapshot({ persistNormalized: true });
        const nextCompletedTaskIds = currentSnapshot?.completedTaskIds instanceof Set
            ? new Set(currentSnapshot.completedTaskIds)
            : new Set();

        normalizedTaskIds.forEach((taskId) => {
            if (nextCompletedTaskIds.has(taskId)) return;
            nextCompletedTaskIds.add(taskId);
            result.addedTaskIds.push(taskId);
        });

        if (result.addedTaskIds.length === 0) {
            result.persisted = true;
            return result;
        }

        const nextSnapshot = {
            schema: currentSnapshot?.schema || (Number(sqlCoreCatalogMeta?.storageSchema) || 1),
            unlockedIds: currentSnapshot?.unlockedIds instanceof Set
                ? new Set(currentSnapshot.unlockedIds)
                : new Set(),
            completedTaskIds: nextCompletedTaskIds
        };
        result.persisted = persistSqlCoreProgressSnapshot(nextSnapshot);
        if (result.persisted) {
            sqlCoreProgressSnapshot = nextSnapshot;
        } else {
            refreshSqlCoreProgressSnapshot();
        }

        return result;
    }

    function applySqlCoreTaskSuccessBridge(newlyCompletedTasks = []) {
        const tasks = Array.isArray(newlyCompletedTasks) ? newlyCompletedTasks : [];
        const completedTaskIds = tasks
            .map((task) => String(task?.id || '').trim())
            .filter(Boolean);
        const unlockIds = collectSqlCoreUnlockIdsFromTasks(tasks);
        const completedTaskResult = recordSqlCoreCompletedTaskIds(completedTaskIds);
        const unlockResult = unlockIds.length > 0
            ? unlockSqlCoreItems(unlockIds)
            : {
                requestedIds: [],
                validIds: [],
                addedIds: [],
                ignoredIds: [],
                persisted: true,
                hasChanges: false,
                storageKey: String(sqlCoreCatalogMeta?.storageKey || '').trim(),
                schema: Number(sqlCoreCatalogMeta?.storageSchema) || 1,
                delta: {
                    addedIds: [],
                    addedCount: 0
                }
            };

        return {
            completedTaskIds,
            unlockIds,
            completedTaskResult,
            unlockResult
        };
    }

    function applySqlCoreStorySceneSuccessBridge(scene = null) {
        const sceneId = String(scene?.id || '').trim();
        const unlockIds = normalizeSqlCoreUnlockInputIds(scene?.unlockIds || []);
        const completedTaskResult = sceneId
            ? recordSqlCoreCompletedTaskIds([`story_scene:${sceneId}`])
            : {
                requestedTaskIds: [],
                addedTaskIds: [],
                persisted: true
            };
        const unlockResult = unlockIds.length > 0
            ? unlockSqlCoreItems(unlockIds)
            : {
                requestedIds: [],
                validIds: [],
                addedIds: [],
                ignoredIds: [],
                persisted: true,
                hasChanges: false,
                storageKey: String(sqlCoreCatalogMeta?.storageKey || '').trim(),
                schema: Number(sqlCoreCatalogMeta?.storageSchema) || 1,
                delta: {
                    addedIds: [],
                    addedCount: 0
                }
            };

        return {
            sceneId,
            unlockIds,
            completedTaskResult,
            unlockResult
        };
    }

    function evaluateActiveLessonTasks(parseResult) {
        if (!activeLessonConfig || !Array.isArray(activeLessonConfig.tasks) || activeLessonConfig.tasks.length === 0) return;

        const progressSet = getLessonProgressSet(activeToolId, activeLessonId);
        const lessonKey = makeLessonKey(activeToolId, activeLessonId);
        const newlyCompletedTaskIds = [];
        const newlyCompletedTasks = [];
        const checkContext = {
            selectPreviews: collectSelectResultPreviews(parseResult, 256)
        };

        activeLessonConfig.tasks.forEach((task) => {
            const taskId = String(task?.id || '').trim();
            if (!taskId || progressSet.has(taskId)) return;

            if (isLessonTaskSolved(task, parseResult, checkContext)) {
                progressSet.add(taskId);
                newlyCompletedTaskIds.push(taskId);
                newlyCompletedTasks.push(task);
                lessonTaskAnimationQueue.add(`${lessonKey}:${taskId}`);
            }
        });

        if (newlyCompletedTaskIds.length === 0) return;
        applySqlCoreTaskSuccessBridge(newlyCompletedTasks);
        renderLessonTree(tutorialTreeModel);

        setTimeout(() => {
            newlyCompletedTaskIds.forEach((taskId) => lessonTaskAnimationQueue.delete(`${lessonKey}:${taskId}`));
            renderLessonTree(tutorialTreeModel);
        }, 900);
    }

    function evaluateActiveLessonTasksFromEditor() {
        if (!activeLessonConfig || !Array.isArray(activeLessonConfig.tasks) || activeLessonConfig.tasks.length === 0) return;
        const sql = String(editor.getValue() || '').trim();
        if (!sql) return;
        const parseResult = parser.parse(sql);
        if (!parseResult || parseResult.error || hasErrorDiagnostics(parseResult.diagnostics || [])) return;
        evaluateActiveLessonTasks(parseResult);
    }

    function scheduleLiveLessonTaskEvaluation(delayMs = 140) {
        if (liveLessonTaskEvaluationTimer) {
            clearTimeout(liveLessonTaskEvaluationTimer);
            liveLessonTaskEvaluationTimer = null;
        }
        liveLessonTaskEvaluationTimer = window.setTimeout(() => {
            liveLessonTaskEvaluationTimer = null;
            evaluateActiveLessonTasksFromEditor();
        }, Math.max(0, Number(delayMs) || 0));
    }

    function evaluateActiveStoryReadinessFromEditor() {
        if (!isGuideWindowStorySelectionActive() || !activeStoryTitleConfig) return;
        const sql = String(editor.getValue() || '').trim();
        if (!sql) return;
        const parseResult = parser.parse(sql);
        if (!parseResult || parseResult.error || hasErrorDiagnostics(parseResult.diagnostics || [])) return;
        evaluateActiveStorySceneProgress(parseResult);
    }

    function scheduleLiveStoryReadinessEvaluation(delayMs = 140) {
        if (liveStoryReadinessEvaluationTimer) {
            clearTimeout(liveStoryReadinessEvaluationTimer);
            liveStoryReadinessEvaluationTimer = null;
        }
        liveStoryReadinessEvaluationTimer = window.setTimeout(() => {
            liveStoryReadinessEvaluationTimer = null;
            evaluateActiveStoryReadinessFromEditor();
        }, Math.max(0, Number(delayMs) || 0));
    }

    function applySimulationDataSnapshot(snapshot, options = {}) {
        const { setAsBaseline = true, clearUi = true } = options;
        const normalized = normalizeSimulationDataShape(deepClone(snapshot));
        parser.simulationData = normalized;
        parser.simulationData.VIEWS = parser.simulationData.VIEWS || {};
        parser.simulationData.INDEXES = parser.simulationData.INDEXES || {};
        parser.simulationData.SCHEMAS = parser.simulationData.SCHEMAS || {};
        parser.simulationData.SEQUENCES = parser.simulationData.SEQUENCES || {};

        if (setAsBaseline) {
            activeSimulationDataBaseline = deepClone(normalized);
        }

        if (clearUi) {
            simulator.reset();
            stepPreviewMap = new Map();
            resetProcessRuntimeState();
            resetProcessLogEntries();
            pendingLessonTaskParseResult = null;
            if (chatContainer) chatContainer.innerHTML = '';
            hideProcessResultPanel();
            renderDiagnostics([]);
        }

        renderTables(parser.simulationData);
        resetVisualization();
        drawRelationships();
    }

    function getToolById(toolId) {
        return (tutorialTreeModel.tools || []).find((entry) => entry.id === toolId) || null;
    }

    function getLessonById(tool, lessonId) {
        if (!tool) return null;
        return (tool.lessons || []).find((entry) => entry.id === lessonId) || null;
    }

    function activateLesson(toolId, lessonId) {
        const tool = getToolById(toolId);
        if (!tool) return;
        const lesson = getLessonById(tool, lessonId) || tool.lessons?.[0] || null;
        if (!lesson) return;

        activeGuideSelectionScope = 'lesson';
        if (tool.id === activeToolId && lesson.id === activeLessonId && activeLessonConfig === lesson) {
            updateGuideWindowStoryHint();
            return;
        }

        activeToolId = tool.id;
        activeLessonId = lesson.id;
        activeLessonConfig = lesson;
        renderLessonTree(tutorialTreeModel);
        updateGuideWindowStoryHint();
        scheduleLiveLessonTaskEvaluation(0);

        const snapshot = lesson.databaseSnapshot || tool.databaseSnapshot || createEmptySimulationData();
        applySimulationDataSnapshot(snapshot, { setAsBaseline: true, clearUi: true });
    }

    function activateTool(toolId) {
        const tool = getToolById(toolId);
        if (!tool) return;
        const preferredLessonId = tool.id === activeToolId
            ? activeLessonId
            : (tool.lessons?.[0]?.id || '');
        activateLesson(tool.id, preferredLessonId);
    }

    function renderLessonTree(model = tutorialTreeModel) {
        if (!lessonTreeContainer) return;
        lessonTreeContainer.innerHTML = '';

        const tools = Array.isArray(model?.tools) ? model.tools : [];
        const modeConfig = getLessonModeConfig(activeLessonMode);
        const showStoryTree = Boolean(modeConfig?.storyEnabled);
        const storyTitles = showStoryTree && Array.isArray(storyTreeModel?.titles) ? storyTreeModel.titles : [];
        if (tools.length === 0 && storyTitles.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'lesson-tree-empty';
            emptyEl.textContent = 'Keine Navigationseintraege gefunden.';
            lessonTreeContainer.appendChild(emptyEl);
            return;
        }

        const makeToolStateKey = (toolId = '') => `tool:${String(toolId || '').trim()}`;
        const makeNodeStateKey = (nodeId = '') => `node:${String(nodeId || '').trim()}`;

        const isOverviewNode = (node) => {
            const title = normalizeLessonTitle(node?.title || '');
            return title === 'ubersicht' || title === 'uebersicht';
        };

        const resolvePreferredNodeActivationId = (node) => {
            if (!node) return '';
            const hasOwnBody = Boolean(String(node.body || '').trim());
            const hasOwnTasks = Array.isArray(node.tasks) && node.tasks.length > 0;
            if (hasOwnBody || hasOwnTasks) return node.id;

            const overviewChild = (node.children || []).find((child) => {
                const title = normalizeLessonTitle(child?.title || '');
                return title === 'ubersicht' || title === 'uebersicht';
            });

            return overviewChild?.id || node.id;
        };

        const buildLessonContent = (tool, node, depth, renderLessonNodeFn) => {
            const contentEl = document.createElement('div');
            contentEl.className = 'lesson-node-content';

            if (node.body) {
                const bodyEl = buildLessonBodyContent(node.body);
                if (bodyEl) {
                    contentEl.appendChild(bodyEl);
                }
            }

            const lessonKey = makeLessonKey(tool.id, node.id);
            const progressSet = getLessonProgressSet(tool.id, node.id);
            if (Array.isArray(node.tasks) && node.tasks.length > 0) {
                const separatorEl = document.createElement('div');
                separatorEl.className = 'lesson-item-separator';
                contentEl.appendChild(separatorEl);

                const taskList = document.createElement('ul');
                taskList.className = 'lesson-task-list';

                node.tasks.forEach((task) => {
                    const taskId = String(task?.id || '').trim();
                    const taskKey = `${lessonKey}:${taskId}`;
                    const isDone = taskId ? progressSet.has(taskId) : false;
                    const taskItem = document.createElement('li');
                    taskItem.className = 'lesson-task-item';
                    if (isDone) taskItem.classList.add('is-done');
                    if (lessonTaskAnimationQueue.has(taskKey)) taskItem.classList.add('task-just-completed');
                    taskItem.setAttribute('role', 'button');
                    taskItem.tabIndex = 0;

                    const checkEl = document.createElement('span');
                    checkEl.className = 'lesson-task-check';
                    checkEl.textContent = isDone ? '✓' : '';

                    const textEl = document.createElement('span');
                    textEl.className = 'lesson-task-text';
                    textEl.textContent = task.text || 'Aufgabe';
                    taskItem.setAttribute('aria-label', `Aufgabe einfügen: ${textEl.textContent}`);

                    const handleTaskItemActivate = () => {
                        animateLessonTaskSelection(taskItem);
                        appendTaskCommentToEditor(textEl.textContent);
                    };
                    taskItem.addEventListener('click', handleTaskItemActivate);
                    taskItem.addEventListener('keydown', (event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        handleTaskItemActivate();
                    });

                    taskItem.appendChild(checkEl);
                    taskItem.appendChild(textEl);
                    taskList.appendChild(taskItem);
                });

                contentEl.appendChild(taskList);
            }

            const hasChildren = Array.isArray(node.children) && node.children.length > 0;
            if (hasChildren) {
                const childrenWrap = document.createElement('div');
                childrenWrap.className = 'lesson-node-children';
                node.children.forEach((childNode) => renderLessonNodeFn(tool, childNode, childrenWrap, depth + 1));
                contentEl.appendChild(childrenWrap);
            }

            if (contentEl.childElementCount === 0) {
                return null;
            }

            return contentEl;
        };

        const renderLessonNode = (tool, node, parentContainer, depth = 1) => {
            const hasChildren = Array.isArray(node.children) && node.children.length > 0;
            const isActiveNode = tool.id === activeToolId && node.id === activeLessonId;
            const lessonLevel = Math.max(1, Number(node.level || depth));

            const detailsEl = document.createElement('details');
            detailsEl.className = 'lesson-folder lesson-node-folder';
            detailsEl.dataset.level = String(lessonLevel);
            detailsEl.classList.add(`lesson-level-${Math.min(4, lessonLevel)}`);
            detailsEl.classList.add(hasChildren ? 'is-branch' : 'is-leaf');
            if (depth > 1) detailsEl.classList.add('lesson-item-nested');
            if (isActiveNode) detailsEl.classList.add('is-active');

            const nodeStateKey = makeNodeStateKey(node.id);
            detailsEl.open = lessonFolderOpenState.has(nodeStateKey);
            detailsEl.addEventListener('toggle', () => {
                if (detailsEl.open) {
                    lessonFolderOpenState.add(nodeStateKey);
                } else {
                    lessonFolderOpenState.delete(nodeStateKey);
                }
            });

            const summaryEl = document.createElement('summary');
            summaryEl.className = 'lesson-node-summary';

            const labelWrap = document.createElement('span');
            labelWrap.className = 'lesson-node-label';

            const iconEl = document.createElement('span');
            iconEl.className = `lesson-node-icon ${hasChildren ? 'is-folder' : 'is-lesson'}`;

            const titleEl = document.createElement('span');
            titleEl.className = 'lesson-node-title';
            titleEl.textContent = node.title || 'Lektion';

            labelWrap.appendChild(iconEl);
            labelWrap.appendChild(titleEl);
            summaryEl.appendChild(labelWrap);
            summaryEl.addEventListener('click', () => {
                requestAnimationFrame(() => {
                    if (detailsEl.open) {
                        activateLesson(tool.id, resolvePreferredNodeActivationId(node));
                    }
                });
            });
            detailsEl.appendChild(summaryEl);

            const contentEl = buildLessonContent(tool, node, depth, renderLessonNode);
            if (contentEl) {
                detailsEl.appendChild(contentEl);
            }

            parentContainer.appendChild(detailsEl);
        };

        if (tools.length > 0) {
            const toolRootStateKey = 'root:tools';
            const rootDetails = document.createElement('details');
            rootDetails.className = 'lesson-folder lesson-root-folder';
            rootDetails.open = lessonFolderOpenState.has(toolRootStateKey);
            rootDetails.addEventListener('toggle', () => {
                if (rootDetails.open) {
                    lessonFolderOpenState.add(toolRootStateKey);
                } else {
                    lessonFolderOpenState.delete(toolRootStateKey);
                }
            });

            const rootSummary = document.createElement('summary');
            rootSummary.className = 'lesson-node-summary';
            const rootLabelWrap = document.createElement('span');
            rootLabelWrap.className = 'lesson-node-label';
            const rootIconEl = document.createElement('span');
            rootIconEl.className = 'lesson-node-icon is-folder is-root';
            const rootTitleEl = document.createElement('span');
            rootTitleEl.className = 'lesson-node-title';
            rootTitleEl.textContent = model.rootLabel || LESSON_TREE_FALLBACK.rootLabel;
            rootLabelWrap.appendChild(rootIconEl);
            rootLabelWrap.appendChild(rootTitleEl);
            rootSummary.appendChild(rootLabelWrap);
            rootDetails.appendChild(rootSummary);

            const toolListWrap = document.createElement('div');
            toolListWrap.className = 'lesson-tool-list';

            tools.forEach((tool) => {
                const toolDetails = document.createElement('details');
                toolDetails.className = 'lesson-folder lesson-tool-folder';
                const toolStateKey = makeToolStateKey(tool.id);
                toolDetails.open = lessonFolderOpenState.has(toolStateKey);
                if (tool.id === activeToolId) {
                    toolDetails.classList.add('is-active-tool');
                }
                toolDetails.addEventListener('toggle', () => {
                    if (toolDetails.open) {
                        lessonFolderOpenState.add(toolStateKey);
                    } else {
                        lessonFolderOpenState.delete(toolStateKey);
                    }
                });

                const toolSummary = document.createElement('summary');
                toolSummary.className = 'lesson-node-summary';
                const toolLabelWrap = document.createElement('span');
                toolLabelWrap.className = 'lesson-node-label';
                const toolIconEl = document.createElement('span');
                toolIconEl.className = 'lesson-node-icon is-folder';
                const toolTitleEl = document.createElement('span');
                toolTitleEl.className = 'lesson-node-title';
                toolTitleEl.textContent = tool.label;
                toolLabelWrap.appendChild(toolIconEl);
                toolLabelWrap.appendChild(toolTitleEl);
                toolSummary.appendChild(toolLabelWrap);
                toolSummary.addEventListener('click', () => {
                    requestAnimationFrame(() => {
                        if (toolDetails.open) {
                            activateTool(tool.id);
                        }
                    });
                });
                toolDetails.appendChild(toolSummary);

                const lessonTreeWrap = document.createElement('div');
                lessonTreeWrap.className = 'lesson-list';
                const lessonRoots = Array.isArray(tool.lessonRoots) ? tool.lessonRoots : [];
                const overviewRoots = lessonRoots.filter((node) => isOverviewNode(node));
                const visibleLessonRoots = lessonRoots.filter((node) => !isOverviewNode(node));

                if (overviewRoots.length > 0) {
                    const overviewWrap = document.createElement('div');
                    overviewWrap.className = 'lesson-tool-overview';

                    overviewRoots.forEach((overviewNode) => {
                        const overviewContent = buildLessonContent(tool, overviewNode, 1, renderLessonNode);
                        if (!overviewContent) return;
                        overviewContent.classList.add('lesson-tool-overview-content');
                        overviewWrap.appendChild(overviewContent);
                    });

                    if (overviewWrap.childElementCount > 0) {
                        lessonTreeWrap.appendChild(overviewWrap);
                    }
                }

                if (visibleLessonRoots.length === 0 && lessonTreeWrap.childElementCount === 0) {
                    const emptyItem = document.createElement('div');
                    emptyItem.className = 'lesson-item-empty';
                    emptyItem.textContent = 'Noch keine Lektion hinterlegt.';
                    lessonTreeWrap.appendChild(emptyItem);
                } else {
                    visibleLessonRoots.forEach((rootNode) => renderLessonNode(tool, rootNode, lessonTreeWrap, 1));
                }

                toolDetails.appendChild(lessonTreeWrap);
                toolListWrap.appendChild(toolDetails);
            });

            rootDetails.appendChild(toolListWrap);
            lessonTreeContainer.appendChild(rootDetails);
        }

        if (showStoryTree) {
            const storyRootStateKey = 'root:storys';
            const storyRootDetails = document.createElement('details');
            storyRootDetails.className = 'lesson-folder lesson-root-folder lesson-story-root-folder';
            storyRootDetails.open = lessonFolderOpenState.has(storyRootStateKey);
            storyRootDetails.addEventListener('toggle', () => {
                if (storyRootDetails.open) {
                    lessonFolderOpenState.add(storyRootStateKey);
                } else {
                    lessonFolderOpenState.delete(storyRootStateKey);
                }
            });

            const storyRootSummary = document.createElement('summary');
            storyRootSummary.className = 'lesson-node-summary';
            const storyRootLabelWrap = document.createElement('span');
            storyRootLabelWrap.className = 'lesson-node-label';
            const storyRootIconEl = document.createElement('span');
            storyRootIconEl.className = 'lesson-node-icon is-folder is-root';
            const storyRootTitleEl = document.createElement('span');
            storyRootTitleEl.className = 'lesson-node-title';
            storyRootTitleEl.textContent = storyTreeModel.rootLabel || STORY_TREE_FALLBACK.rootLabel;
            storyRootLabelWrap.appendChild(storyRootIconEl);
            storyRootLabelWrap.appendChild(storyRootTitleEl);
            storyRootSummary.appendChild(storyRootLabelWrap);
            storyRootDetails.appendChild(storyRootSummary);

            const storyListWrap = document.createElement('div');
            storyListWrap.className = 'lesson-tool-list';
            ensureActiveStoryVisible(storyTitles);
            const storyFolders = groupStoryTitlesByFolder(storyTitles, storyFolderBlueprint);
            if (storyFolders.length === 0) {
                const emptyItem = document.createElement('div');
                emptyItem.className = 'lesson-item-empty';
                emptyItem.textContent = 'Noch keine Story-Ordner hinterlegt.';
                storyListWrap.appendChild(emptyItem);
            } else {
                storyFolders.forEach((storyFolder, folderIndex) => {
                    const visibleStoryUpperIndex = getStoryVisibleUpperIndex(storyFolder.titles);
                    const storyFolderStateKey = `story-folder:${sanitizeClassName(storyFolder.id) || `story-${folderIndex + 1}`}`;
                    const storyFolderDetails = document.createElement('details');
                    storyFolderDetails.className = 'lesson-folder lesson-tool-folder';
                    storyFolderDetails.open = lessonFolderOpenState.has(storyFolderStateKey);
                    storyFolderDetails.addEventListener('toggle', () => {
                        if (storyFolderDetails.open) {
                            lessonFolderOpenState.add(storyFolderStateKey);
                        } else {
                            lessonFolderOpenState.delete(storyFolderStateKey);
                        }
                    });

                    const storyFolderSummary = document.createElement('summary');
                    storyFolderSummary.className = 'lesson-node-summary';
                    const storyFolderLabelWrap = document.createElement('span');
                    storyFolderLabelWrap.className = 'lesson-node-label';
                    const storyFolderIconEl = document.createElement('span');
                    storyFolderIconEl.className = 'lesson-node-icon is-folder';
                    const storyFolderTitleEl = document.createElement('span');
                    storyFolderTitleEl.className = 'lesson-node-title';
                    storyFolderTitleEl.textContent = storyFolder.label;
                    storyFolderLabelWrap.appendChild(storyFolderIconEl);
                    storyFolderLabelWrap.appendChild(storyFolderTitleEl);
                    storyFolderSummary.appendChild(storyFolderLabelWrap);
                    storyFolderDetails.appendChild(storyFolderSummary);

                    const storyFolderContent = document.createElement('div');
                    storyFolderContent.className = 'lesson-list';

                    if (storyFolder.titles.length === 0 || visibleStoryUpperIndex < 0) {
                        const emptyItem = document.createElement('div');
                        emptyItem.className = 'lesson-item-empty';
                        emptyItem.textContent = storyFolder.titles.length === 0
                            ? 'Story-Ordner vorbereitet. Inhalte folgen.'
                            : 'Noch keine Story freigeschaltet.';
                        storyFolderContent.appendChild(emptyItem);
                    } else {
                        const storyTitleList = document.createElement('div');
                        storyTitleList.className = 'story-title-list';

                        storyFolder.titles.forEach((storyTitle, storyIndex) => {
                            if (storyIndex > visibleStoryUpperIndex) return;
                            const isActiveStory = activeGuideSelectionScope === 'story' && storyTitle.id === activeStoryTitleId;
                            const isReadyStory = isStoryTitleReady(storyTitle);
                            const isCompletedStory = Boolean(getStoryRuntimeEntry(storyTitle)?.completed);

                            const storyItem = document.createElement('button');
                            storyItem.type = 'button';
                            storyItem.className = 'story-title-item';
                            if (isActiveStory) {
                                storyItem.classList.add('is-active');
                            }
                            if (isReadyStory) {
                                storyItem.classList.add('is-ready');
                            }
                            if (isCompletedStory) {
                                storyItem.classList.add('is-complete');
                            }

                            const titleEl = document.createElement('span');
                            titleEl.className = 'story-title-name';
                            titleEl.textContent = formatStoryTreeLabel(storyTitle, storyIndex);
                            storyItem.appendChild(titleEl);
                            storyItem.addEventListener('click', () => activateStoryTitle(storyTitle.id));
                            storyTitleList.appendChild(storyItem);
                        });

                        storyFolderContent.appendChild(storyTitleList);
                    }

                    storyFolderDetails.appendChild(storyFolderContent);
                    storyListWrap.appendChild(storyFolderDetails);
                });
            }

            storyRootDetails.appendChild(storyListWrap);
            lessonTreeContainer.appendChild(storyRootDetails);
        }
    }

    async function initLessonTree(requestedMode = activeLessonMode, options = {}) {
        const { initializeEmpty = false } = options;
        if (!lessonTreeContainer) return;
        const nextMode = resolveLessonMode(requestedMode);
        const modeConfig = getLessonModeConfig(nextMode);
        const previousMode = activeLessonMode;
        const preferredToolId = previousMode === nextMode ? activeToolId : '';
        const preferredLessonId = previousMode === nextMode ? activeLessonId : '';

        activeLessonMode = nextMode;
        hasExplicitStorySelection = false;
        persistLessonMode(nextMode);
        syncLessonModeUi(nextMode);

        lessonTreeContainer.innerHTML = `<div class="lesson-tree-empty">Lade ${nextMode}-Folder ...</div>`;

        let parsedTree = { rootLabel: '', toolLabels: [], tools: [] };
        let parsedStories = { rootLabel: '', titles: [] };

        try {
            const response = await fetch(modeConfig.treePath, { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const jsonTree = await response.json();
            parsedTree = parseFolderTreeJson(jsonTree);
        } catch (error) {
            console.warn(`[LessonTree] ${modeConfig.treePath} konnte nicht geladen werden, versuche app-data/folderTree.json.`, error);
            try {
                const fallbackResponse = await fetch('app-data/folderTree.json', { cache: 'no-store' });
                if (fallbackResponse.ok) {
                    const fallbackTree = await fallbackResponse.json();
                    parsedTree = parseFolderTreeJson(fallbackTree);
                }
            } catch (fallbackError) {
                console.warn('[LessonTree] Fallback folderTree.json konnte nicht geladen werden, nutze In-App-Fallback.', fallbackError);
            }
        }

        if (modeConfig.storyEnabled) {
            const storySourceConfig = await resolveStorySourceConfig(nextMode);
            const mergedStoryTitles = [];
            let mergedStoryRootLabel = String(storySourceConfig?.rootLabel || '').trim();
            storyFolderBlueprint = buildStoryFolderBlueprint(storySourceConfig.sourceEntries || []);
            for (const sourceEntry of storySourceConfig.sourceEntries || []) {
                if (!sourceEntry?.path) continue;
                try {
                    const response = await fetch(encodeURI(sourceEntry.path), { cache: 'no-store' });
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    const jsonStories = await response.json();
                    const parsedFromSource = parseStoriesJson(jsonStories, {
                        sourcePath: sourceEntry.path,
                        folderLabel: sourceEntry.folderLabel,
                        folderId: sourceEntry.folderId
                    });
                    if (!mergedStoryRootLabel) {
                        mergedStoryRootLabel = parsedFromSource.rootLabel;
                    }
                    mergedStoryTitles.push(...(parsedFromSource.titles || []));
                } catch (error) {
                    if (!sourceEntry.optional) {
                        console.warn(`[StoryTree] ${sourceEntry.path} konnte nicht geladen werden.`, error);
                    }
                }
            }

            parsedStories = {
                rootLabel: mergedStoryRootLabel || STORY_TREE_FALLBACK.rootLabel,
                titles: ensureUniqueStoryTitleIds(mergedStoryTitles)
            };
            storyTreeModel = parsedStories;

            setStoryAutoAdvanceNotice('');
            pendingStoryAdvanceParseResult = null;
            storyRuntimeState.clear();
            (storyTreeModel.titles || []).forEach((storyTitle) => {
                getStoryRuntimeEntry(storyTitle);
            });
            restoreStoryProgressFromStorage();

            if (!activeStoryTitleId) {
                const preferredStoryTitle = (storyTreeModel.titles || []).find((storyTitle) => {
                    return normalizeLessonTitle(storyTitle?.sourcePath || '') === normalizeLessonTitle(storySourceConfig.defaultStoryPath || '');
                }) || null;
                const firstStoryTitle = preferredStoryTitle || storyTreeModel.titles?.[0] || null;
                if (firstStoryTitle) {
                    activeStoryTitleId = firstStoryTitle.id;
                    activeStoryTitleConfig = firstStoryTitle;
                    const runtimeEntry = getStoryRuntimeEntry(firstStoryTitle);
                    if (runtimeEntry) {
                        runtimeEntry.status = 'aktiv';
                        activeStorySceneIndex = clampStorySceneIndex(runtimeEntry.sceneIndex, getStorySceneCount(firstStoryTitle));
                        runtimeEntry.sceneIndex = activeStorySceneIndex;
                    }
                } else {
                    activeStoryTitleConfig = null;
                    activeStorySceneIndex = 0;
                }
            } else {
                activeStoryTitleConfig = getStoryTitleById(activeStoryTitleId);
                if (!activeStoryTitleConfig) {
                    const preferredStoryTitle = (storyTreeModel.titles || []).find((storyTitle) => {
                        return normalizeLessonTitle(storyTitle?.sourcePath || '') === normalizeLessonTitle(storySourceConfig.defaultStoryPath || '');
                    }) || null;
                    const firstStoryTitle = preferredStoryTitle || storyTreeModel.titles?.[0] || null;
                    activeStoryTitleId = firstStoryTitle?.id || '';
                    activeStoryTitleConfig = firstStoryTitle;
                }
                const runtimeEntry = getStoryRuntimeEntry(activeStoryTitleConfig);
                if (runtimeEntry) {
                    runtimeEntry.status = 'aktiv';
                    activeStorySceneIndex = clampStorySceneIndex(runtimeEntry.sceneIndex, getStorySceneCount(activeStoryTitleConfig));
                    runtimeEntry.sceneIndex = activeStorySceneIndex;
                } else {
                    activeStorySceneIndex = 0;
                }
            }
            ensureActiveStoryVisible(storyTreeModel.titles || []);
            persistStoryProgress();
            updateGuideWindowStoryHint();
        } else {
            storyTreeModel = { rootLabel: STORY_TREE_FALLBACK.rootLabel, titles: [] };
            storyFolderBlueprint = [];
            setStoryAutoAdvanceNotice('');
            pendingStoryAdvanceParseResult = null;
            storyRuntimeState.clear();
            activeStoryTitleId = '';
            activeStoryTitleConfig = null;
            activeStorySceneIndex = 0;
            updateGuideWindowStoryHint();
        }

        tutorialTreeModel = buildLessonTreeModel(parsedTree);
        const taskCheckIssues = validateLessonTaskChecks(tutorialTreeModel);
        if (taskCheckIssues.length > 0) {
            console.warn('[LessonTree] Task-Check-Validierung: Probleme gefunden', taskCheckIssues);
        }
        const databaseProfileIssues = validateLessonDatabaseProfiles(tutorialTreeModel);
        if (databaseProfileIssues.length > 0) {
            console.warn('[LessonTree] Datenbank-Profile: Probleme gefunden', databaseProfileIssues);
        }
        const activeStoryDatabaseSnapshot = modeConfig.storyEnabled
            ? buildActiveStoryDatabaseSnapshot()
            : null;
        const initialTool = tutorialTreeModel.tools?.find((tool) => tool.id === preferredToolId) || tutorialTreeModel.tools?.[0] || null;
        if (!initialTool) {
            activeToolId = '';
            activeLessonId = '';
            activeLessonConfig = null;
            renderLessonTree(tutorialTreeModel);
            if (initializeEmpty) {
                initializeEmptyWorkspace();
                return;
            }
            if (activeStoryDatabaseSnapshot) {
                applySimulationDataSnapshot(activeStoryDatabaseSnapshot, { setAsBaseline: true, clearUi: true });
            }
            return;
        }

        const initialLesson = (initialTool.lessons || []).find((lesson) => lesson.id === preferredLessonId) || initialTool.lessons?.[0] || null;
        if (!initialLesson) {
            activeToolId = initialTool.id;
            activeLessonId = '';
            activeLessonConfig = null;
            renderLessonTree(tutorialTreeModel);
            if (initializeEmpty) {
                initializeEmptyWorkspace();
                return;
            }
            const snapshot = activeStoryDatabaseSnapshot || initialTool.databaseSnapshot;
            applySimulationDataSnapshot(snapshot, { setAsBaseline: true, clearUi: true });
            return;
        }

        if (initializeEmpty) {
            initializeEmptyWorkspace();
            return;
        }

        activateLesson(initialTool.id, initialLesson.id);
        if (activeStoryDatabaseSnapshot) {
            applySimulationDataSnapshot(activeStoryDatabaseSnapshot, { setAsBaseline: true, clearUi: true });
        }
    }
    function isCreatePipelineStep(step) {
        return Boolean(step && CREATE_STEP_KINDS.has(step.kind));
    }

    function getActiveDialectLabel() {
        const profile = parser.getAvailableDialects().find(entry => entry.id === parser.getDialect());
        return profile ? profile.label : 'SQL Core';
    }

    function updateDiagnosticsHeader() {
        if (!diagnosticsHeader) return;
        diagnosticsHeader.textContent = `DBMS-Unit · ${getActiveDialectLabel()}`;
    }

    function hasErrorDiagnostics(diagnostics = []) {
        return diagnostics.some((diag) => String(diag?.severity || '').toLowerCase() === 'error');
    }

    function updateDiagnosticsVisibility(diagnostics = []) {
        if (!diagnosticsPane) return;
        const visible = true;
        diagnosticsPane.classList.toggle('is-visible', visible);
        diagnosticsPane.setAttribute('aria-hidden', visible ? 'false' : 'true');
        requestAnimationFrame(() => editor.refresh());
    }

    function initDialectSelector() {
        parser.setDialect('sql-core');
        if (!dialectSelect) {
            updateDiagnosticsHeader();
            return;
        }

        const options = parser.getAvailableDialects();
        dialectSelect.innerHTML = '';
        options.forEach((dialect) => {
            const opt = document.createElement('option');
            opt.value = dialect.id;
            opt.textContent = dialect.label;
            dialectSelect.appendChild(opt);
        });
        dialectSelect.value = parser.getDialect();
        updateDiagnosticsHeader();

        dialectSelect.addEventListener('change', () => {
            const changed = parser.setDialect(dialectSelect.value);
            if (!changed) return;
            updateDiagnosticsHeader();
            resetProcessLogEntries();
            renderDiagnostics([]);
        });
    }

    function deepClone(value) {
        if (typeof structuredClone === 'function') {
            return structuredClone(value);
        }
        return JSON.parse(JSON.stringify(value));
    }

    function normalizeTaskCommentText(taskText = '') {
        return String(taskText || '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function appendTaskCommentToEditor(taskText = '') {
        const normalized = normalizeTaskCommentText(taskText);
        if (!normalized) return;

        const commentSql = `-- ${normalized}`;
        editor.setValue(commentSql);
        editor.setCursor({ line: 0, ch: commentSql.length });
        editor.focus();
    }

    async function copyTextToClipboard(text = '') {
        const value = String(text || '');
        if (!value) return false;

        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            try {
                await navigator.clipboard.writeText(value);
                return true;
            } catch (error) {
                // Fallback below.
            }
        }

        const ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', 'readonly');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '0';
        ta.style.opacity = '0';
        ta.style.pointerEvents = 'none';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);

        let copied = false;
        try {
            copied = document.execCommand('copy');
        } catch (error) {
            copied = false;
        } finally {
            document.body.removeChild(ta);
        }

        return copied;
    }

    function parseLessonBodySections(bodyText = '') {
        const lines = String(bodyText || '').replace(/\r/g, '').split('\n');
        const sections = [];
        let current = { type: 'text', lines: [] };

        const pushCurrent = () => {
            const text = current.lines.join('\n').trim();
            if (!text) return;
            sections.push({ type: current.type, text });
        };

        lines.forEach((line) => {
            const raw = String(line || '');
            const trimmed = raw.trim();

            const schemaMatch = /^Schema\s*:\s*(.*)$/i.exec(trimmed);
            if (schemaMatch) {
                pushCurrent();
                current = { type: 'schema', lines: [] };
                const inlineText = String(schemaMatch[1] || '').trim();
                if (inlineText) current.lines.push(inlineText);
                return;
            }

            const exampleMatch = /^Beispiel\s*:\s*(.*)$/i.exec(trimmed);
            if (exampleMatch) {
                pushCurrent();
                current = { type: 'example', lines: [] };
                const inlineText = String(exampleMatch[1] || '').trim();
                if (inlineText) current.lines.push(inlineText);
                return;
            }

            if ((current.type === 'schema' || current.type === 'example') && /^Typische Fehler\s*:/i.test(trimmed)) {
                pushCurrent();
                current = { type: 'text', lines: [raw] };
                return;
            }

            current.lines.push(raw);
        });

        pushCurrent();
        return sections;
    }

    function buildLessonBodyContent(bodyText = '') {
        const normalizedBody = String(bodyText || '').trim();
        if (!normalizedBody) return null;

        const sections = parseLessonBodySections(normalizedBody);
        if (!Array.isArray(sections) || sections.length === 0) return null;

        const rootEl = document.createElement('div');
        rootEl.className = 'lesson-body';

        sections.forEach((section) => {
            const sectionText = String(section?.text || '').trim();
            if (!sectionText) return;
            const sectionType = String(section?.type || 'text');

            if (sectionType === 'schema' || sectionType === 'example') {
                const blockEl = document.createElement('div');
                blockEl.className = `lesson-body-block is-${sectionType}`;

                const headerEl = document.createElement('div');
                headerEl.className = 'lesson-body-block-header';

                const titleEl = document.createElement('span');
                titleEl.className = 'lesson-body-block-title';
                titleEl.textContent = sectionType === 'schema' ? 'Schema' : 'Beispiel';
                headerEl.appendChild(titleEl);

                if (sectionType === 'example') {
                    const copyBtn = document.createElement('button');
                    copyBtn.type = 'button';
                    copyBtn.className = 'lesson-example-copy-btn';
                    copyBtn.textContent = 'Kopieren';
                    copyBtn.setAttribute('aria-label', 'Beispiel SQL kopieren');
                    copyBtn.addEventListener('click', async (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const copied = await copyTextToClipboard(sectionText);
                        copyBtn.classList.remove('is-copied', 'is-error');
                        copyBtn.classList.add(copied ? 'is-copied' : 'is-error');
                        copyBtn.textContent = copied ? 'Kopiert' : 'Fehler';
                        window.setTimeout(() => {
                            copyBtn.classList.remove('is-copied', 'is-error');
                            copyBtn.textContent = 'Kopieren';
                        }, 1100);
                    });
                    headerEl.appendChild(copyBtn);
                }

                const codeEl = document.createElement('pre');
                codeEl.className = 'lesson-body-code';
                codeEl.textContent = sectionText;

                blockEl.appendChild(headerEl);
                blockEl.appendChild(codeEl);
                rootEl.appendChild(blockEl);
                return;
            }

            const textEl = document.createElement('div');
            textEl.className = 'lesson-body-text';
            textEl.textContent = sectionText;
            rootEl.appendChild(textEl);
        });

        return rootEl.childElementCount > 0 ? rootEl : null;
    }

    function animateLessonTaskSelection(taskItem) {
        if (!taskItem) return;
        taskItem.classList.remove('task-clicked');
        void taskItem.offsetWidth;
        taskItem.classList.add('task-clicked');
        window.setTimeout(() => {
            taskItem.classList.remove('task-clicked');
        }, 340);
    }

    function initExampleSelector() {
        if (!exampleSelect) return;

        exampleSelect.innerHTML = '';
        BASIC_SQL_EXAMPLES.forEach((example) => {
            const opt = document.createElement('option');
            opt.value = example.id;
            opt.textContent = example.label;
            exampleSelect.appendChild(opt);
        });
    }

    function getSelectedExampleSql() {
        if (!exampleSelect) return BASIC_SQL_EXAMPLES[0]?.sql || '';
        const selected = BASIC_SQL_EXAMPLES.find((entry) => entry.id === exampleSelect.value) || BASIC_SQL_EXAMPLES[0];
        return selected ? selected.sql : '';
    }

    function loadSelectedExample() {
        const sql = getSelectedExampleSql();
        if (!sql) return;
        editor.setValue(sql);
        editor.focus();
        renderDiagnostics([]);
    }

    function initializeEmptyWorkspace() {
        activeToolId = '';
        activeLessonId = '';
        activeLessonConfig = null;
        activeGuideSelectionScope = 'lesson';
        hasExplicitStorySelection = false;
        setStoryAutoAdvanceNotice('');
        pendingStoryAdvanceParseResult = null;
        pendingLessonTaskParseResult = null;
        applySimulationDataSnapshot(createEmptySimulationData(), { setAsBaseline: true, clearUi: true });
        editor.setValue('');
        editor.setCursor({ line: 0, ch: 0 });
        editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 0 });
        editor.getInputField?.()?.blur?.();
        setIntellisensePopupVisible(false);
        renderLessonTree(tutorialTreeModel);
        updateGuideWindowStoryHint();
    }

    let diagnosticLineClasses = [];

    function clearEditorDiagnosticLineClasses() {
        diagnosticLineClasses.forEach(({ line, cls }) => {
            editor.removeLineClass(line, 'background', cls);
        });
        diagnosticLineClasses = [];
    }

    function applyEditorDiagnosticLineClasses(diagnostics) {
        const lineState = new Map();
        const severityRank = { warning: 1, error: 2 };

        diagnostics.forEach((diag) => {
            const line = Math.max(1, Math.min(editor.lineCount(), Number(diag.line) || 1));
            const current = lineState.get(line);
            if (!current || (severityRank[diag.severity] || 0) > (severityRank[current] || 0)) {
                lineState.set(line, diag.severity);
            }
        });

        lineState.forEach((severity, line) => {
            const cls = severity === 'warning' ? 'sql-line-warning' : 'sql-line-error';
            const lineHandle = line - 1;
            editor.addLineClass(lineHandle, 'background', cls);
            diagnosticLineClasses.push({ line: lineHandle, cls });
        });
    }

    function createDiagnosticItem(diag) {
        const item = document.createElement('div');
        const severity = diag.severity === 'warning' ? 'warning' : 'error';
        item.className = `diagnostic-item ${severity}`;

        const messageLine = document.createElement('div');
        const code = document.createElement('span');
        code.className = 'diag-code';
        code.textContent = `[${diag.sqlstate || '00000'}]`;
        const message = document.createElement('span');
        message.className = 'diag-message';
        message.textContent = diag.message || 'Unbekannter SQL-Fehler';
        messageLine.appendChild(code);
        messageLine.appendChild(message);
        item.appendChild(messageLine);

        if (diag.hint) {
            const hint = document.createElement('div');
            hint.className = 'diag-hint';
            hint.textContent = `Hinweis: ${diag.hint}`;
            item.appendChild(hint);
        }

        return item;
    }

    function createProcessItem(entry) {
        const item = document.createElement('div');
        item.className = 'diagnostic-item process';

        const messageLine = document.createElement('div');
        const code = document.createElement('span');
        code.className = 'diag-code';
        code.textContent = `[STEP ${entry.stepNo}]`;
        const message = document.createElement('span');
        message.className = 'diag-message';
        message.textContent = entry.message;
        messageLine.appendChild(code);
        messageLine.appendChild(message);
        item.appendChild(messageLine);

        return item;
    }

    function normalizeStepDescription(step) {
        const fallback = String(step?.code || '').replace(/\s+/g, ' ').trim();
        const raw = String(step?.description || '').replace(/\s+/g, ' ').trim();
        if (raw) return raw;
        if (fallback) return fallback;
        return 'Schritt ausgefuehrt.';
    }

    function appendProcessLogEntry(step) {
        const statementIndex = Number(step?.statementIndex || 1);
        const stepType = String(step?.type || 'STEP').toUpperCase();
        const message = `[Statement ${statementIndex}] ${stepType}: ${normalizeStepDescription(step)}`;
        processLogEntries.push({
            stepNo: processLogEntries.length + 1,
            statementIndex,
            message
        });
        if (processLogEntries.length > 300) {
            processLogEntries = processLogEntries.slice(processLogEntries.length - 300);
        }
    }

    function resetProcessLogEntries() {
        processLogEntries = [];
    }

    function buildErrorDiagnosticRows(errorDiagnostics = []) {
        const fragment = document.createDocumentFragment();
        const lineCount = Math.max(editor.lineCount(), 1);
        const lineHeight = Math.max(Math.round(editor.defaultTextHeight()), 18);
        const byLine = new Map();
        errorDiagnostics.forEach((diag) => {
            if (!byLine.has(diag.line)) byLine.set(diag.line, []);
            byLine.get(diag.line).push(diag);
        });

        for (let line = 1; line <= lineCount; line++) {
            const row = document.createElement('div');
            row.className = 'diagnostic-line';
            row.dataset.line = String(line);
            row.style.minHeight = `${lineHeight}px`;

            const lineNo = document.createElement('div');
            lineNo.className = 'diagnostic-line-no';
            lineNo.textContent = String(line);

            const content = document.createElement('div');
            content.className = 'diagnostic-line-content';
            const lineDiagnostics = byLine.get(line) || [];
            lineDiagnostics.forEach((diag) => content.appendChild(createDiagnosticItem(diag)));

            row.appendChild(lineNo);
            row.appendChild(content);
            fragment.appendChild(row);
        }

        return { fragment, lineHeight };
    }

    function renderDbmsUnit() {
        if (!diagnosticsLines) return;
        diagnosticsLines.innerHTML = '';

        const errorDiagnostics = Array.isArray(activeErrorDiagnostics) ? activeErrorDiagnostics : [];
        const fragment = document.createDocumentFragment();

        if (processLogEntries.length > 0) {
            processLogEntries.forEach((entry) => {
                const row = document.createElement('div');
                row.className = 'diagnostic-line';
                const lineNo = document.createElement('div');
                lineNo.className = 'diagnostic-line-no';
                lineNo.textContent = String(entry.stepNo);
                const content = document.createElement('div');
                content.className = 'diagnostic-line-content';
                content.appendChild(createProcessItem(entry));
                row.appendChild(lineNo);
                row.appendChild(content);
                fragment.appendChild(row);
            });
        }

        let lineHeight = Math.max(Math.round(editor.defaultTextHeight()), 18);
        if (errorDiagnostics.length > 0) {
            if (processLogEntries.length > 0) {
                const separator = document.createElement('div');
                separator.className = 'dbms-separator';
                separator.textContent = 'SQL Fehlerdiagnose';
                fragment.appendChild(separator);
            }
            const errorRows = buildErrorDiagnosticRows(errorDiagnostics);
            lineHeight = errorRows.lineHeight;
            fragment.appendChild(errorRows.fragment);
        }

        if (processLogEntries.length === 0 && errorDiagnostics.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'diagnostic-empty';
            empty.textContent = 'Keine DBMS-Ausgabe.';
            fragment.appendChild(empty);
        }

        diagnosticsLines.appendChild(fragment);
        updateDiagnosticsVisibility(errorDiagnostics);

        const firstError = errorDiagnostics.find((diag) => diag.severity === 'error');
        if (firstError) {
            const targetRow = diagnosticsLines.querySelector(`.diagnostic-line[data-line="${firstError.line}"]`);
            if (targetRow) {
                diagnosticsLines.scrollTop = Math.max(0, targetRow.offsetTop - lineHeight * 2);
                editor.scrollIntoView({ line: firstError.line - 1, ch: Math.max((firstError.column || 1) - 1, 0) }, 80);
            }
        } else {
            diagnosticsLines.scrollTop = diagnosticsLines.scrollHeight;
        }
    }

    function renderDiagnostics(diagnostics = []) {
        const normalizedDiagnostics = [...diagnostics]
            .map((diag) => ({
                ...diag,
                line: Math.max(1, Number(diag.line) || 1)
            }))
            .sort((a, b) => {
                if (a.line !== b.line) return a.line - b.line;
                return (Number(a.column) || 1) - (Number(b.column) || 1);
            });
        const errorDiagnostics = normalizedDiagnostics.filter((diag) => String(diag.severity || '').toLowerCase() === 'error');

        activeErrorDiagnostics = errorDiagnostics;
        clearEditorDiagnosticLineClasses();
        applyEditorDiagnosticLineClasses(errorDiagnostics);
        renderDbmsUnit();
    }

    initDialectSelector();

    function resetSqlCoreCatalogRuntime() {
        sqlCoreCatalogMeta = {
            dialect: 'SQL Core',
            version: '',
            storageKey: 'sqlcore.progress.v1',
            storageSchema: 1
        };
        sqlCoreItemsById = new Map();
        sqlCoreStatesById = new Map();
        sqlCoreTransitionsByFrom = new Map();
        sqlCoreTokenToItemIds = new Map();
        sqlCoreProgressSnapshot = {
            schema: 1,
            unlockedIds: new Set(),
            completedTaskIds: new Set()
        };
    }

    function normalizeSqlCoreItems(rawItems) {
        const source = rawItems && typeof rawItems === 'object' && !Array.isArray(rawItems) ? rawItems : {};
        const items = new Map();

        Object.entries(source).forEach(([rawId, rawItem]) => {
            const id = String(rawId || '').trim();
            if (!id || !rawItem || typeof rawItem !== 'object') return;
            const text = String(rawItem.text || '').trim();
            if (!text) return;

            items.set(id, {
                id,
                text,
                kind: String(rawItem.kind || 'token').trim() || 'token',
                defaultUnlocked: rawItem.defaultUnlocked === true,
                tags: Array.isArray(rawItem.tags)
                    ? rawItem.tags.map((entry) => String(entry || '').trim()).filter(Boolean)
                    : []
            });
        });

        return items;
    }

    function normalizeSqlCoreStates(rawStates) {
        const source = rawStates && typeof rawStates === 'object' && !Array.isArray(rawStates) ? rawStates : {};
        const states = new Map();

        Object.entries(source).forEach(([rawStateId, rawState]) => {
            const stateId = String(rawStateId || '').trim();
            if (!stateId || !rawState || typeof rawState !== 'object') return;
            const next = Array.isArray(rawState.next)
                ? rawState.next.map((entry) => String(entry || '').trim()).filter(Boolean)
                : [];
            states.set(stateId, { id: stateId, next });
        });

        return states;
    }

    function normalizeSqlCoreTransitions(rawTransitions) {
        const source = Array.isArray(rawTransitions) ? rawTransitions : [];
        const transitionsByFrom = new Map();

        source.forEach((rawTransition) => {
            if (!rawTransition || typeof rawTransition !== 'object') return;
            const from = String(rawTransition.from || '').trim();
            const to = String(rawTransition.to || '').trim();
            if (!from || !to) return;

            const on = rawTransition.on == null ? '' : String(rawTransition.on || '').trim();
            const onAnyOf = Array.isArray(rawTransition.onAnyOf)
                ? rawTransition.onAnyOf.map((entry) => String(entry || '').trim()).filter(Boolean)
                : [];
            if (!on && onAnyOf.length === 0) return;

            if (!transitionsByFrom.has(from)) transitionsByFrom.set(from, []);
            transitionsByFrom.get(from).push({
                from,
                to,
                on,
                onAnyOf
            });
        });

        return transitionsByFrom;
    }

    function normalizeSqlCoreCatalogPayload(rawPayload = {}) {
        const payload = rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload) ? rawPayload : {};
        const dialect = String(payload.dialect || 'SQL Core').trim() || 'SQL Core';
        const version = String(payload.version || '').trim();
        const storageKey = String(payload?.storage?.localStorageKey || 'sqlcore.progress.v1').trim() || 'sqlcore.progress.v1';
        const storageSchema = Number.isInteger(Number(payload?.storage?.schema))
            ? Number(payload.storage.schema)
            : 1;

        const itemsById = normalizeSqlCoreItems(payload.items);
        const statesById = normalizeSqlCoreStates(payload.states);
        const transitionsByFrom = normalizeSqlCoreTransitions(payload.transitions);

        return {
            dialect,
            version,
            storageKey,
            storageSchema,
            itemsById,
            statesById,
            transitionsByFrom
        };
    }

    function buildSqlCoreTokenLookup(itemsById) {
        const lookup = new Map();
        if (!(itemsById instanceof Map)) return lookup;

        itemsById.forEach((item, itemId) => {
            const tokenText = String(item?.text || '').trim().toUpperCase();
            if (!tokenText) return;
            if (!lookup.has(tokenText)) lookup.set(tokenText, new Set());
            lookup.get(tokenText).add(itemId);
        });
        return lookup;
    }

    function getSqlCoreProgressStorageConfig() {
        const storageKey = String(sqlCoreCatalogMeta?.storageKey || '').trim();
        const rawSchema = Number(sqlCoreCatalogMeta?.storageSchema);
        const schema = Number.isInteger(rawSchema) && rawSchema > 0 ? rawSchema : 1;
        return {
            storageKey,
            schema
        };
    }

    function createEmptySqlCoreProgressSnapshot() {
        const config = getSqlCoreProgressStorageConfig();
        return {
            schema: config.schema,
            unlockedIds: new Set(),
            completedTaskIds: new Set()
        };
    }

    function normalizeSqlCoreProgressIdSet(rawIds) {
        if (!Array.isArray(rawIds)) return new Set();
        return new Set(rawIds.map((entry) => String(entry || '').trim()).filter(Boolean));
    }

    function normalizeSqlCoreProgressPayload(rawPayload = {}) {
        const payload = rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload) ? rawPayload : {};
        const config = getSqlCoreProgressStorageConfig();
        return {
            schema: config.schema,
            unlockedIds: normalizeSqlCoreProgressIdSet(payload.unlocked),
            completedTaskIds: normalizeSqlCoreProgressIdSet(payload.completedTasks)
        };
    }

    function serializeSqlCoreProgressPayload(progressSnapshot = sqlCoreProgressSnapshot) {
        const snapshot = progressSnapshot && typeof progressSnapshot === 'object'
            ? progressSnapshot
            : createEmptySqlCoreProgressSnapshot();
        const config = getSqlCoreProgressStorageConfig();
        const unlockedIds = snapshot.unlockedIds instanceof Set
            ? snapshot.unlockedIds
            : normalizeSqlCoreProgressIdSet(snapshot.unlocked);
        const completedTaskIds = snapshot.completedTaskIds instanceof Set
            ? snapshot.completedTaskIds
            : normalizeSqlCoreProgressIdSet(snapshot.completedTasks);

        return {
            schema: config.schema,
            unlocked: Array.from(unlockedIds).sort(),
            completedTasks: Array.from(completedTaskIds).sort()
        };
    }

    function persistSqlCoreProgressSnapshot(progressSnapshot = sqlCoreProgressSnapshot) {
        const config = getSqlCoreProgressStorageConfig();
        if (!window?.localStorage || !config.storageKey) return false;

        try {
            const payload = serializeSqlCoreProgressPayload(progressSnapshot);
            window.localStorage.setItem(config.storageKey, JSON.stringify(payload));
            return true;
        } catch (error) {
            console.warn('[IntelliSense SQL-Core] Progress konnte nicht gespeichert werden.', error);
            return false;
        }
    }

    function readStoredSqlCoreProgressPayload(options = {}) {
        const fallback = createEmptySqlCoreProgressSnapshot();
        const config = getSqlCoreProgressStorageConfig();
        const persistNormalized = options?.persistNormalized === true;

        if (!window?.localStorage || !config.storageKey) return fallback;

        let rawPayload = '';
        try {
            rawPayload = String(window.localStorage.getItem(config.storageKey) || '');
            if (!rawPayload) {
                if (persistNormalized) persistSqlCoreProgressSnapshot(fallback);
                return fallback;
            }

            const parsedPayload = JSON.parse(rawPayload);
            const normalized = normalizeSqlCoreProgressPayload(parsedPayload);
            if (persistNormalized) {
                const normalizedRawPayload = JSON.stringify(serializeSqlCoreProgressPayload(normalized));
                if (normalizedRawPayload !== rawPayload) {
                    persistSqlCoreProgressSnapshot(normalized);
                }
            }
            return normalized;
        } catch (error) {
            console.warn('[IntelliSense SQL-Core] Progress konnte nicht gelesen werden.', error);
            if (persistNormalized) persistSqlCoreProgressSnapshot(fallback);
            return fallback;
        }
    }

    function refreshSqlCoreProgressSnapshot(options = {}) {
        sqlCoreProgressSnapshot = readStoredSqlCoreProgressPayload(options);
        return sqlCoreProgressSnapshot;
    }

    function normalizeSqlCoreUnlockInputIds(rawIds = []) {
        const source = Array.isArray(rawIds) ? rawIds : [rawIds];
        return [...new Set(
            source
                .map((entry) => String(entry || '').trim())
                .filter(Boolean)
        )];
    }

    function unlockSqlCoreItems(ids = []) {
        const requestedIds = normalizeSqlCoreUnlockInputIds(ids);
        const result = {
            requestedIds,
            validIds: [],
            addedIds: [],
            ignoredIds: [],
            persisted: false,
            hasChanges: false,
            storageKey: String(sqlCoreCatalogMeta?.storageKey || '').trim(),
            schema: Number(sqlCoreCatalogMeta?.storageSchema) || 1,
            delta: {
                addedIds: [],
                addedCount: 0
            }
        };
        if (requestedIds.length === 0) {
            result.persisted = true;
            return result;
        }

        const currentSnapshot = refreshSqlCoreProgressSnapshot({ persistNormalized: true });
        const nextUnlockedIds = currentSnapshot?.unlockedIds instanceof Set
            ? new Set(currentSnapshot.unlockedIds)
            : new Set();

        requestedIds.forEach((itemId) => {
            if (!sqlCoreItemsById.has(itemId)) {
                result.ignoredIds.push(itemId);
                return;
            }
            result.validIds.push(itemId);
            if (!nextUnlockedIds.has(itemId)) {
                nextUnlockedIds.add(itemId);
                result.addedIds.push(itemId);
            }
        });

        if (result.addedIds.length === 0) {
            result.persisted = true;
            triggerSqlCoreRuntimeRefresh();
            return result;
        }

        const nextSnapshot = {
            schema: currentSnapshot?.schema || result.schema,
            unlockedIds: nextUnlockedIds,
            completedTaskIds: currentSnapshot?.completedTaskIds instanceof Set
                ? new Set(currentSnapshot.completedTaskIds)
                : new Set()
        };

        result.persisted = persistSqlCoreProgressSnapshot(nextSnapshot);
        if (result.persisted) {
            sqlCoreProgressSnapshot = nextSnapshot;
        } else {
            refreshSqlCoreProgressSnapshot();
        }
        result.hasChanges = result.addedIds.length > 0;
        result.delta = {
            addedIds: [...result.addedIds],
            addedCount: result.addedIds.length
        };
        triggerSqlCoreRuntimeRefresh();

        return result;
    }

    function triggerSqlCoreRuntimeRefresh() {
        scheduleIntellisensePopupPosition();
    }

    function bindSqlCoreUnlockApi() {
        window.unlock = (ids = []) => unlockSqlCoreItems(ids);
    }

    function buildSqlCoreUnlockedSet(progressSnapshot = sqlCoreProgressSnapshot) {
        const unlockedSet = new Set();
        sqlCoreItemsById.forEach((item, itemId) => {
            if (item?.defaultUnlocked === true) unlockedSet.add(itemId);
        });

        const unlockedIds = progressSnapshot?.unlockedIds instanceof Set
            ? progressSnapshot.unlockedIds
            : new Set();
        unlockedIds.forEach((itemId) => {
            if (sqlCoreItemsById.has(itemId)) unlockedSet.add(itemId);
        });

        return unlockedSet;
    }

    function getSqlBeforeCursorRaw() {
        const cursor = editor.getCursor();
        const firstPos = { line: 0, ch: 0 };
        return String(editor.getRange(firstPos, cursor) || '');
    }

    function normalizeEditorCursor(cursor = null) {
        if (!cursor || typeof cursor !== 'object') return null;
        const lineCount = Math.max(1, Number(editor.lineCount()) || 1);
        const rawLine = Number(cursor.line);
        const safeLine = Number.isFinite(rawLine)
            ? Math.max(0, Math.min(lineCount - 1, Math.floor(rawLine)))
            : 0;
        const lineText = String(editor.getLine(safeLine) || '');
        const rawCh = Number(cursor.ch);
        const safeCh = Number.isFinite(rawCh)
            ? Math.max(0, Math.min(lineText.length, Math.floor(rawCh)))
            : lineText.length;
        return { line: safeLine, ch: safeCh };
    }

    function captureIntellisenseInsertAnchor(cursor = null) {
        const normalized = normalizeEditorCursor(cursor || editor.getCursor());
        intellisenseInsertAnchor = normalized ? { ...normalized } : null;
    }

    function getSqlBeforeCursorRawAt(cursor = null) {
        const normalized = normalizeEditorCursor(cursor);
        if (!normalized) return '';
        const firstPos = { line: 0, ch: 0 };
        return String(editor.getRange(firstPos, normalized) || '');
    }

    function getSqlCoreActiveStatementSegment(sqlBeforeCursorRaw = '') {
        const source = String(sqlBeforeCursorRaw || '');
        if (!source.trim()) return '';
        const parts = source.split(';');
        for (let index = parts.length - 1; index >= 0; index -= 1) {
            const segment = String(parts[index] || '');
            if (segment.trim()) return segment;
        }
        return '';
    }

    function tokenizeSqlCoreSegment(segment = '') {
        const source = String(segment || '');
        if (!source.trim()) return [];
        const tokens = [];
        const tokenRegex = /'(?:''|[^'])*'|"(?:[^"]|"")*"|<=|>=|<>|!=|[(),.;*+\-/%=<>]|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?/g;
        let match = null;
        while ((match = tokenRegex.exec(source)) !== null) {
            tokens.push(String(match[0] || ''));
        }
        return tokens;
    }

    function getSqlCoreTokenCandidateIds(rawToken = '') {
        const token = String(rawToken || '').trim();
        if (!token) return new Set();

        const candidates = new Set();
        const directMatches = sqlCoreTokenToItemIds.get(token.toUpperCase());
        if (directMatches instanceof Set) {
            directMatches.forEach((itemId) => candidates.add(itemId));
        }

        const hasNonPlaceholder = [...candidates].some((itemId) => !String(itemId || '').startsWith('ph.'));
        if (/^'(?:''|[^'])*'$/.test(token)) candidates.add('ph.<string_literal>');
        if (/^-?\d+(?:\.\d+)?$/.test(token)) candidates.add('ph.<numeric_literal>');

        if (!hasNonPlaceholder && /^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) {
            [
                'ph.<identifier>',
                'ph.<schema_name>',
                'ph.<table_name>',
                'ph.<column_name>',
                'ph.<alias_name>'
            ].forEach((itemId) => candidates.add(itemId));
        }

        const exprStart = sqlCoreStatesById.get('expr.start');
        if (exprStart && Array.isArray(exprStart.next)) {
            const isExprStartCandidate = exprStart.next.some((entry) => candidates.has(entry));
            if (isExprStartCandidate) candidates.add('expr.start');
        }

        return candidates;
    }

    function resolveSqlCoreTransition(fromStateId = '', candidateIds = new Set()) {
        const transitions = sqlCoreTransitionsByFrom.get(fromStateId);
        if (!Array.isArray(transitions) || transitions.length === 0) return '';
        const candidates = candidateIds instanceof Set ? candidateIds : new Set();

        for (const transition of transitions) {
            if (transition.on && candidates.has(transition.on)) {
                return transition.to;
            }
            if (Array.isArray(transition.onAnyOf) && transition.onAnyOf.some((entry) => candidates.has(entry))) {
                return transition.to;
            }
        }
        return '';
    }

    function deriveSqlCoreCreateTableStateIdByHeuristic(activeSegment = '', tokens = []) {
        const normalizedActiveSegment = String(activeSegment || '');
        const sourceTokens = Array.isArray(tokens) ? tokens : [];
        if (sourceTokens.length === 0) return '';

        const upperTokens = sourceTokens.map((token) => String(token || '').trim().toUpperCase()).filter(Boolean);
        if (upperTokens.length === 0 || upperTokens[0] !== 'CREATE') return '';

        if (upperTokens.length === 1) return 'ddl.after_CREATE';

        const tableIndex = upperTokens.indexOf('TABLE', 1);
        if (tableIndex < 0) return 'ddl.after_CREATE';
        if (upperTokens.length === tableIndex + 1) return 'ddl.after_CREATE_TABLE';

        const parenIndex = upperTokens.indexOf('(', tableIndex + 1);
        if (parenIndex < 0) return 'ddl.after_CREATE_TABLE_name';

        let depth = 0;
        let lastCommaAtRootDepth = parenIndex;
        for (let index = parenIndex; index < upperTokens.length; index += 1) {
            const token = upperTokens[index];
            if (token === '(') {
                depth += 1;
                continue;
            }
            if (token === ')') {
                depth = Math.max(0, depth - 1);
                continue;
            }
            if (token === ',' && depth === 1) {
                lastCommaAtRootDepth = index;
            }
        }

        if (depth <= 0) return '';

        const clauseTokens = upperTokens.slice(lastCommaAtRootDepth + 1).filter(Boolean);
        if (clauseTokens.length === 0) return 'ddl.create_table.in_parens';

        const hasTrailingWhitespace = /\s$/.test(normalizedActiveSegment);
        const firstClauseToken = clauseTokens[0];
        if (firstClauseToken === 'UNIQUE' || firstClauseToken === 'CHECK') return 'ddl.create_table.in_parens';

        const datatypeTokenTexts = new Set();
        sqlCoreItemsById.forEach((item) => {
            const kind = String(item?.kind || '').trim().toLowerCase();
            if (kind !== 'datatype') return;
            const text = String(item?.text || '').trim().toUpperCase();
            if (text) datatypeTokenTexts.add(text);
        });

        if (clauseTokens.length === 1) {
            if (firstClauseToken === 'PRIMARY') return 'ddl.after_PRIMARY';
            if (firstClauseToken === 'FOREIGN') return 'ddl.after_FOREIGN';
            return hasTrailingWhitespace ? 'ddl.after_column_name' : 'ddl.create_table.in_parens';
        }

        if (firstClauseToken === 'PRIMARY') {
            const secondClauseToken = clauseTokens[1];
            if (secondClauseToken === 'KEY') return 'ddl.after_key_clause';
            return 'ddl.after_PRIMARY';
        }
        if (firstClauseToken === 'FOREIGN') {
            const secondClauseToken = clauseTokens[1];
            if (secondClauseToken === 'KEY') return 'ddl.after_key_clause';
            return 'ddl.after_FOREIGN';
        }

        const secondClauseToken = clauseTokens[1];
        const hasDatatypeToken = datatypeTokenTexts.has(secondClauseToken);
        if (!hasDatatypeToken) return 'ddl.after_column_name';
        if (clauseTokens.length === 2) {
            return hasTrailingWhitespace ? 'ddl.after_datatype' : 'ddl.after_column_name';
        }

        const lastClauseToken = clauseTokens[clauseTokens.length - 1];
        const prevClauseToken = clauseTokens[clauseTokens.length - 2];
        if (lastClauseToken === 'PRIMARY') return 'ddl.after_PRIMARY';
        if (lastClauseToken === 'FOREIGN') return 'ddl.after_FOREIGN';
        if (prevClauseToken === 'PRIMARY' && lastClauseToken === 'KEY') return 'ddl.after_datatype';
        if (prevClauseToken === 'FOREIGN' && lastClauseToken === 'KEY') return 'ddl.after_key_clause';
        if (prevClauseToken === 'PRIMARY' && 'KEY'.startsWith(lastClauseToken)) return 'ddl.after_PRIMARY';
        if (prevClauseToken === 'FOREIGN' && 'KEY'.startsWith(lastClauseToken)) return 'ddl.after_FOREIGN';

        return 'ddl.after_datatype';
    }

    function deriveSqlCoreStateId(sqlBeforeCursorRaw = '') {
        if (sqlCoreCatalogStatus !== 'ready' || !sqlCoreStatesById.has('stmt.start')) {
            return 'stmt.start';
        }

        const activeSegment = getSqlCoreActiveStatementSegment(sqlBeforeCursorRaw);
        const tokens = tokenizeSqlCoreSegment(activeSegment);
        const ddlHeuristicStateId = deriveSqlCoreCreateTableStateIdByHeuristic(activeSegment, tokens);
        if (ddlHeuristicStateId && sqlCoreStatesById.has(ddlHeuristicStateId)) {
            return ddlHeuristicStateId;
        }
        let stateId = 'stmt.start';

        tokens.forEach((token) => {
            const candidates = getSqlCoreTokenCandidateIds(token);
            if (candidates.size === 0) return;

            let nextStateId = stateId;
            for (let step = 0; step < 6; step += 1) {
                const resolvedState = resolveSqlCoreTransition(nextStateId, candidates);
                if (!resolvedState || resolvedState === nextStateId) break;
                nextStateId = resolvedState;
            }
            stateId = nextStateId;
        });

        return sqlCoreStatesById.has(stateId) ? stateId : 'stmt.start';
    }

    function resolveSqlCoreNextTokenIds(stateId = 'stmt.start') {
        if (!sqlCoreStatesById.has(stateId)) return [];
        const startState = sqlCoreStatesById.get(stateId);
        if (!startState || !Array.isArray(startState.next)) return [];

        const queue = [...startState.next];
        const visitedStates = new Set([stateId]);
        const seenTokenIds = new Set();
        const result = [];

        while (queue.length > 0) {
            const entry = String(queue.shift() || '').trim();
            if (!entry) continue;

            if (sqlCoreItemsById.has(entry)) {
                if (!seenTokenIds.has(entry)) {
                    seenTokenIds.add(entry);
                    result.push(entry);
                }
                continue;
            }

            const nestedState = sqlCoreStatesById.get(entry);
            if (!nestedState || visitedStates.has(entry)) continue;
            visitedStates.add(entry);
            const nestedNext = Array.isArray(nestedState.next) ? nestedState.next : [];
            nestedNext.forEach((nestedEntry) => queue.push(nestedEntry));
        }

        return result;
    }

    function getSqlCoreCursorPrefix(sqlBeforeCursorRaw = '') {
        const activeSegment = getSqlCoreActiveStatementSegment(sqlBeforeCursorRaw);
        if (!activeSegment || /\s$/.test(activeSegment)) return '';

        const placeholderMatch = activeSegment.match(/(<[A-Za-z_][A-Za-z0-9_]*)$/);
        if (placeholderMatch) return String(placeholderMatch[1] || '').toUpperCase();

        const identifierMatch = activeSegment.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
        if (identifierMatch) {
            const candidate = String(identifierMatch[1] || '').toUpperCase();
            // If a full SQL token is already typed (e.g. KEY), suggest the next token
            // without requiring an extra trailing whitespace.
            if (sqlCoreTokenToItemIds.has(candidate)) return '';
            return candidate;
        }

        return '';
    }

    function shouldAppendWhitespaceAfterIntellisenseToken(item = null, tokenText = '') {
        const kind = String(item?.kind || '').trim().toLowerCase();
        const token = String(tokenText || '').trim();
        if (!token) return false;
        if (kind === 'operator' || kind === 'symbol' || kind === 'function') return false;
        if (/^[(),.;]$/.test(token)) return false;
        if (token === '*') return false;
        return true;
    }

    function insertIntellisenseTokenAtCursor(tokenId = '') {
        const resolvedTokenId = String(tokenId || '').trim();
        if (!resolvedTokenId || !sqlCoreItemsById.has(resolvedTokenId)) return;

        const item = sqlCoreItemsById.get(resolvedTokenId);
        const tokenText = String(item?.text || resolvedTokenId).trim();
        if (!tokenText) return;

        const cursor = normalizeEditorCursor(intellisenseInsertAnchor || editor.getCursor()) || editor.getCursor();
        const sqlBeforeCursorRaw = getSqlBeforeCursorRawAt(cursor);
        const prefix = getSqlCoreCursorPrefix(sqlBeforeCursorRaw);
        const prefixLength = Math.max(0, prefix.length);
        const replaceFrom = { line: cursor.line, ch: Math.max(0, Number(cursor.ch || 0) - prefixLength) };
        const replaceTo = { line: cursor.line, ch: Number(cursor.ch || 0) };
        const nextChar = String(editor.getRange(replaceTo, { line: replaceTo.line, ch: replaceTo.ch + 1 }) || '');

        let insertText = tokenText;
        if (shouldAppendWhitespaceAfterIntellisenseToken(item, tokenText) && !/^[\s,.;)\]]/.test(nextChar)) {
            insertText += ' ';
        }

        editor.replaceRange(insertText, replaceFrom, replaceTo, '+intellisense-click');
        captureIntellisenseInsertAnchor(editor.getCursor());
        editor.focus();
        scheduleIntellisensePopupPosition();
    }

    function handleIntellisenseListClick(event) {
        if (!multiIntellisenseList) return;
        const target = event?.target instanceof Element ? event.target : null;
        if (!target) return;
        const rowEl = target.closest('.intellisense-popup-item');
        if (!rowEl || !multiIntellisenseList.contains(rowEl)) return;
        const tokenId = String(rowEl.dataset?.tokenId || '').trim();
        if (!tokenId) return;
        const now = Date.now();
        if (event.type === 'mousedown') {
            event.preventDefault();
            event.stopPropagation();
            intellisenseMouseDownInsertAt = now;
            insertIntellisenseTokenAtCursor(tokenId);
            return;
        }
        if ((now - intellisenseMouseDownInsertAt) < 250) return;
        event.preventDefault();
        event.stopPropagation();
        insertIntellisenseTokenAtCursor(tokenId);
    }

    function filterSqlCoreTokenIdsByPrefix(tokenIds = [], prefix = '') {
        const source = Array.isArray(tokenIds) ? tokenIds : [];
        const normalizedPrefix = String(prefix || '').trim().toUpperCase();
        if (!normalizedPrefix) return source.slice();

        return source.filter((tokenId) => {
            const item = sqlCoreItemsById.get(tokenId);
            const tokenText = String(item?.text || '').trim().toUpperCase();
            return tokenText.startsWith(normalizedPrefix);
        });
    }

    function getSqlCoreSuggestionGroupIds(item = null) {
        const tags = Array.isArray(item?.tags) ? item.tags : [];
        const normalizedTags = new Set(
            tags
                .map((entry) => String(entry || '').trim().toUpperCase())
                .filter(Boolean)
        );
        const groupIds = [];

        SQL_CORE_SUGGESTION_GROUPS.forEach(({ id }) => {
            if (id === 'SHARED') return;
            if (normalizedTags.has(id)) groupIds.push(id);
        });

        if (normalizedTags.has('SHARED') || groupIds.length === 0) {
            groupIds.push('SHARED');
        }

        return [...new Set(groupIds)];
    }

    function groupSqlCoreSuggestionsByLanguage(tokenIds = []) {
        const source = Array.isArray(tokenIds) ? tokenIds : [];
        const grouped = new Map();
        const seenByGroup = new Map();

        SQL_CORE_SUGGESTION_GROUPS.forEach(({ id }) => {
            grouped.set(id, []);
            seenByGroup.set(id, new Set());
        });

        source.forEach((tokenId) => {
            const item = sqlCoreItemsById.get(tokenId);
            if (!item) return;
            const groupIds = getSqlCoreSuggestionGroupIds(item);
            groupIds.forEach((groupId) => {
                if (!grouped.has(groupId) || !seenByGroup.has(groupId)) return;
                if (seenByGroup.get(groupId).has(tokenId)) return;
                seenByGroup.get(groupId).add(tokenId);
                grouped.get(groupId).push(tokenId);
            });
        });

        return grouped;
    }

    function bindEditorSqlFunctionOverlay() {
        editor.addOverlay({
            token(stream) {
                if (stream.match(/[A-Za-z_][A-Za-z0-9_]*/)) {
                    const tokenText = String(stream.current() || '').toUpperCase();
                    if (editorSqlFunctionTokens.has(tokenText)) {
                        const rest = String(stream.string || '').slice(stream.pos);
                        if (/^\s*\(/.test(rest)) return 'sql-function';
                    }
                    return null;
                }
                stream.next();
                return null;
            }
        });
    }

    function syncEditorSqlFunctionTokensFromCatalog() {
        if (!(sqlCoreItemsById instanceof Map) || sqlCoreItemsById.size === 0) return;
        const nextTokens = new Set();
        sqlCoreItemsById.forEach((item) => {
            const kind = String(item?.kind || '').trim().toLowerCase();
            if (kind !== 'function') return;
            const text = String(item?.text || '').trim().toUpperCase();
            if (text) nextTokens.add(text);
        });
        if (nextTokens.size === 0) return;
        editorSqlFunctionTokens.clear();
        nextTokens.forEach((token) => editorSqlFunctionTokens.add(token));
    }

    function getSqlCoreRuntimeAtCursor() {
        const sqlBeforeCursorRaw = getSqlBeforeCursorRaw();
        const progressSnapshot = refreshSqlCoreProgressSnapshot();
        const unlockedSet = buildSqlCoreUnlockedSet(progressSnapshot);
        const stateId = deriveSqlCoreStateId(sqlBeforeCursorRaw);
        const nextTokenIds = resolveSqlCoreNextTokenIds(stateId);
        const unlockedNextTokenIds = nextTokenIds.filter((tokenId) => unlockedSet.has(tokenId));
        const prefix = getSqlCoreCursorPrefix(sqlBeforeCursorRaw);
        const unlockedSuggestionTokenIds = filterSqlCoreTokenIdsByPrefix(unlockedNextTokenIds, prefix);
        const allSuggestionTokenIds = filterSqlCoreTokenIdsByPrefix(nextTokenIds, prefix);
        const lockedSuggestionTokenIds = allSuggestionTokenIds.filter((tokenId) => !unlockedSet.has(tokenId));
        const suggestionTokenIds = [
            ...unlockedSuggestionTokenIds,
            ...lockedSuggestionTokenIds
        ];

        return {
            stateId,
            nextTokenIds,
            unlockedNextTokenIds,
            unlockedSuggestionTokenIds,
            lockedSuggestionTokenIds,
            suggestionTokenIds,
            prefix
        };
    }

    function readStoredIntellisenseEnabled() {
        if (!window?.localStorage) return true;
        try {
            const raw = String(window.localStorage.getItem(INTELLISENSE_ENABLED_STORAGE_KEY) || '').trim();
            if (!raw) return true;
            if (raw === '1' || raw === 'true') return true;
            if (raw === '0' || raw === 'false') return false;
        } catch (error) {
            console.warn('[IntelliSense] Toggle-Status konnte nicht gelesen werden.', error);
        }
        return true;
    }

    function persistIntellisenseEnabled(isEnabled) {
        if (!window?.localStorage) return;
        try {
            window.localStorage.setItem(INTELLISENSE_ENABLED_STORAGE_KEY, isEnabled ? '1' : '0');
        } catch (error) {
            console.warn('[IntelliSense] Toggle-Status konnte nicht gespeichert werden.', error);
        }
    }

    function updateIntellisenseToggleButton() {
        if (!btnToggleIntellisense) return;
        btnToggleIntellisense.textContent = isIntellisenseEnabled ? 'IntelliSense: An' : 'IntelliSense: Aus';
        btnToggleIntellisense.setAttribute('aria-pressed', isIntellisenseEnabled ? 'true' : 'false');
        btnToggleIntellisense.classList.toggle('is-off', !isIntellisenseEnabled);
    }

    function setIntellisenseEnabled(isEnabled, options = {}) {
        const nextEnabled = isEnabled !== false;
        const shouldPersist = options?.persist !== false;
        isIntellisenseEnabled = nextEnabled;
        if (shouldPersist) persistIntellisenseEnabled(nextEnabled);
        updateIntellisenseToggleButton();

        if (!nextEnabled) {
            setIntellisensePopupVisible(false);
            return;
        }
        setIntellisensePopupVisible(editor.hasFocus());
        scheduleIntellisensePopupPosition();
    }

    function applyIntellisensePopupWidth(columnCount = 1) {
        if (!multiIntellisensePanel) return;
        const count = Math.max(1, Math.min(6, Number(columnCount) || 1));
        const rawMaxWidth = Math.max((window.innerWidth || 0) - 20, 0);
        const maxWidth = Math.max(160, rawMaxWidth);
        const minWidth = Math.min(INTELLISENSE_PANEL_MIN_WIDTH, maxWidth);
        const preferredWidth = (count * INTELLISENSE_PANEL_COLUMN_WIDTH)
            + ((count - 1) * INTELLISENSE_PANEL_COLUMN_GAP)
            + INTELLISENSE_PANEL_HORIZONTAL_PADDING;
        const width = Math.max(minWidth, Math.min(preferredWidth, maxWidth));
        multiIntellisensePanel.style.width = `${Math.round(width)}px`;
    }

    function renderIntellisensePopupLoaderMessage(options = {}) {
        if (!multiIntellisenseList) return;
        const force = options?.force === true;
        const children = Array.from(multiIntellisenseList.children || []);
        const hasNonEmptyChildren = children.some((child) => !child.classList?.contains('intellisense-popup-empty'));
        if (!force && hasNonEmptyChildren) return;
        applyIntellisensePopupWidth(1);

        let message = 'IntelliSense wird vorbereitet ...';
        if (sqlCoreCatalogStatus === 'loading') {
            message = 'IntelliSense SQL-Core wird geladen ...';
        } else if (sqlCoreCatalogStatus === 'ready') {
            message = `SQL-Core geladen: ${sqlCoreItemsById.size} Tokens · ${sqlCoreStatesById.size} States`;
        } else if (sqlCoreCatalogStatus === 'error') {
            message = 'IntelliSense SQL-Core konnte nicht geladen werden.';
        }
        renderIntellisensePopupEmptyMessage(message);
    }

    function renderIntellisensePopupEmptyMessage(message = '') {
        if (!multiIntellisenseList) return;
        multiIntellisenseList.textContent = '';
        const emptyEl = document.createElement('div');
        emptyEl.className = 'intellisense-popup-empty';
        emptyEl.textContent = String(message || '').trim();
        multiIntellisenseList.appendChild(emptyEl);
    }

    function renderIntellisensePopupSuggestions(runtime = null) {
        if (!multiIntellisenseList) return;
        if (sqlCoreCatalogStatus !== 'ready') {
            renderIntellisensePopupLoaderMessage({ force: true });
            return;
        }

        const activeRuntime = runtime && typeof runtime === 'object' ? runtime : getSqlCoreRuntimeAtCursor();
        const nextTokenIds = Array.isArray(activeRuntime?.nextTokenIds) ? activeRuntime.nextTokenIds : [];
        const unlockedNextTokenIds = Array.isArray(activeRuntime?.unlockedNextTokenIds) ? activeRuntime.unlockedNextTokenIds : [];
        const unlockedSuggestionTokenIds = Array.isArray(activeRuntime?.unlockedSuggestionTokenIds)
            ? activeRuntime.unlockedSuggestionTokenIds
            : [];
        const lockedSuggestionTokenIds = Array.isArray(activeRuntime?.lockedSuggestionTokenIds)
            ? activeRuntime.lockedSuggestionTokenIds
            : [];
        const suggestionTokenIds = Array.isArray(activeRuntime?.suggestionTokenIds) ? activeRuntime.suggestionTokenIds : [];
        const prefix = String(activeRuntime?.prefix || '').trim();
        const unlockedSuggestionSet = new Set(unlockedSuggestionTokenIds);
        const groupedSuggestions = groupSqlCoreSuggestionsByLanguage(suggestionTokenIds);
        const visibleGroups = SQL_CORE_SUGGESTION_GROUPS.filter(({ id }) => {
            const entries = groupedSuggestions.get(id);
            return Array.isArray(entries) && entries.length > 0;
        });

        if (suggestionTokenIds.length === 0) {
            applyIntellisensePopupWidth(1);
            let emptyMessage = 'Keine Vorschlaege verfuegbar.';
            if (nextTokenIds.length === 0) {
                emptyMessage = 'Keine Folgetokens fuer den aktuellen State.';
            } else if (prefix) {
                emptyMessage = `Keine Vorschlaege fuer Prefix "${prefix}".`;
            } else if (unlockedNextTokenIds.length === 0) {
                emptyMessage = 'Keine Vorschlaege fuer den aktuellen State.';
            }
            renderIntellisensePopupEmptyMessage(emptyMessage);
            return;
        }

        const columnCount = Math.max(1, visibleGroups.length);
        applyIntellisensePopupWidth(columnCount);
        if (multiIntellisensePanel) {
            multiIntellisensePanel.style.setProperty('--mi-column-width', `${INTELLISENSE_PANEL_COLUMN_WIDTH}px`);
        }
        multiIntellisenseList.textContent = '';
        const columnsEl = document.createElement('div');
        columnsEl.className = 'intellisense-popup-columns';

        visibleGroups.forEach(({ id, label }) => {
            const groupTokenIds = groupedSuggestions.get(id) || [];
            if (!Array.isArray(groupTokenIds) || groupTokenIds.length === 0) return;

            const columnEl = document.createElement('section');
            columnEl.className = 'intellisense-popup-column';
            columnEl.dataset.groupId = id;

            const titleEl = document.createElement('div');
            titleEl.className = 'intellisense-popup-column-title';
            titleEl.textContent = label;

            const listEl = document.createElement('div');
            listEl.className = 'intellisense-popup-column-list';

            groupTokenIds.forEach((tokenId) => {
                const item = sqlCoreItemsById.get(tokenId);
                if (!item) return;
                const isLocked = !unlockedSuggestionSet.has(tokenId);

                const rowEl = document.createElement('div');
                rowEl.className = 'intellisense-popup-item';
                if (isLocked) rowEl.classList.add('is-locked');
                rowEl.dataset.tokenId = tokenId;
                rowEl.dataset.kind = String(item.kind || '').trim().toLowerCase();

                const tokenEl = document.createElement('div');
                tokenEl.className = 'intellisense-popup-token';

                const keywordsLineEl = document.createElement('div');
                keywordsLineEl.className = 'intellisense-popup-keywords-line';
                keywordsLineEl.textContent = String(item.text || tokenId);

                tokenEl.appendChild(keywordsLineEl);
                rowEl.appendChild(tokenEl);
                listEl.appendChild(rowEl);
            });

            columnEl.appendChild(titleEl);
            columnEl.appendChild(listEl);
            columnsEl.appendChild(columnEl);
        });

        multiIntellisenseList.appendChild(columnsEl);
        if (lockedSuggestionTokenIds.length > 0 && unlockedSuggestionTokenIds.length === 0) {
            const hintEl = document.createElement('div');
            hintEl.className = 'intellisense-popup-empty';
            hintEl.textContent = 'Hinweis: passende Vorschlaege sind noch gesperrt.';
            multiIntellisenseList.appendChild(hintEl);
        }
    }

    async function initSqlCoreCatalog() {
        if (!multiIntellisensePanel) return;
        sqlCoreCatalogStatus = 'loading';
        resetSqlCoreCatalogRuntime();
        renderIntellisensePopupLoaderMessage({ force: true });
        scheduleIntellisensePopupPosition();

        try {
            const response = await fetch('app-data/IntelliSense-SQL-Core.json', { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const payload = await response.json();
            const normalized = normalizeSqlCoreCatalogPayload(payload);
            if (normalized.itemsById.size === 0 || normalized.statesById.size === 0) {
                throw new Error('SQL-Core payload enthaelt keine gueltigen items/states.');
            }

            sqlCoreCatalogMeta = {
                dialect: normalized.dialect,
                version: normalized.version,
                storageKey: normalized.storageKey,
                storageSchema: normalized.storageSchema
            };
            sqlCoreItemsById = normalized.itemsById;
            sqlCoreStatesById = normalized.statesById;
            sqlCoreTransitionsByFrom = normalized.transitionsByFrom;
            sqlCoreTokenToItemIds = buildSqlCoreTokenLookup(sqlCoreItemsById);
            syncEditorSqlFunctionTokensFromCatalog();
            refreshSqlCoreProgressSnapshot({ persistNormalized: true });
            sqlCoreCatalogStatus = 'ready';
        } catch (error) {
            sqlCoreCatalogStatus = 'error';
            resetSqlCoreCatalogRuntime();
            console.warn('[IntelliSense SQL-Core] Laden fehlgeschlagen.', error);
        }

        renderIntellisensePopupLoaderMessage({ force: true });
        if (multiIntellisenseDebugEl) {
            multiIntellisenseDebugEl.classList.add('is-hidden');
            multiIntellisenseDebugEl.textContent = '';
        }
        scheduleIntellisensePopupPosition();
    }

    function ensureIntellisensePopupOverlayHost() {
        if (!multiIntellisensePanel) return;
        if (multiIntellisensePanel.parentElement === document.body) return;
        document.body.appendChild(multiIntellisensePanel);
    }

    function ensureIntellisensePopupScaffold() {
        renderIntellisensePopupLoaderMessage();
    }

    function setIntellisensePopupVisible(isVisible) {
        if (!multiIntellisensePanel) return;
        multiIntellisensePanel.classList.toggle('is-hidden', !isVisible || !isIntellisenseEnabled);
    }

    function positionIntellisensePopupNearCursor() {
        if (!multiIntellisensePanel || multiIntellisensePanel.classList.contains('is-hidden')) return;
        // The popup uses `position: fixed`, so cursor coordinates must be viewport-relative.
        const coords = editor.cursorCoords(editor.getCursor(), 'window');
        const panelRect = multiIntellisensePanel.getBoundingClientRect();
        if (!Number.isFinite(panelRect.width) || !Number.isFinite(panelRect.height)) return;

        const gutter = 8;
        const offsetX = 14;
        const offsetY = 10;
        const viewportWidth = Math.max(window.innerWidth || 0, 0);
        const viewportHeight = Math.max(window.innerHeight || 0, 0);

        let left = Number(coords.left || 0) + offsetX;
        let top = Number(coords.bottom || 0) + offsetY;

        const maxLeft = Math.max(gutter, viewportWidth - panelRect.width - gutter);
        if (left > maxLeft) {
            left = Math.max(gutter, Number(coords.left || 0) - panelRect.width - offsetX);
        }
        left = Math.max(gutter, Math.min(left, maxLeft));

        const maxTop = Math.max(gutter, viewportHeight - panelRect.height - gutter);
        if (top > maxTop) {
            top = Math.max(gutter, Number(coords.top || 0) - panelRect.height - offsetY);
        }
        top = Math.max(gutter, Math.min(top, maxTop));

        multiIntellisensePanel.style.left = `${Math.round(left)}px`;
        multiIntellisensePanel.style.top = `${Math.round(top)}px`;
    }

    function scheduleIntellisensePopupPosition() {
        if (!multiIntellisensePanel) return;
        if (!isIntellisenseEnabled) {
            setIntellisensePopupVisible(false);
            return;
        }
        captureIntellisenseInsertAnchor(editor.getCursor());
        if (intellisensePositionRafId) cancelAnimationFrame(intellisensePositionRafId);
        intellisensePositionRafId = requestAnimationFrame(() => {
            intellisensePositionRafId = 0;
            ensureIntellisensePopupScaffold();
            const runtime = sqlCoreCatalogStatus === 'ready' ? getSqlCoreRuntimeAtCursor() : null;
            renderIntellisensePopupSuggestions(runtime);
            positionIntellisensePopupNearCursor();
        });
    }

    isIntellisenseEnabled = readStoredIntellisenseEnabled();
    updateIntellisenseToggleButton();

    // Resize Handling
    function clearCanvas() {
        ctx.clearRect(0, 0, topCanvas.width, topCanvas.height);
    }

    function resizeCanvas() {
        const stageWidth = Math.max(Math.ceil(schemaStage.clientWidth), 1);
        const stageHeight = Math.max(
            Math.ceil(schemaStage.clientHeight),
            Math.ceil(tablesContainer.offsetTop + tablesContainer.offsetHeight + 24),
            1
        );

        if (topCanvas.width !== stageWidth) topCanvas.width = stageWidth;
        if (topCanvas.height !== stageHeight) topCanvas.height = stageHeight;

        drawRelationships();
    }

    window.addEventListener('resize', () => {
        editor.refresh();
        resizeCanvas();
        scheduleIntellisensePopupPosition();
    });

    const stageResizeObserver = new ResizeObserver(() => {
        resizeCanvas();
    });
    stageResizeObserver.observe(centerContent);
    stageResizeObserver.observe(tablesContainer);

    editor.on('change', () => {
        resetProcessLogEntries();
        renderDiagnostics([]);
        scheduleIntellisensePopupPosition();
        scheduleLiveLessonTaskEvaluation();
        scheduleLiveStoryReadinessEvaluation();
    });

    editor.on('cursorActivity', () => {
        scheduleIntellisensePopupPosition();
    });

    editor.on('scroll', () => {
        scheduleIntellisensePopupPosition();
    });

    editor.on('focus', () => {
        setIntellisensePopupVisible(true);
        scheduleIntellisensePopupPosition();
    });

    editor.on('blur', () => {
        setIntellisensePopupVisible(false);
    });

    // Initial Resize
    requestAnimationFrame(resizeCanvas);
    requestAnimationFrame(() => {
        ensureIntellisensePopupOverlayHost();
        renderDiagnostics([]);
        setIntellisensePopupVisible(editor.hasFocus());
        scheduleIntellisensePopupPosition();
    });

    function buildResultTableWrap(preview, options = {}) {
        const {
            wrapperClass = 'step-result-table-wrap',
            tableClass = 'step-result-table'
        } = options;
        const columns = Array.isArray(preview?.columns) ? preview.columns : [];
        const rows = Array.isArray(preview?.rows) ? preview.rows : [];
        if (columns.length === 0) return null;

        const wrapEl = document.createElement('div');
        wrapEl.className = wrapperClass;

        const tableEl = document.createElement('table');
        tableEl.className = `db-table ${tableClass}`;

        const theadEl = document.createElement('thead');
        const headRowEl = document.createElement('tr');
        columns.forEach((columnName) => {
            const thEl = document.createElement('th');
            thEl.textContent = String(columnName);
            headRowEl.appendChild(thEl);
        });
        theadEl.appendChild(headRowEl);
        tableEl.appendChild(theadEl);

        const tbodyEl = document.createElement('tbody');
        rows.forEach((row) => {
            const rowEl = document.createElement('tr');
            const values = Array.isArray(row) ? row : [];
            for (let i = 0; i < columns.length; i++) {
                const tdEl = document.createElement('td');
                tdEl.textContent = formatValueForPreview(values[i]);
                rowEl.appendChild(tdEl);
            }
            tbodyEl.appendChild(rowEl);
        });
        tableEl.appendChild(tbodyEl);
        wrapEl.appendChild(tableEl);

        const overflowCount = Number(preview?.overflowCount || 0);
        if (overflowCount > 0) {
            const moreEl = document.createElement('div');
            moreEl.className = 'step-result-more';
            moreEl.textContent = `+${overflowCount} weitere Zeilen`;
            wrapEl.appendChild(moreEl);
        }

        return wrapEl;
    }

    function normalizePreviewColumnLabel(value = '') {
        return String(value || '').trim().toLowerCase();
    }

    function findPreviewColumnIndex(columns = [], target = '') {
        const safeColumns = Array.isArray(columns) ? columns : [];
        const normalizedTarget = normalizePreviewColumnLabel(target);
        if (!normalizedTarget) return -1;

        let index = safeColumns.findIndex((entry) => normalizePreviewColumnLabel(entry) === normalizedTarget);
        if (index >= 0) return index;

        const targetSuffix = normalizedTarget.includes('.') ? normalizedTarget.split('.').pop() : normalizedTarget;
        index = safeColumns.findIndex((entry) => {
            const normalized = normalizePreviewColumnLabel(entry);
            if (!normalized) return false;
            const suffix = normalized.includes('.') ? normalized.split('.').pop() : normalized;
            return suffix === targetSuffix;
        });
        return index;
    }

    function buildPreviewSubset(preview, includeIndices = []) {
        const source = preview && typeof preview === 'object' ? preview : null;
        if (!source) return null;

        const safeColumns = Array.isArray(source.columns) ? source.columns : [];
        const safeRows = Array.isArray(source.rows) ? source.rows : [];
        const indices = [...new Set((Array.isArray(includeIndices) ? includeIndices : [])
            .map((entry) => Number(entry))
            .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry < safeColumns.length))]
            .sort((a, b) => a - b);

        if (indices.length === 0) return null;

        return {
            columns: indices.map((index) => String(safeColumns[index] || '')),
            rows: safeRows.map((row) => indices.map((index) => Array.isArray(row) ? row[index] : null)),
            overflowCount: Number(source.overflowCount || 0),
            totalRows: Number(source.totalRows || 0),
            maxPreviewRows: Number(source.maxPreviewRows || 0)
        };
    }

    function buildSelectAnimationPayload(sourcePreview, selectedPreview) {
        const source = cloneStepPreview(sourcePreview);
        const projected = cloneStepPreview(selectedPreview);
        if (!source || !projected) return null;
        if (!Array.isArray(source.columns) || source.columns.length === 0) return null;
        if (!Array.isArray(projected.columns) || projected.columns.length === 0) return null;

        const selectedSourceIndices = [];
        projected.columns.forEach((columnName) => {
            const index = findPreviewColumnIndex(source.columns, columnName);
            if (index >= 0) selectedSourceIndices.push(index);
        });

        const uniqueSelected = [...new Set(selectedSourceIndices)];
        if (uniqueSelected.length === 0) {
            const fallbackCount = Math.min(source.columns.length, projected.columns.length);
            for (let i = 0; i < fallbackCount; i++) uniqueSelected.push(i);
        }

        const droppedSourceIndices = source.columns
            .map((_, index) => index)
            .filter((index) => !uniqueSelected.includes(index));

        let leftFragment = null;
        let rightFragment = null;
        if (projected.columns.length >= 2) {
            const splitPoint = Math.ceil(projected.columns.length / 2);
            const leftIndices = Array.from({ length: splitPoint }, (_, index) => index);
            const rightIndices = Array.from({ length: projected.columns.length - splitPoint }, (_, index) => splitPoint + index);
            leftFragment = buildPreviewSubset(projected, leftIndices);
            rightFragment = buildPreviewSubset(projected, rightIndices);
        } else {
            leftFragment = cloneStepPreview(projected);
        }

        return {
            source,
            projected,
            selectedSourceIndices: uniqueSelected,
            droppedSourceIndices,
            leftFragment,
            rightFragment
        };
    }

    function applyColumnClassToTableWrap(wrapEl, indices = [], className = '') {
        const safeIndices = [...new Set((Array.isArray(indices) ? indices : [])
            .map((entry) => Number(entry))
            .filter((entry) => Number.isInteger(entry) && entry >= 0))];
        if (!wrapEl || safeIndices.length === 0 || !className) return;

        const rows = wrapEl.querySelectorAll('tr');
        rows.forEach((rowEl) => {
            safeIndices.forEach((index) => {
                const cell = rowEl.children?.[index];
                if (cell) cell.classList.add(className);
            });
        });
    }

    function buildSelectAnimationScene(selectAnimation = {}) {
        const sourcePreview = selectAnimation?.source;
        const projectedPreview = selectAnimation?.projected;
        if (!sourcePreview || !projectedPreview) return null;

        const sourceWrap = buildResultTableWrap(sourcePreview, {
            wrapperClass: 'process-result-table-wrap process-select-source',
            tableClass: 'process-result-table'
        });
        const mergedWrap = buildResultTableWrap(projectedPreview, {
            wrapperClass: 'process-result-table-wrap process-select-merged',
            tableClass: 'process-result-table'
        });
        if (!sourceWrap || !mergedWrap) return null;

        applyColumnClassToTableWrap(sourceWrap, selectAnimation.selectedSourceIndices, 'process-select-highlight');
        applyColumnClassToTableWrap(sourceWrap, selectAnimation.droppedSourceIndices, 'process-select-drop');

        const scene = document.createElement('div');
        scene.className = 'process-select-scene';
        scene.appendChild(sourceWrap);

        const leftFragmentPreview = selectAnimation?.leftFragment;
        const rightFragmentPreview = selectAnimation?.rightFragment;
        if (leftFragmentPreview) {
            const leftWrap = buildResultTableWrap(leftFragmentPreview, {
                wrapperClass: 'process-result-table-wrap process-select-fragment process-select-fragment-left',
                tableClass: 'process-result-table'
            });
            if (leftWrap) scene.appendChild(leftWrap);
        }
        if (rightFragmentPreview && Array.isArray(rightFragmentPreview.columns) && rightFragmentPreview.columns.length > 0) {
            const rightWrap = buildResultTableWrap(rightFragmentPreview, {
                wrapperClass: 'process-result-table-wrap process-select-fragment process-select-fragment-right',
                tableClass: 'process-result-table'
            });
            if (rightWrap) scene.appendChild(rightWrap);
        }

        scene.appendChild(mergedWrap);
        return scene;
    }

    function buildJoinAnimationScene(joinAnimation = {}) {
        const leftPreview = joinAnimation?.left;
        const rightPreview = joinAnimation?.right;
        const mergedPreview = joinAnimation?.merged;
        if (!leftPreview || !rightPreview || !mergedPreview) return null;

        const leftWrap = buildResultTableWrap(leftPreview, {
            wrapperClass: 'process-result-table-wrap process-join-table process-join-left',
            tableClass: 'process-result-table'
        });
        const rightWrap = buildResultTableWrap(rightPreview, {
            wrapperClass: 'process-result-table-wrap process-join-table process-join-right',
            tableClass: 'process-result-table'
        });
        const mergedWrap = buildResultTableWrap(mergedPreview, {
            wrapperClass: 'process-result-table-wrap process-join-merged',
            tableClass: 'process-result-table'
        });

        if (!leftWrap || !rightWrap || !mergedWrap) return null;

        const scene = document.createElement('div');
        scene.className = 'process-join-scene';
        scene.appendChild(leftWrap);
        scene.appendChild(rightWrap);
        scene.appendChild(mergedWrap);
        return scene;
    }

    function hideProcessResultPanel() {
        if (queryStagePane) {
            queryStagePane.classList.add('is-hidden');
        }
        if (!processResultPanel) return;
        processResultPanel.classList.add('is-hidden');
        if (processResultBody) processResultBody.innerHTML = '';
        if (processResultStepLabel) processResultStepLabel.textContent = '';
    }

    function renderProcessResultPanel(preview, stepType = '') {
        if (!processResultPanel || !processResultBody) return;
        const normalizedStepType = String(stepType || '').toUpperCase();
        let contentNode = null;

        if (normalizedStepType === 'SELECT' && preview?.selectAnimation) {
            contentNode = buildSelectAnimationScene(preview.selectAnimation);
        }

        if (normalizedStepType === 'JOIN' && preview?.joinAnimation) {
            contentNode = buildJoinAnimationScene(preview.joinAnimation);
        }

        if (!contentNode) {
            contentNode = buildResultTableWrap(preview, {
                wrapperClass: 'process-result-table-wrap',
                tableClass: 'process-result-table'
            });
        }
        if (!contentNode) {
            hideProcessResultPanel();
            return;
        }

        processResultBody.innerHTML = '';
        processResultBody.appendChild(contentNode);
        if (queryStagePane) {
            queryStagePane.classList.remove('is-hidden');
        }
        processResultPanel.classList.remove('is-hidden');

        if (processResultStepLabel) {
            processResultStepLabel.textContent = String(stepType || '').toUpperCase();
        }

        [...processResultPanel.classList]
            .filter((name) => name.startsWith('process-anim-'))
            .forEach((name) => processResultPanel.classList.remove(name));

        if (stepType) {
            const animationClass = `process-anim-${sanitizeClassName(stepType)}`;
            processResultPanel.classList.add(animationClass);
        }
    }

    function normalizePrivilegeList(privileges) {
        if (!Array.isArray(privileges)) return [];
        return [...new Set(
            privileges
                .map((entry) => String(entry || '').trim().toUpperCase())
                .filter(Boolean)
        )];
    }

    function makeGrantKey(grantee, entity) {
        return `${String(grantee || '').toLowerCase()}::${String(entity || '').toLowerCase()}`;
    }

    function applyProcessRuntimeStep(step) {
        const type = String(step?.type || '').toUpperCase();
        if (!type) return;

        if (DCL_STEP_TYPES.has(type)) {
            processRuntimeState.lastGuideCategory = 'dcl';
        } else if (TCL_STEP_TYPES.has(type)) {
            processRuntimeState.lastGuideCategory = 'tcl';
        }

        if (type === 'BEGIN') {
            processRuntimeState.transaction.active = true;
            processRuntimeState.transaction.lastAction = 'BEGIN';
            return;
        }

        if (type === 'COMMIT') {
            processRuntimeState.transaction.active = false;
            processRuntimeState.transaction.savepoints = [];
            processRuntimeState.transaction.lastAction = 'COMMIT';
            return;
        }

        if (type === 'SAVEPOINT') {
            const savepoint = String(step?.savepoint || '').trim();
            if (savepoint && !processRuntimeState.transaction.savepoints.includes(savepoint)) {
                processRuntimeState.transaction.savepoints.push(savepoint);
            }
            processRuntimeState.transaction.active = true;
            processRuntimeState.transaction.lastAction = savepoint ? `SAVEPOINT ${savepoint}` : 'SAVEPOINT';
            return;
        }

        if (type === 'ROLLBACK') {
            const savepoint = String(step?.savepoint || '').trim();
            if (savepoint) {
                const index = processRuntimeState.transaction.savepoints.indexOf(savepoint);
                if (index >= 0) {
                    processRuntimeState.transaction.savepoints = processRuntimeState.transaction.savepoints.slice(0, index + 1);
                }
                processRuntimeState.transaction.active = true;
                processRuntimeState.transaction.lastAction = `ROLLBACK TO ${savepoint}`;
            } else {
                processRuntimeState.transaction.active = false;
                processRuntimeState.transaction.savepoints = [];
                processRuntimeState.transaction.lastAction = 'ROLLBACK';
            }
            return;
        }

        if (type === 'GRANT') {
            const grantee = String(step?.grantee || '').trim().toLowerCase();
            const entity = String(step?.entity || '').trim().toLowerCase();
            const privileges = normalizePrivilegeList(step?.privileges);
            if (!grantee || !entity || privileges.length === 0) return;

            const key = makeGrantKey(grantee, entity);
            if (!processRuntimeState.grants.has(key)) {
                processRuntimeState.grants.set(key, {
                    grantee,
                    entity,
                    privileges: new Set()
                });
            }

            const grantEntry = processRuntimeState.grants.get(key);
            privileges.forEach((privilege) => grantEntry.privileges.add(privilege));
            return;
        }

        if (type === 'REVOKE') {
            const grantee = String(step?.grantee || '').trim().toLowerCase();
            const entity = String(step?.entity || '').trim().toLowerCase();
            const privileges = normalizePrivilegeList(step?.privileges);
            if (!grantee || !entity || privileges.length === 0) return;

            const key = makeGrantKey(grantee, entity);
            const grantEntry = processRuntimeState.grants.get(key);
            if (!grantEntry) return;

            privileges.forEach((privilege) => grantEntry.privileges.delete(privilege));
            if (grantEntry.privileges.size === 0) {
                processRuntimeState.grants.delete(key);
            }
        }
    }

    function buildDclGuidePreview() {
        const rows = [...processRuntimeState.grants.values()]
            .sort((left, right) => {
                if (left.grantee !== right.grantee) return left.grantee.localeCompare(right.grantee);
                return left.entity.localeCompare(right.entity);
            })
            .map((entry) => [
                entry.grantee,
                entry.entity,
                [...entry.privileges].sort().join(', ')
            ]);

        const normalizedRows = rows.length > 0 ? rows : [['-', '-', 'keine Rechte gesetzt']];
        return {
            columns: ['grantee', 'object', 'privileges'],
            rows: normalizedRows,
            totalRows: normalizedRows.length,
            overflowCount: 0,
            maxPreviewRows: normalizedRows.length
        };
    }

    function buildTclGuidePreview() {
        const savepoints = processRuntimeState.transaction.savepoints;
        const rows = [
            ['transaction', processRuntimeState.transaction.active ? 'aktiv' : 'inaktiv'],
            ['savepoints', savepoints.length > 0 ? savepoints.join(', ') : '-'],
            ['last action', processRuntimeState.transaction.lastAction || '-']
        ];

        return {
            columns: ['state', 'value'],
            rows,
            totalRows: rows.length,
            overflowCount: 0,
            maxPreviewRows: rows.length
        };
    }

    function buildGuideRuntimePreview(step) {
        const type = String(step?.type || '').toUpperCase();
        let category = '';
        if (DCL_STEP_TYPES.has(type)) {
            category = 'dcl';
        } else if (TCL_STEP_TYPES.has(type)) {
            category = 'tcl';
        } else if (type === 'RESULT') {
            category = processRuntimeState.lastGuideCategory;
        }

        if (category === 'dcl') return buildDclGuidePreview();
        if (category === 'tcl') return buildTclGuidePreview();
        return null;
    }


    // Helper: Render Steps initially
    function renderSteps(steps) {
        if (!chatContainer) return;
        chatContainer.innerHTML = '';
        const statementIndexes = new Set(steps.map((step) => Number(step.statementIndex || 1)));
        const showStatementDividers = statementIndexes.size > 1;
        let lastStatementIndex = null;

        steps.forEach((step, index) => {
            const currentStatementIndex = Number(step.statementIndex || 1);
            if (showStatementDividers && currentStatementIndex !== lastStatementIndex) {
                const dividerEl = document.createElement('div');
                dividerEl.className = 'step-statement-divider';
                dividerEl.textContent = `Statement ${currentStatementIndex}`;
                dividerEl.dataset.statementIndex = String(currentStatementIndex);
                dividerEl.classList.add('step-hidden');
                chatContainer.appendChild(dividerEl);
                lastStatementIndex = currentStatementIndex;
            }

            const stepEl = document.createElement('div');
            stepEl.className = 'step-item pending step-hidden';
            stepEl.id = `step-${index}`;
            stepEl.dataset.statementIndex = String(currentStatementIndex);
            if (isCreatePipelineStep(step)) {
                stepEl.classList.add('ddl-step');
            }

            const headerEl = document.createElement('div');
            headerEl.className = 'step-header';

            const typeEl = document.createElement('span');
            typeEl.className = 'step-type';
            typeEl.textContent = step.type;
            headerEl.appendChild(typeEl);

            const statusEl = document.createElement('div');
            statusEl.className = 'step-status-icon';
            headerEl.appendChild(statusEl);
            stepEl.appendChild(headerEl);

            const descriptionText = String(step.description || '').trim();
            if (descriptionText) {
                const descEl = document.createElement('div');
                descEl.className = 'step-desc';
                descEl.textContent = descriptionText;
                stepEl.appendChild(descEl);
            }

            if (step.resultTable) {
                const resultTableEl = buildResultTableWrap(step.resultTable, {
                    wrapperClass: 'step-result-table-wrap',
                    tableClass: 'step-result-table'
                });
                if (resultTableEl) {
                    stepEl.appendChild(resultTableEl);
                }
            } else if (step.code) {
                const codeEl = document.createElement('code');
                codeEl.className = 'step-code';
                codeEl.textContent = step.code;
                stepEl.appendChild(codeEl);
            }

            if (Array.isArray(step.details) && step.details.length > 0) {
                const detailsEl = document.createElement('ul');
                detailsEl.className = 'step-detail-list';
                step.details.forEach((detail) => {
                    const itemEl = document.createElement('li');
                    itemEl.textContent = detail.replace(/`/g, '');
                    detailsEl.appendChild(itemEl);
                });
                stepEl.appendChild(detailsEl);
            }

            const progressEl = document.createElement('div');
            progressEl.className = 'step-progress';
            stepEl.appendChild(progressEl);

            chatContainer.appendChild(stepEl);
        });
    }

    function revealStepElement(el) {
        if (!el) return;
        if (!el.classList.contains('step-hidden')) return;
        el.classList.remove('step-hidden');
        el.classList.add('step-reveal');
        setTimeout(() => {
            el.classList.remove('step-reveal');
        }, 240);
    }

    function revealStatementDivider(statementIndex) {
        if (!chatContainer) return;
        const divider = chatContainer.querySelector(`.step-statement-divider[data-statement-index="${statementIndex}"]`);
        revealStepElement(divider);
    }

    // WP5 Helper: Render Data Tables (Extended for Attributes)
    function renderTables(data) {
        tablesContainer.innerHTML = '';
        if (!data || !data.TABLES) return;

        Object.keys(data.TABLES).forEach(tableName => {
            const tableData = data.TABLES[tableName];
            const card = document.createElement('div');
            card.className = 'table-card';
            card.id = `table-card-${tableName}`;
            card.dataset.tableName = tableName;
            const tableMeta = tableData.__meta || {};

            if (tableMeta.draft) card.classList.add('table-card-draft');
            if (tableMeta.phase) card.classList.add(`table-phase-${sanitizeClassName(tableMeta.phase)}`);

            const rows = Array.isArray(tableData.rows) ? tableData.rows : [];
            const columns = Array.isArray(tableData.columns) ? tableData.columns : [];

            // Generate Header
            let html = `<div class="table-card-header">
                            <span>${tableName}</span>
                        </div>`;

            if (columns.length === 0) {
                html += `<div class="table-card-placeholder">
                            <span>${tableMeta.placeholder || 'Schema wird vorbereitet ...'}</span>
                            <div class="placeholder-line"></div>
                            <div class="placeholder-line short"></div>
                         </div>`;
                card.innerHTML = html;
                tablesContainer.appendChild(card);
                return;
            }

            // Generate Table
            html += `<table class="db-table" id="table-${tableName}">
                        <thead><tr>`;

            columns.forEach(col => {
                const colName = col.name || col;
                const colType = (col.type || '').toUpperCase();

                let keyIcons = '';
                let tooltipParts = [];

                // 1. Key Icons
                if (col.isPK) {
                    keyIcons += '🔑 ';
                    tooltipParts.push('Primary Key');
                }
                if (col.isFK) {
                    keyIcons += '🔗 ';
                    tooltipParts.push('Foreign Key');
                }

                // 2. Type Icons
                let typeIcon = '';
                if (['DATETIMESTAMP'].some(t => colType.includes(t))) typeIcon = '📅⏱️';
                else if (['TIMESTAMP'].some(t => colType.includes(t))) typeIcon = '⏱️';
                else if (['DATETIME'].some(t => colType.includes(t))) typeIcon = '📅🕒';
                else if (['DATE'].some(t => colType.includes(t))) typeIcon = '📅';
                else if (['TIME'].some(t => colType.includes(t))) typeIcon = '🕒';
                else if (['INTEGER', 'INT', 'BIGINT', 'SMALLINT', 'TINYINT'].some(t => colType.includes(t))) typeIcon = '🔢';
                else if (['FLOAT', 'DOUBLE', 'DECIMAL', 'NUMERIC', 'REAL'].some(t => colType.includes(t))) typeIcon = '#️⃣';
                else if (['TEXT', 'VARCHAR', 'STRING', 'CLOB'].some(t => colType.includes(t))) typeIcon = '📝';
                else if (['BLOB', 'BINARY'].some(t => colType.includes(t))) typeIcon = '💾';
                else if (['BOOLEAN', 'BOOL'].some(t => colType.includes(t))) typeIcon = '✅ ❌';
                else if (['CHAR', 'CHARACTER'].some(t => colType.includes(t))) typeIcon = '🔤 🆎';
                else typeIcon = '❓';

                tooltipParts.push(colType);
                const finalTooltip = tooltipParts.join(' | ');
                const keyIconsHtml = keyIcons
                    ? `<span class="th-key-icons">${keyIcons.trim()}</span>`
                    : '';

                // Add data attributes for relationship drawing
                const isPkAttr = col.isPK ? 'true' : 'false';
                const isFkAttr = col.isFK ? 'true' : 'false';
                const fkTargetAttr = col.fkTarget || '';

                html += `<th data-title="${finalTooltip}" 
                             data-col-name="${colName}"
                             data-table="${tableName}"
                             data-is-pk="${isPkAttr}"
                             data-is-fk="${isFkAttr}"
                             data-fk-target="${fkTargetAttr}">
                             <div class="th-content">
                                 <span class="th-left">
                                     ${keyIconsHtml}
                                     <span class="th-col-name">${colName}</span>
                                 </span>
                                 <span class="th-type-icon">${typeIcon}</span>
                             </div>
                         </th>`;
            });
            html += `</tr></thead>
                     <tbody>`;

            rows.forEach((row, rIndex) => {
                html += `<tr id="row-${tableName}-${rIndex}" class="table-row">`;
                const cells = Array.isArray(row) ? row : Object.values(row);
                cells.forEach(cell => {
                    html += `<td>${cell}</td>`;
                });
                html += `</tr>`;
            });
            html += `</tbody></table>`;

            card.innerHTML = html;
            tablesContainer.appendChild(card);
        });

        // After render, resize canvas and redraw lines
        setTimeout(resizeCanvas, 50); // slight delay for layout
    }


    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function toLocalRect(rect, stageRect) {
        return {
            left: rect.left - stageRect.left,
            right: rect.right - stageRect.left,
            top: rect.top - stageRect.top,
            bottom: rect.bottom - stageRect.top,
            width: rect.width,
            height: rect.height
        };
    }

    function getDirectionUnit(from, to) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.hypot(dx, dy);

        if (length === 0) {
            return { x: 1, y: 0 };
        }

        return {
            x: dx / length,
            y: dy / length
        };
    }

    function drawCardinalityLabel(anchor, toward, label, color) {
        const unit = getDirectionUnit(anchor, toward);
        const perp = { x: -unit.y, y: unit.x };
        const labelBase = {
            x: anchor.x + unit.x * 14,
            y: anchor.y + unit.y * 14
        };

        ctx.save();
        ctx.fillStyle = color;
        ctx.font = 'bold 12px monospace';
        ctx.fillText(
            label,
            labelBase.x + perp.x * 9 + unit.x * 6,
            labelBase.y + perp.y * 9 + unit.y * 6
        );

        ctx.beginPath();
        ctx.arc(anchor.x, anchor.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function buildConnectionRoute(startTableRect, endTableRect, startColRect, endColRect) {
        const laneOffset = 14;

        const startColCenterX = startColRect.left + startColRect.width / 2;
        const startColCenterY = startColRect.top + startColRect.height / 2;
        const endColCenterX = endColRect.left + endColRect.width / 2;
        const endColCenterY = endColRect.top + endColRect.height / 2;

        const hasHorizontalGap = startTableRect.right < endTableRect.left || endTableRect.right < startTableRect.left;
        const hasVerticalGap = startTableRect.bottom < endTableRect.top || endTableRect.bottom < startTableRect.top;

        if (hasHorizontalGap) {
            const startOnLeft = startTableRect.left < endTableRect.left;
            const channelX = startOnLeft
                ? (startTableRect.right + endTableRect.left) / 2
                : (endTableRect.right + startTableRect.left) / 2;

            return {
                start: {
                    x: startOnLeft ? startTableRect.right + laneOffset : startTableRect.left - laneOffset,
                    y: clamp(startColCenterY, startTableRect.top + 10, startTableRect.bottom - 10)
                },
                end: {
                    x: startOnLeft ? endTableRect.left - laneOffset : endTableRect.right + laneOffset,
                    y: clamp(endColCenterY, endTableRect.top + 10, endTableRect.bottom - 10)
                },
                channelAxis: 'x',
                channelValue: channelX
            };
        }

        if (hasVerticalGap) {
            const startOnTop = startTableRect.top < endTableRect.top;
            const channelY = startOnTop
                ? (startTableRect.bottom + endTableRect.top) / 2
                : (endTableRect.bottom + startTableRect.top) / 2;

            return {
                start: {
                    x: clamp(startColCenterX, startTableRect.left + 12, startTableRect.right - 12),
                    y: startOnTop ? startTableRect.bottom + laneOffset : startTableRect.top - laneOffset
                },
                end: {
                    x: clamp(endColCenterX, endTableRect.left + 12, endTableRect.right - 12),
                    y: startOnTop ? endTableRect.top - laneOffset : endTableRect.bottom + laneOffset
                },
                channelAxis: 'y',
                channelValue: channelY
            };
        }

        const startOnLeft = (startTableRect.left + startTableRect.width / 2) <= (endTableRect.left + endTableRect.width / 2);
        const channelX = (startTableRect.left + startTableRect.right + endTableRect.left + endTableRect.right) / 4;

        return {
            start: {
                x: startOnLeft ? startTableRect.right + laneOffset : startTableRect.left - laneOffset,
                y: clamp(startColCenterY, startTableRect.top + 10, startTableRect.bottom - 10)
            },
            end: {
                x: startOnLeft ? endTableRect.left - laneOffset : endTableRect.right + laneOffset,
                y: clamp(endColCenterY, endTableRect.top + 10, endTableRect.bottom - 10)
            },
            channelAxis: 'x',
            channelValue: channelX
        };
    }

    // WP7: Draw Relationship Lines (Table-Gap Routing)
    function drawRelationships() {
        clearCanvas();
        if (!showRelationships) return; // Toggle Check

        // High-contrast color palette for FK lines
        // Hues spread evenly, bright enough on dark backgrounds
        const LINE_COLORS = [
            '#64c8ff', // sky blue
            '#ff6b8a', // coral pink
            '#6bff9e', // mint green
            '#ffd166', // amber
            '#c77dff', // violet
            '#ff9f45', // orange
            '#00f5d4', // teal
            '#f72585', // hot pink
            '#b5e48c', // lime
            '#a8dadc', // powder blue
        ];

        const fkHeaders = document.querySelectorAll('th[data-is-fk="true"]');
        const stageRect = schemaStage.getBoundingClientRect();
        const containerRect = toLocalRect(tablesContainer.getBoundingClientRect(), stageRect);
        const exclusionPadding = 8;

        if (containerRect.width <= 0 || containerRect.height <= 0) return;

        ctx.save();
        ctx.beginPath();
        ctx.rect(containerRect.left, containerRect.top, containerRect.width, containerRect.height);

        document.querySelectorAll('.table-card').forEach(card => {
            const rect = toLocalRect(card.getBoundingClientRect(), stageRect);
            ctx.rect(
                rect.left - exclusionPadding,
                rect.top - exclusionPadding,
                rect.width + exclusionPadding * 2,
                rect.height + exclusionPadding * 2
            );
        });

        try {
            ctx.clip('evenodd');
        } catch (err) {
            // Fallback for browsers without evenodd clip support.
            ctx.clip();
        }

        const markerDrawJobs = [];

        fkHeaders.forEach((fkTh, lineIndex) => {
            const targetStr = fkTh.dataset.fkTarget;
            if (!targetStr) return;

            const [targetTable, targetCol] = targetStr.split('.');

            const targetTableCard = document.getElementById(`table-card-${targetTable}`);
            if (!targetTableCard) return;

            const targetTh = Array.from(targetTableCard.querySelectorAll('th')).find(th => th.dataset.colName === targetCol);

            if (targetTh) {
                // Pick unique color for this line
                const color = LINE_COLORS[lineIndex % LINE_COLORS.length];

                const startRect = toLocalRect(fkTh.getBoundingClientRect(), stageRect);
                const endRect = toLocalRect(targetTh.getBoundingClientRect(), stageRect);

                const startTableRect = toLocalRect(fkTh.closest('.table-card').getBoundingClientRect(), stageRect);
                const endTableRect = toLocalRect(targetTableCard.getBoundingClientRect(), stageRect);
                const route = buildConnectionRoute(startTableRect, endTableRect, startRect, endRect);

                // --- Draw Staple Path ---
                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.fillStyle = color;
                ctx.lineWidth = 2;
                ctx.setLineDash([]);

                ctx.moveTo(route.start.x, route.start.y);
                if (route.channelAxis === 'x') {
                    ctx.lineTo(route.channelValue, route.start.y);
                    ctx.lineTo(route.channelValue, route.end.y);
                } else {
                    ctx.lineTo(route.start.x, route.channelValue);
                    ctx.lineTo(route.end.x, route.channelValue);
                }
                ctx.lineTo(route.end.x, route.end.y);
                ctx.stroke();

                const startToward = route.channelAxis === 'x'
                    ? { x: route.channelValue, y: route.start.y }
                    : { x: route.start.x, y: route.channelValue };
                const endToward = route.channelAxis === 'x'
                    ? { x: route.channelValue, y: route.end.y }
                    : { x: route.end.x, y: route.channelValue };

                markerDrawJobs.push({ anchor: route.start, toward: startToward, color, label: 'n' });
                markerDrawJobs.push({ anchor: route.end, toward: endToward, color, label: '1' });
            }
        });

        ctx.restore();

        markerDrawJobs.forEach(job => {
            drawCardinalityLabel(job.anchor, job.toward, job.label, job.color);
        });
    }

    // Toggle Button Logic
    const toggleBtn = document.getElementById('btn-toggle-rels');
    if (toggleBtn) {
        toggleBtn.classList.add('active'); // starts active
        toggleBtn.addEventListener('click', () => {
            showRelationships = !showRelationships;
            toggleBtn.classList.toggle('active', showRelationships);
            if (showRelationships) {
                drawRelationships();
            } else {
                clearCanvas();
            }
        });
    }


    // Helper: Reset Visualization
    function resetVisualization() {
        document.querySelectorAll('.table-card').forEach(el => {
            el.classList.remove('active-table', 'dimmed', 'ddl-focus');
        });
        document.querySelectorAll('.table-row').forEach(el => {
            el.classList.remove('highlight-row', 'anim-scan');
        });
    }

    function resetSimulationDataToBaseline() {
        simulator.reset();
        stepPreviewMap = new Map();
        pendingLessonTaskParseResult = null;
        resetProcessRuntimeState();
        resetProcessLogEntries();
        parser.simulationData = deepClone(activeSimulationDataBaseline);
        parser.simulationData.VIEWS = parser.simulationData.VIEWS || {};
        parser.simulationData.INDEXES = parser.simulationData.INDEXES || {};
        parser.simulationData.SCHEMAS = parser.simulationData.SCHEMAS || {};
        parser.simulationData.SEQUENCES = parser.simulationData.SEQUENCES || {};
        renderTables(parser.simulationData);
        resetVisualization();
        if (chatContainer) chatContainer.innerHTML = '';
        renderDiagnostics([]);
        hideProcessResultPanel();
        drawRelationships();
    }

    function upsertCreateTable(step) {
        const tableName = step.entity;
        if (!tableName) return;

        const existingTable = parser.simulationData.TABLES[tableName] || { columns: [], rows: [] };
        const phaseMeta = CREATE_PHASE_META[step.kind] || CREATE_PHASE_META.PARSE;
        let nextColumns = Array.isArray(existingTable.columns) ? existingTable.columns : [];

        if (step.kind === 'CREATE_START') {
            nextColumns = [];
        } else if (CREATE_VISIBLE_COLUMN_PHASES.has(step.kind) && Array.isArray(step.columns)) {
            nextColumns = step.columns.map(col => ({ ...col }));
        }

        parser.simulationData.TABLES[tableName] = {
            ...existingTable,
            columns: nextColumns,
            rows: Array.isArray(existingTable.rows) ? existingTable.rows : [],
            __meta: {
                ...(existingTable.__meta || {}),
                phase: phaseMeta.phase,
                badge: phaseMeta.badge,
                draft: phaseMeta.draft,
                placeholder: phaseMeta.placeholder
            }
        };

        if (step.kind === 'RESULT') {
            parser.simulationData.TABLES[tableName].__meta.badge = `${parser.simulationData.TABLES[tableName].rows.length} Rows`;
            parser.simulationData.TABLES[tableName].__meta.draft = false;
        }

        renderTables(parser.simulationData);
        setTimeout(() => {
            const card = document.getElementById(`table-card-${tableName}`);
            if (!card) return;

            card.classList.add('active-table', 'ddl-focus');
            document.querySelectorAll('.table-card').forEach(c => {
                if (c !== card) c.classList.add('dimmed');
            });
            setTimeout(() => card.classList.remove('ddl-focus'), 500);
            drawRelationships();
        }, 60);
    }

    function focusTable(entityName, options = {}) {
        if (!entityName) return null;
        const { dimOthers = true } = options;
        const card = document.getElementById(`table-card-${entityName}`);
        if (!card) return null;
        card.classList.add('active-table');

        if (dimOthers) {
            document.querySelectorAll('.table-card').forEach(c => {
                if (c !== card) c.classList.add('dimmed');
            });
        }
        return card;
    }

    function parseSqlLiteral(rawValue) {
        const trimmed = String(rawValue ?? '').trim();
        if (/^NULL$/i.test(trimmed)) return null;
        if (/^TRUE$/i.test(trimmed)) return true;
        if (/^FALSE$/i.test(trimmed)) return false;
        if (/^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
        if (/^'.*'$/.test(trimmed)) return trimmed.slice(1, -1).replace(/''/g, '\'');
        if (/^".*"$/.test(trimmed)) return trimmed.slice(1, -1).replace(/""/g, '"');
        return trimmed;
    }

    function parseSimpleWhereClauses(conditionText) {
        const text = String(conditionText || '').trim();
        if (!text) return [];

        const groups = [];
        const orParts = text
            .split(/\s+OR\s+/i)
            .map((entry) => entry.trim())
            .filter(Boolean);

        for (const orPart of orParts) {
            const andParts = orPart
                .split(/\s+AND\s+/i)
                .map((entry) => entry.trim())
                .filter(Boolean);

            const clauses = [];
            for (const part of andParts) {
                const match = /^([a-zA-Z_]\w*)\s*(=|!=|<>|>=|<=|>|<)\s*(.+)$/i.exec(part);
                if (!match) return null;
                clauses.push({
                    column: match[1].toLowerCase(),
                    operator: match[2],
                    value: parseSqlLiteral(match[3])
                });
            }

            if (clauses.length > 0) groups.push(clauses);
        }

        return groups;
    }

    function normalizeComparable(value) {
        if (value === null || value === undefined) return null;
        if (typeof value === 'number' || typeof value === 'boolean') return value;
        const text = String(value).trim();
        if (/^[+-]?\d+(?:\.\d+)?$/.test(text)) return Number(text);
        if (/^TRUE$/i.test(text)) return true;
        if (/^FALSE$/i.test(text)) return false;
        if (/^NULL$/i.test(text)) return null;
        return text;
    }

    function compareSqlValues(leftRaw, operator, rightRaw) {
        const left = normalizeComparable(leftRaw);
        const right = normalizeComparable(rightRaw);

        if (operator === '=' || operator === '==') return left === right;
        if (operator === '!=' || operator === '<>') return left !== right;

        if (left === null || right === null) return false;
        if (operator === '>') return left > right;
        if (operator === '>=') return left >= right;
        if (operator === '<') return left < right;
        if (operator === '<=') return left <= right;
        return false;
    }

    function findTableColumnIndex(table, columnName) {
        return (table.columns || []).findIndex((col) => String(col.name || col).toLowerCase() === String(columnName || '').toLowerCase());
    }

    function getRowValueByColumn(table, row, columnName) {
        if (Array.isArray(row)) {
            const index = findTableColumnIndex(table, columnName);
            return index >= 0 ? row[index] : undefined;
        }
        if (!row || typeof row !== 'object') return undefined;
        const key = Object.keys(row).find((entry) => entry.toLowerCase() === String(columnName || '').toLowerCase());
        return key ? row[key] : undefined;
    }

    function setRowValueByColumn(table, row, columnName, value) {
        if (Array.isArray(row)) {
            const index = findTableColumnIndex(table, columnName);
            if (index >= 0) row[index] = value;
            return;
        }
        if (!row || typeof row !== 'object') return;
        const key = Object.keys(row).find((entry) => entry.toLowerCase() === String(columnName || '').toLowerCase()) || columnName;
        row[key] = value;
    }

    function findMatchingRowIndices(table, conditionText, mode) {
        if (!table || !Array.isArray(table.rows)) return [];
        const text = String(conditionText || '').trim();
        if (!text) return table.rows.map((_, index) => index);

        const clauses = parseSimpleWhereClauses(text);
        if (!clauses) {
            if (mode === 'UPDATE') return table.rows.length > 0 ? [0] : [];
            if (mode === 'DELETE') return table.rows.length > 0 ? [table.rows.length - 1] : [];
            return [];
        }

        const matches = [];
        table.rows.forEach((row, rowIndex) => {
            const isMatch = clauses.some((group) => group.every((clause) => {
                const value = getRowValueByColumn(table, row, clause.column);
                return compareSqlValues(value, clause.operator, clause.value);
            }));
            if (isMatch) matches.push(rowIndex);
        });

        return matches;
    }

    function getTableColumnNames(table) {
        return (table?.columns || []).map((col) => String(col.name || col));
    }

    function createEmptyRowForTable(table) {
        const columns = getTableColumnNames(table);
        if (columns.length > 0) return new Array(columns.length).fill(null);
        return {};
    }

    function resolveMergeExpressionValue(token, context) {
        if (!token) return null;

        const raw = String(token.raw || '').trim();
        if (raw) {
            const refMatch = /^([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)$/i.exec(raw);
            if (refMatch) {
                const alias = refMatch[1].toLowerCase();
                const column = refMatch[2].toLowerCase();

                if (context.targetRefs.has(alias)) {
                    return getRowValueByColumn(context.targetTable, context.targetRow, column);
                }
                if (context.sourceRefs.has(alias)) {
                    return getRowValueByColumn(context.sourceTable, context.sourceRow, column);
                }
            }
        }

        if (Object.prototype.hasOwnProperty.call(token, 'value')) return token.value;
        if (Object.prototype.hasOwnProperty.call(token, 'val')) return token.val;
        return null;
    }

    function objectStoreKeyForType(type) {
        const normalized = String(type || '').trim().toUpperCase();
        if (normalized === 'VIEW') return 'VIEWS';
        if (normalized === 'INDEX') return 'INDEXES';
        if (normalized === 'SCHEMA') return 'SCHEMAS';
        if (normalized === 'SEQUENCE') return 'SEQUENCES';
        return null;
    }

    function upsertCatalogObject(objectType, entity, payload = {}) {
        const key = objectStoreKeyForType(objectType);
        if (!key || !entity) return;
        parser.simulationData[key] = parser.simulationData[key] || {};
        parser.simulationData[key][String(entity).toLowerCase()] = {
            ...(parser.simulationData[key][String(entity).toLowerCase()] || {}),
            ...payload
        };
    }

    function dropCatalogObject(objectType, entity) {
        const key = objectStoreKeyForType(objectType);
        if (!key || !entity || !parser.simulationData[key]) return;
        delete parser.simulationData[key][String(entity).toLowerCase()];
    }

    function splitSqlList(input) {
        const text = String(input || '');
        const items = [];
        let current = '';
        let depth = 0;
        let inSingle = false;
        let inDouble = false;

        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            const next = text[i + 1];

            if (ch === '\'' && !inDouble) {
                current += ch;
                if (inSingle && next === '\'') {
                    current += next;
                    i++;
                    continue;
                }
                inSingle = !inSingle;
                continue;
            }

            if (ch === '"' && !inSingle) {
                current += ch;
                inDouble = !inDouble;
                continue;
            }

            if (!inSingle && !inDouble) {
                if (ch === '(') depth++;
                if (ch === ')') depth = Math.max(0, depth - 1);
                if (ch === ',' && depth === 0) {
                    if (current.trim()) items.push(current.trim());
                    current = '';
                    continue;
                }
            }

            current += ch;
        }

        if (current.trim()) items.push(current.trim());
        return items;
    }

    function parseConditionGroupsWithRefs(conditionText) {
        const text = String(conditionText || '').trim();
        if (!text) return [];

        const groups = [];
        const orParts = text
            .split(/\s+OR\s+/i)
            .map((entry) => entry.trim())
            .filter(Boolean);

        for (const orPart of orParts) {
            const andParts = orPart
                .split(/\s+AND\s+/i)
                .map((entry) => entry.trim())
                .filter(Boolean);

            const clauses = [];
            for (const part of andParts) {
                const match = /^([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)?)\s*(=|!=|<>|>=|<=|>|<)\s*(.+)$/i.exec(part);
                if (match) {
                    clauses.push({
                        kind: 'compare',
                        reference: match[1],
                        operator: match[2],
                        value: parseSqlLiteral(match[3])
                    });
                    continue;
                }

                const inSubqueryMatch = /^([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)?)\s+IN\s*\(\s*SELECT\s+([a-zA-Z_]\w*)\s+FROM\s+([a-zA-Z_]\w*)\s*\)$/i.exec(part);
                if (inSubqueryMatch) {
                    clauses.push({
                        kind: 'in-subquery',
                        reference: inSubqueryMatch[1],
                        subqueryColumn: inSubqueryMatch[2].toLowerCase(),
                        subqueryTable: inSubqueryMatch[3].toLowerCase()
                    });
                    continue;
                }

                const existsMatch = /^EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+([a-zA-Z_]\w*)(?:\s+(?:AS\s+)?([a-zA-Z_]\w*))?\s+WHERE\s+([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)\s*=\s*([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)\s*\)$/i.exec(part);
                if (existsMatch) {
                    const subqueryTable = existsMatch[1].toLowerCase();
                    const subqueryAlias = (existsMatch[2] || existsMatch[1]).toLowerCase();
                    const leftAlias = existsMatch[3].toLowerCase();
                    const leftColumn = existsMatch[4].toLowerCase();
                    const rightAlias = existsMatch[5].toLowerCase();
                    const rightColumn = existsMatch[6].toLowerCase();

                    let subqueryColumn = '';
                    let outerReference = '';
                    if (leftAlias === subqueryAlias && rightAlias !== subqueryAlias) {
                        subqueryColumn = leftColumn;
                        outerReference = `${rightAlias}.${rightColumn}`;
                    } else if (rightAlias === subqueryAlias && leftAlias !== subqueryAlias) {
                        subqueryColumn = rightColumn;
                        outerReference = `${leftAlias}.${leftColumn}`;
                    } else {
                        return null;
                    }

                    clauses.push({
                        kind: 'exists-subquery',
                        subqueryTable,
                        subqueryAlias,
                        subqueryColumn,
                        outerReference
                    });
                    continue;
                }

                return null;
            }

            if (clauses.length > 0) groups.push(clauses);
        }

        return groups;
    }

    function resolveReferenceInContext(reference, contextRows, aliasToTable, aliasOrder) {
        const ref = String(reference || '').trim();
        if (!ref) return undefined;

        const qualified = /^([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)$/.exec(ref);
        if (qualified) {
            const alias = qualified[1].toLowerCase();
            const column = qualified[2];
            const table = aliasToTable[alias];
            const row = contextRows[alias];
            if (!table || !row) return undefined;
            return getRowValueByColumn(table, row, column);
        }

        const lowered = ref.toLowerCase();
        for (const alias of aliasOrder) {
            const table = aliasToTable[alias];
            const row = contextRows[alias];
            if (!table || !row) continue;
            const index = findTableColumnIndex(table, lowered);
            if (index >= 0) {
                return getRowValueByColumn(table, row, lowered);
            }
        }

        return undefined;
    }

    function parseOrderSpecs(orderClause) {
        return splitSqlList(orderClause).map((token) => {
            const match = /^(.+?)(?:\s+(ASC|DESC))?$/i.exec(String(token || '').trim());
            if (!match) return null;
            return {
                reference: match[1].trim(),
                direction: String(match[2] || 'ASC').toUpperCase()
            };
        }).filter(Boolean);
    }

    function compareForOrder(leftRaw, rightRaw, direction) {
        const left = normalizeComparable(leftRaw);
        const right = normalizeComparable(rightRaw);
        let result = 0;

        if (left === right) result = 0;
        else if (left === null || left === undefined) result = 1;
        else if (right === null || right === undefined) result = -1;
        else result = left > right ? 1 : -1;

        return direction === 'DESC' ? -result : result;
    }

    function parseSelectPreviewShape(sql) {
        const text = String(sql || '').trim().replace(/;+\s*$/, '');
        const mainMatch = /^\s*SELECT\s+([\s\S]+?)\s+FROM\s+([\s\S]+)$/i.exec(text);
        if (!mainMatch) return null;

        let projection = mainMatch[1].trim();
        const tail = mainMatch[2].trim();
        let distinct = false;

        if (/^DISTINCT\b/i.test(projection)) {
            distinct = true;
            projection = projection.replace(/^DISTINCT\b/i, '').trim();
        }

        const tailMatch = /^([\s\S]*?)(?:\s+WHERE\s+([\s\S]*?))?(?:\s+GROUP\s+BY\s+([\s\S]*?))?(?:\s+HAVING\s+([\s\S]*?))?(?:\s+ORDER\s+BY\s+([\s\S]*?))?(?:\s+LIMIT\s+(\d+))?(?:\s+OFFSET\s+(\d+))?(?:\s+FETCH\s+(?:FIRST|NEXT)\s+(\d+)\s+ROWS?\s+ONLY)?\s*$/i.exec(tail);
        if (!tailMatch) return null;

        return {
            projection,
            fromClause: String(tailMatch[1] || '').trim(),
            whereClause: String(tailMatch[2] || '').trim(),
            groupClause: String(tailMatch[3] || '').trim(),
            havingClause: String(tailMatch[4] || '').trim(),
            orderClause: String(tailMatch[5] || '').trim(),
            limit: tailMatch[6] ? Number(tailMatch[6]) : null,
            offset: tailMatch[7] ? Number(tailMatch[7]) : 0,
            fetch: tailMatch[8] ? Number(tailMatch[8]) : null,
            distinct
        };
    }

    function parseFromAndJoins(fromClause) {
        const baseMatch = /^\s*([a-zA-Z_]\w*)(?:\s+(?:AS\s+)?([a-zA-Z_]\w*))?/i.exec(fromClause);
        if (!baseMatch) return null;

        const baseTable = baseMatch[1].toLowerCase();
        const baseAlias = (baseMatch[2] || baseTable).toLowerCase();
        const joins = [];
        const joinRegex = /\b(?:(LEFT|RIGHT|INNER|FULL)(?:\s+OUTER)?\s+)?JOIN\s+([a-zA-Z_]\w*)(?:\s+(?:AS\s+)?([a-zA-Z_]\w*))?\s+ON\s+([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)\s*=\s*([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)/ig;

        let match = null;
        while ((match = joinRegex.exec(fromClause)) !== null) {
            joins.push({
                joinType: String(match[1] || 'INNER').toUpperCase(),
                table: match[2].toLowerCase(),
                alias: (match[3] || match[2]).toLowerCase(),
                leftAlias: match[4].toLowerCase(),
                leftColumn: match[5].toLowerCase(),
                rightAlias: match[6].toLowerCase(),
                rightColumn: match[7].toLowerCase()
            });
        }

        return {
            base: { table: baseTable, alias: baseAlias },
            joins
        };
    }

    function buildProjectionDescriptors(projectionText, aliasOrder, aliasToTable) {
        const tokens = splitSqlList(projectionText);
        const descriptors = [];

        const pushColumnDescriptor = (label, alias, column) => {
            descriptors.push({
                label,
                evaluate: (contextRows) => {
                    const table = aliasToTable[alias];
                    const row = contextRows[alias];
                    if (!table || !row) return null;
                    return getRowValueByColumn(table, row, column);
                }
            });
        };

        for (const rawToken of tokens) {
            const token = String(rawToken || '').trim();
            if (!token) continue;

            if (token === '*') {
                aliasOrder.forEach((alias) => {
                    const table = aliasToTable[alias];
                    (table?.columns || []).forEach((col) => {
                        const colName = String(col.name || col);
                        pushColumnDescriptor(`${alias}.${colName}`, alias, colName);
                    });
                });
                continue;
            }

            const starMatch = /^([a-zA-Z_]\w*)\.\*$/i.exec(token);
            if (starMatch) {
                const alias = starMatch[1].toLowerCase();
                const table = aliasToTable[alias];
                (table?.columns || []).forEach((col) => {
                    const colName = String(col.name || col);
                    pushColumnDescriptor(`${alias}.${colName}`, alias, colName);
                });
                continue;
            }

            let expression = token;
            let explicitLabel = '';

            const asMatch = /^(.+?)\s+AS\s+([a-zA-Z_]\w*)$/i.exec(token);
            if (asMatch) {
                expression = asMatch[1].trim();
                explicitLabel = asMatch[2];
            } else {
                const implicitAliasMatch = /^([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)?)\s+([a-zA-Z_]\w*)$/i.exec(token);
                if (implicitAliasMatch) {
                    expression = implicitAliasMatch[1].trim();
                    explicitLabel = implicitAliasMatch[2];
                }
            }

            const refMatch = /^([a-zA-Z_]\w*)(?:\.([a-zA-Z_]\w*))?$/.exec(expression);
            const label = explicitLabel
                || (refMatch ? (refMatch[2] || refMatch[1]) : expression);

            descriptors.push({
                label,
                evaluate: (contextRows) => {
                    if (/^'.*'$/.test(expression) || /^".*"$/.test(expression) || /^[+-]?\d+(?:\.\d+)?$/.test(expression) || /^NULL$/i.test(expression)) {
                        return parseSqlLiteral(expression);
                    }
                    return resolveReferenceInContext(expression, contextRows, aliasToTable, aliasOrder);
                }
            });
        }

        return descriptors;
    }

    function materializeContextRows(contexts, aliasOrder, aliasToTable) {
        const accessors = [];
        const columns = [];
        const useQualifiedLabels = aliasOrder.length > 1;

        aliasOrder.forEach((alias) => {
            const table = aliasToTable[alias];
            (table?.columns || []).forEach((col) => {
                const columnName = String(col.name || col);
                columns.push(useQualifiedLabels ? `${alias}.${columnName}` : columnName);
                accessors.push({ alias, columnName });
            });
        });

        const rows = contexts.map((contextRows) => {
            return accessors.map(({ alias, columnName }) => {
                return getRowValueByColumn(aliasToTable[alias], contextRows[alias], columnName);
            });
        });

        return { columns, rows };
    }

    function materializeProjectionRows(contexts, descriptors) {
        const columns = descriptors.map((descriptor) => descriptor.label);
        const rows = contexts.map((contextRows) => descriptors.map((descriptor) => descriptor.evaluate(contextRows)));
        return { columns, rows };
    }

    function applyDistinctRows(rows) {
        const seen = new Set();
        return rows.filter((row) => {
            const key = JSON.stringify(row);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function toStepPreview(columns, rows, maxPreviewRows = 8) {
        const safeColumns = Array.isArray(columns) ? columns.map((entry) => String(entry)) : [];
        const safeRows = Array.isArray(rows) ? rows.filter(Array.isArray).map((row) => [...row]) : [];
        const visibleRows = safeRows.slice(0, maxPreviewRows);
        return {
            columns: safeColumns,
            rows: visibleRows,
            overflowCount: Math.max(0, safeRows.length - visibleRows.length),
            totalRows: safeRows.length,
            maxPreviewRows
        };
    }

    function cloneStepPreview(preview) {
        if (!preview || typeof preview !== 'object') return null;
        return {
            columns: Array.isArray(preview.columns) ? [...preview.columns] : [],
            rows: Array.isArray(preview.rows)
                ? preview.rows.map((row) => Array.isArray(row) ? [...row] : [])
                : [],
            overflowCount: Number(preview.overflowCount || 0),
            totalRows: Number(preview.totalRows || 0),
            maxPreviewRows: Number(preview.maxPreviewRows || 0)
        };
    }

    function parseHavingCountCondition(havingClause) {
        const text = String(havingClause || '').trim();
        if (!text) return null;

        const match = /^COUNT\s*\(\s*(?:\*|[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)?)\s*\)\s*(=|!=|<>|>=|<=|>|<)\s*(.+)$/i.exec(text);
        if (!match) return null;
        return {
            operator: match[1],
            value: parseSqlLiteral(match[2])
        };
    }

    function findProjectedColumnIndex(columns, reference) {
        const safeColumns = Array.isArray(columns) ? columns : [];
        const ref = String(reference || '').trim().toLowerCase();
        if (!ref) return -1;

        let index = safeColumns.findIndex((column) => String(column || '').toLowerCase() === ref);
        if (index >= 0) return index;

        const dotted = /^([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)$/.exec(ref);
        if (dotted) {
            const suffix = dotted[2];
            index = safeColumns.findIndex((column) => String(column || '').toLowerCase() === suffix);
        }

        return index;
    }

    function evaluateSelectPipeline(sql, maxPreviewRows = 8) {
        const parsed = parseSelectPreviewShape(sql);
        if (!parsed) return null;

        const graph = parseFromAndJoins(parsed.fromClause);
        if (!graph) return null;

        const baseTable = parser.simulationData.TABLES[graph.base.table];
        if (!baseTable || !Array.isArray(baseTable.rows)) return null;

        const aliasToTable = { [graph.base.alias]: baseTable };
        const aliasOrder = [graph.base.alias];
        const snapshots = {};

        const baseContexts = baseTable.rows.map((row) => ({ [graph.base.alias]: row }));
        const fromState = materializeContextRows(baseContexts, [graph.base.alias], { [graph.base.alias]: baseTable });
        snapshots.FROM = toStepPreview(fromState.columns, fromState.rows, maxPreviewRows);

        let joinedContexts = baseContexts;
        let lastJoinLeftPreview = null;
        let lastJoinRightPreview = null;

        for (const join of graph.joins) {
            const joinTable = parser.simulationData.TABLES[join.table];
            if (!joinTable || !Array.isArray(joinTable.rows)) {
                return null;
            }

            const leftAliasOrder = [...aliasOrder];
            const leftAliasToTable = { ...aliasToTable };
            const leftState = materializeContextRows(joinedContexts, leftAliasOrder, leftAliasToTable);
            const leftPreview = toStepPreview(leftState.columns, leftState.rows, maxPreviewRows);

            const rightContexts = joinTable.rows.map((row) => ({ [join.alias]: row }));
            const rightState = materializeContextRows(rightContexts, [join.alias], { [join.alias]: joinTable });
            const rightPreview = toStepPreview(rightState.columns, rightState.rows, maxPreviewRows);
            lastJoinLeftPreview = cloneStepPreview(leftPreview);
            lastJoinRightPreview = cloneStepPreview(rightPreview);

            aliasToTable[join.alias] = joinTable;
            aliasOrder.push(join.alias);
            const nextContexts = [];

            joinedContexts.forEach((contextRows) => {
                let hasMatch = false;
                joinTable.rows.forEach((joinRow) => {
                    const candidate = { ...contextRows, [join.alias]: joinRow };
                    const leftValue = resolveReferenceInContext(`${join.leftAlias}.${join.leftColumn}`, candidate, aliasToTable, aliasOrder);
                    const rightValue = resolveReferenceInContext(`${join.rightAlias}.${join.rightColumn}`, candidate, aliasToTable, aliasOrder);
                    if (compareSqlValues(leftValue, '=', rightValue)) {
                        nextContexts.push(candidate);
                        hasMatch = true;
                    }
                });

                if (!hasMatch && String(join.joinType || 'INNER').toUpperCase() === 'LEFT') {
                    nextContexts.push({ ...contextRows, [join.alias]: null });
                }
            });

            joinedContexts = nextContexts;
        }

        if (graph.joins.length > 0) {
            const joinState = materializeContextRows(joinedContexts, aliasOrder, aliasToTable);
            const joinPreview = toStepPreview(joinState.columns, joinState.rows, maxPreviewRows);
            joinPreview.joinAnimation = {
                left: cloneStepPreview(lastJoinLeftPreview),
                right: cloneStepPreview(lastJoinRightPreview),
                merged: cloneStepPreview(joinPreview)
            };
            snapshots.JOIN = joinPreview;
        }

        let workingContexts = graph.joins.length > 0 ? joinedContexts : baseContexts;
        const whereGroups = parseConditionGroupsWithRefs(parsed.whereClause);
        if (whereGroups === null) return null;

        if (Array.isArray(whereGroups) && whereGroups.length > 0) {
            const subqueryValueCache = new Map();
            const getSubqueryComparableSet = (tableName, columnName) => {
                const key = `${String(tableName || '').toLowerCase()}.${String(columnName || '').toLowerCase()}`;
                if (subqueryValueCache.has(key)) return subqueryValueCache.get(key);

                const table = parser.simulationData.TABLES[String(tableName || '').toLowerCase()];
                if (!table || !Array.isArray(table.rows)) {
                    subqueryValueCache.set(key, new Set());
                    return subqueryValueCache.get(key);
                }

                const values = new Set();
                table.rows.forEach((row) => {
                    const value = getRowValueByColumn(table, row, columnName);
                    values.add(JSON.stringify(normalizeComparable(value)));
                });
                subqueryValueCache.set(key, values);
                return values;
            };

            workingContexts = workingContexts.filter((contextRows) => {
                return whereGroups.some((group) => {
                    return group.every((clause) => {
                        if (clause.kind === 'in-subquery') {
                            const currentValue = resolveReferenceInContext(clause.reference, contextRows, aliasToTable, aliasOrder);
                            const subqueryValues = getSubqueryComparableSet(clause.subqueryTable, clause.subqueryColumn);
                            return subqueryValues.has(JSON.stringify(normalizeComparable(currentValue)));
                        }

                        if (clause.kind === 'exists-subquery') {
                            const subqueryTable = parser.simulationData.TABLES[String(clause.subqueryTable || '').toLowerCase()];
                            if (!subqueryTable || !Array.isArray(subqueryTable.rows)) return false;

                            const outerValue = resolveReferenceInContext(clause.outerReference, contextRows, aliasToTable, aliasOrder);
                            return subqueryTable.rows.some((subqueryRow) => {
                                const subqueryValue = getRowValueByColumn(subqueryTable, subqueryRow, clause.subqueryColumn);
                                return compareSqlValues(subqueryValue, '=', outerValue);
                            });
                        }

                        const value = resolveReferenceInContext(clause.reference, contextRows, aliasToTable, aliasOrder);
                        return compareSqlValues(value, clause.operator, clause.value);
                    });
                });
            });

            const whereState = materializeContextRows(workingContexts, aliasOrder, aliasToTable);
            snapshots.WHERE = toStepPreview(whereState.columns, whereState.rows, maxPreviewRows);
        }

        const groupReferences = splitSqlList(parsed.groupClause).map((entry) => String(entry || '').trim()).filter(Boolean);
        const hasGroupBy = groupReferences.length > 0;
        if (parsed.havingClause && !hasGroupBy) return null;

        let selectedState = { columns: [], rows: [] };
        let currentRows = [];
        let groupedEntries = [];

        if (hasGroupBy) {
            const groups = new Map();
            workingContexts.forEach((contextRows) => {
                const keyValues = groupReferences.map((reference) => resolveReferenceInContext(reference, contextRows, aliasToTable, aliasOrder));
                const key = JSON.stringify(keyValues.map((value) => normalizeComparable(value)));
                if (!groups.has(key)) groups.set(key, { keyValues, contexts: [] });
                groups.get(key).contexts.push(contextRows);
            });

            groupedEntries = [...groups.values()];
            snapshots['GROUP BY'] = toStepPreview(groupReferences, groupedEntries.map((entry) => entry.keyValues), maxPreviewRows);

            if (parsed.havingClause) {
                const having = parseHavingCountCondition(parsed.havingClause);
                if (!having) return null;
                groupedEntries = groupedEntries.filter((entry) => compareSqlValues(entry.contexts.length, having.operator, having.value));
            }

            const projectionTokens = splitSqlList(parsed.projection);
            const projectionDescriptors = projectionTokens.map((rawToken) => {
                const token = String(rawToken || '').trim();
                if (!token) return null;

                let expression = token;
                let label = '';
                const asMatch = /^(.+?)\s+AS\s+([a-zA-Z_]\w*)$/i.exec(token);
                if (asMatch) {
                    expression = asMatch[1].trim();
                    label = asMatch[2].trim();
                } else {
                    label = token;
                }

                const countMatch = /^COUNT\s*\(\s*(\*|[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)?)\s*\)$/i.exec(expression);
                if (countMatch) {
                    return {
                        kind: 'count',
                        reference: countMatch[1] === '*' ? '*' : countMatch[1],
                        label: label || 'count'
                    };
                }

                const refMatch = /^([a-zA-Z_]\w*)(?:\.([a-zA-Z_]\w*))?$/.exec(expression);
                const resolvedLabel = label || (refMatch ? (refMatch[2] || refMatch[1]) : expression);
                return {
                    kind: 'reference',
                    reference: expression,
                    label: resolvedLabel
                };
            }).filter(Boolean);

            if (projectionDescriptors.length === 0) return null;

            selectedState = {
                columns: projectionDescriptors.map((descriptor) => descriptor.label),
                rows: groupedEntries.map((entry) => projectionDescriptors.map((descriptor) => {
                    if (descriptor.kind === 'count') {
                        if (descriptor.reference === '*') return entry.contexts.length;
                        return entry.contexts.reduce((count, contextRows) => {
                            const value = resolveReferenceInContext(descriptor.reference, contextRows, aliasToTable, aliasOrder);
                            return value === null || value === undefined ? count : count + 1;
                        }, 0);
                    }
                    return resolveReferenceInContext(descriptor.reference, entry.contexts[0], aliasToTable, aliasOrder);
                }))
            };

            if (parsed.havingClause) {
                snapshots.HAVING = toStepPreview(selectedState.columns, selectedState.rows, maxPreviewRows);
            }
            snapshots.SELECT = toStepPreview(selectedState.columns, selectedState.rows, maxPreviewRows);
            currentRows = selectedState.rows;
        } else {
            const projectionDescriptors = buildProjectionDescriptors(parsed.projection, aliasOrder, aliasToTable);
            if (projectionDescriptors.length === 0) return null;
            selectedState = materializeProjectionRows(workingContexts, projectionDescriptors);
            snapshots.SELECT = toStepPreview(selectedState.columns, selectedState.rows, maxPreviewRows);
            currentRows = selectedState.rows;
        }

        const selectSourcePreview = (() => {
            if (hasGroupBy) {
                if (snapshots.HAVING) return snapshots.HAVING;
                if (snapshots['GROUP BY']) return snapshots['GROUP BY'];
            }
            if (snapshots.WHERE) return snapshots.WHERE;
            if (snapshots.JOIN) return snapshots.JOIN;
            return snapshots.FROM || null;
        })();
        if (snapshots.SELECT && selectSourcePreview) {
            snapshots.SELECT.selectAnimation = buildSelectAnimationPayload(selectSourcePreview, snapshots.SELECT);
        }

        if (parsed.distinct) {
            currentRows = applyDistinctRows(currentRows);
            snapshots.DISTINCT = toStepPreview(selectedState.columns, currentRows, maxPreviewRows);
        }

        if (parsed.orderClause) {
            const orderSpecs = parseOrderSpecs(parsed.orderClause);
            if (orderSpecs.length > 0) {
                if (hasGroupBy) {
                    const sortedRows = [...currentRows].sort((leftRow, rightRow) => {
                        for (const spec of orderSpecs) {
                            const columnIndex = findProjectedColumnIndex(selectedState.columns, spec.reference);
                            if (columnIndex < 0) continue;
                            const compare = compareForOrder(leftRow[columnIndex], rightRow[columnIndex], spec.direction);
                            if (compare !== 0) return compare;
                        }
                        return 0;
                    });
                    currentRows = sortedRows;
                } else {
                    const projectionDescriptors = buildProjectionDescriptors(parsed.projection, aliasOrder, aliasToTable);
                    const sortedContexts = [...workingContexts].sort((leftContext, rightContext) => {
                        for (const spec of orderSpecs) {
                            const leftValue = resolveReferenceInContext(spec.reference, leftContext, aliasToTable, aliasOrder);
                            const rightValue = resolveReferenceInContext(spec.reference, rightContext, aliasToTable, aliasOrder);
                            const compare = compareForOrder(leftValue, rightValue, spec.direction);
                            if (compare !== 0) return compare;
                        }
                        return 0;
                    });

                    selectedState = materializeProjectionRows(sortedContexts, projectionDescriptors);
                    currentRows = parsed.distinct ? applyDistinctRows(selectedState.rows) : selectedState.rows;
                }
                snapshots['ORDER BY'] = toStepPreview(selectedState.columns, currentRows, maxPreviewRows);
            }
        }

        const offset = Math.max(0, Number(parsed.offset) || 0);
        if (offset > 0) {
            currentRows = currentRows.slice(offset);
            snapshots.OFFSET = toStepPreview(selectedState.columns, currentRows, maxPreviewRows);
        }

        if (Number.isFinite(parsed.limit) && parsed.limit !== null) {
            currentRows = currentRows.slice(0, Math.max(0, Number(parsed.limit)));
            snapshots.LIMIT = toStepPreview(selectedState.columns, currentRows, maxPreviewRows);
        }

        if (Number.isFinite(parsed.fetch) && parsed.fetch !== null) {
            currentRows = currentRows.slice(0, Math.max(0, Number(parsed.fetch)));
            snapshots.FETCH = toStepPreview(selectedState.columns, currentRows, maxPreviewRows);
        }

        const finalPreview = toStepPreview(selectedState.columns, currentRows, maxPreviewRows);
        snapshots.RESULT = finalPreview;

        return {
            stepSnapshots: snapshots,
            finalPreview
        };
    }

    function evaluateSelectResult(sql, maxPreviewRows = 8) {
        const pipeline = evaluateSelectPipeline(sql, maxPreviewRows);
        return pipeline ? pipeline.finalPreview : null;
    }

    function formatValueForPreview(value) {
        if (value === null || value === undefined) return 'NULL';
        if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
        return String(value);
    }

    function buildSelectStepPreviewMap(parseResult, steps, maxPreviewRows = 8) {
        const previewMap = new Map();
        const statements = Array.isArray(parseResult?.statements) ? parseResult.statements : [];
        const pipelinesByStatement = new Map();

        statements.forEach((statement) => {
            if (String(statement.type || '').toUpperCase() !== 'SELECT') return;
            const pipeline = evaluateSelectPipeline(statement.text, maxPreviewRows);
            if (!pipeline) return;
            pipelinesByStatement.set(Number(statement.index || 1), pipeline);
        });

        steps.forEach((step, index) => {
            const statementIndex = Number(step.statementIndex || 1);
            const pipeline = pipelinesByStatement.get(statementIndex);
            if (!pipeline) return;

            const stepType = String(step.type || '').toUpperCase();
            const preview = pipeline.stepSnapshots[stepType] || (stepType === 'RESULT' ? pipeline.finalPreview : null);
            if (!preview) return;

            previewMap.set(index, {
                ...preview,
                stepType
            });
        });

        return previewMap;
    }

    function enrichStepsWithSelectResults(parseResult) {
        const statements = Array.isArray(parseResult?.statements) ? parseResult.statements : [];
        const previewsByStatement = new Map();

        statements.forEach((statement) => {
            if (String(statement.type || '').toUpperCase() !== 'SELECT') return;
            const preview = evaluateSelectResult(statement.text);
            if (!preview) return;
            previewsByStatement.set(Number(statement.index || 1), preview);
        });

        if (previewsByStatement.size === 0) {
            return Array.isArray(parseResult?.steps) ? parseResult.steps : [];
        }

        return (parseResult.steps || []).map((step) => {
            if (String(step.type || '').toUpperCase() !== 'RESULT') return step;
            const statementIndex = Number(step.statementIndex || 1);
            const preview = previewsByStatement.get(statementIndex);
            if (!preview) return step;

            return {
                ...step,
                description: '',
                code: '',
                resultTable: {
                    columns: [...preview.columns],
                    rows: preview.rows.map((row) => Array.isArray(row) ? [...row] : []),
                    overflowCount: Number(preview.overflowCount || 0)
                },
                details: []
            };
        });
    }

    // Hook up UI feedback (WP4 + WP5 + WP6)
    simulator.onStepChange = (step, index) => {
        console.log(`[SIM] Step ${index + 1}: ${step.description}`, step);
        appendProcessLogEntry(step);
        const livePreview = stepPreviewMap.get(index);
        if (livePreview) {
            renderProcessResultPanel(livePreview, livePreview.stepType || step.type || '');
        } else if (stepPreviewMap.size === 0) {
            hideProcessResultPanel();
        }
        renderDbmsUnit();
        revealStatementDivider(Number(step.statementIndex || 1));
        applyProcessRuntimeStep(step);

        // --- WP4: Step List Updates ---
        if (chatContainer) {
            for (let i = 0; i < index; i++) {
                const el = document.getElementById(`step-${i}`);
                if (el) {
                    revealStepElement(el);
                    el.classList.remove('active', 'pending');
                    el.classList.add('done');
                    el.querySelector('.step-progress').style.width = '100%';
                    el.querySelector('.step-progress').style.transition = 'none';
                }
            }

            const currentEl = document.getElementById(`step-${index}`);
            if (currentEl) {
                revealStepElement(currentEl);
                currentEl.classList.remove('pending');
                currentEl.classList.add('active');
                currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

                const progressBar = currentEl.querySelector('.step-progress');
                progressBar.style.width = '0%';
                progressBar.style.transition = 'none';
                void progressBar.offsetWidth;
                progressBar.style.transition = `width ${simulator.speed}ms linear`;
                progressBar.style.width = '100%';
            }
        }

        // --- WP5/WP6: Data Visualization ---
        resetVisualization();

        if (isCreatePipelineStep(step)) {
            upsertCreateTable(step);
            return;
        }

        if (step.type === 'FROM' || step.type === 'JOIN' || step.type === 'ALTER' || step.type === 'DROP' || step.type === 'TRUNCATE' || step.type === 'MERGE') {
            const tName = step.entity;
            if (tName) {
                focusTable(tName);
            }
        }
        else if (step.type === 'WHERE') {
            document.querySelectorAll('.table-row').forEach(row => {
                if (Math.random() > 0.7) row.classList.add('anim-scan');
            });
        }
        else if (step.type === 'DELETE' || step.type === 'UPDATE') {
            const tName = step.entity;
            const table = parser.simulationData.TABLES[tName];
            if (table) {
                const mode = step.type === 'UPDATE' ? 'UPDATE' : 'DELETE';
                const hitIndices = findMatchingRowIndices(table, step.condition, mode);
                hitIndices.forEach((rowIndex) => {
                    const rowEl = document.getElementById(`row-${tName}-${rowIndex}`);
                    if (rowEl) rowEl.classList.add('anim-scan');
                });
            }
        }

        // WP6: Logic Execution
        if (step.type === 'INSERT') {
            const tName = step.entity;
            const table = parser.simulationData.TABLES[tName];
            if (table) {
                const tableColumns = (table.columns || []).map((col) => String(col.name || col));
                const providedRows = Array.isArray(step.rows) && step.rows.length > 0
                    ? step.rows
                    : [Array.isArray(step.values) ? step.values : []];
                const providedColumns = Array.isArray(step.columns) ? step.columns.map((col) => String(col).toLowerCase()) : [];

                providedRows.forEach((sourceRow) => {
                    if (!Array.isArray(sourceRow)) return;

                    if (tableColumns.length === 0) {
                        table.rows.push([...sourceRow]);
                        return;
                    }

                    const nextRow = new Array(tableColumns.length).fill(null);
                    const columnTargets = providedColumns.length > 0
                        ? providedColumns
                        : tableColumns.map((col) => col.toLowerCase());

                    sourceRow.forEach((value, idx) => {
                        const target = columnTargets[idx];
                        if (!target) return;
                        const targetIndex = tableColumns.findIndex((col) => col.toLowerCase() === target);
                        if (targetIndex >= 0) nextRow[targetIndex] = value;
                    });

                    table.rows.push(nextRow);
                });

                renderTables(parser.simulationData);

                // Highlight new row
                setTimeout(() => {
                    const lastRowIdx = table.rows.length - 1;
                    const rowEl = document.getElementById(`row-${tName}-${lastRowIdx}`);
                    if (rowEl) {
                        rowEl.classList.add('highlight-row');
                        // Add scale animation?
                    }
                }, 50);
            }
        }

        else if (step.type === 'UPDATE') {
            const tName = step.entity;
            const table = parser.simulationData.TABLES[tName];
            if (table && step.modifications) {
                const hitIndices = findMatchingRowIndices(table, step.condition, 'UPDATE');
                if (hitIndices.length === 0) return;

                hitIndices.forEach((rowIndex) => {
                    const row = table.rows[rowIndex];
                    if (!row) return;
                    step.modifications.forEach((mod) => {
                        setRowValueByColumn(table, row, mod.col, mod.val);
                    });
                });

                renderTables(parser.simulationData);
                setTimeout(() => {
                    hitIndices.forEach((rowIndex) => {
                        const rowEl = document.getElementById(`row-${tName}-${rowIndex}`);
                        if (rowEl) rowEl.classList.add('highlight-row', 'anim-scan');
                    });
                }, 50);
            }
        }

        else if (step.type === 'DELETE') {
            const tName = step.entity;
            const table = parser.simulationData.TABLES[tName];
            if (table && table.rows.length > 0) {
                const hitIndices = findMatchingRowIndices(table, step.condition, 'DELETE');
                if (hitIndices.length === 0) return;
                [...hitIndices].sort((a, b) => b - a).forEach((rowIndex) => {
                    table.rows.splice(rowIndex, 1);
                });
                renderTables(parser.simulationData);
                setTimeout(() => focusTable(tName), 60);
            }
        }

        else if (step.type === 'ALTER') {
            const tName = step.entity;
            const table = parser.simulationData.TABLES[tName];
            if (!table) return;

            const action = String(step.action || '').toUpperCase();
            if (action === 'ADD' && step.column) {
                const existing = (table.columns || []).some(col => (col.name || col).toLowerCase() === step.column.toLowerCase());
                if (!existing) {
                    const newType = (step.columnType || 'TEXT').toUpperCase();
                    table.columns.push({
                        name: step.column,
                        type: newType,
                        isPK: false,
                        isFK: false
                    });
                    table.rows = (table.rows || []).map((row) => {
                        if (Array.isArray(row)) return [...row, null];
                        return { ...row, [step.column]: null };
                    });
                }
            } else if (action === 'DROP' && step.column) {
                const idx = (table.columns || []).findIndex(col => (col.name || col).toLowerCase() === step.column.toLowerCase());
                if (idx >= 0) {
                    table.columns.splice(idx, 1);
                    table.rows = (table.rows || []).map((row) => {
                        if (Array.isArray(row)) {
                            return row.filter((_, i) => i !== idx);
                        }
                        const next = { ...row };
                        delete next[step.column];
                        return next;
                    });
                }
            } else if (action === 'RENAME') {
                const renameMatch = String(step.payload || '').match(/\bTO\s+([a-zA-Z_]\w*)/i);
                if (renameMatch) {
                    const nextName = renameMatch[1].toLowerCase();
                    if (!parser.simulationData.TABLES[nextName]) {
                        parser.simulationData.TABLES[nextName] = table;
                        delete parser.simulationData.TABLES[tName];
                    }
                }
            }

            renderTables(parser.simulationData);
            setTimeout(() => {
                focusTable((action === 'RENAME' && String(step.payload || '').match(/\bTO\s+([a-zA-Z_]\w*)/i)?.[1]?.toLowerCase()) || tName);
            }, 60);
        }

        else if (step.type === 'CREATE VIEW') {
            upsertCatalogObject('VIEW', step.entity, {
                definition: step.query || '',
                createdAt: Date.now()
            });
        }

        else if (step.type === 'CREATE INDEX') {
            upsertCatalogObject('INDEX', step.entity, {
                table: step.table || '',
                columns: Array.isArray(step.columns) ? [...step.columns] : [],
                unique: Boolean(step.unique),
                createdAt: Date.now()
            });
        }

        else if (step.type === 'CREATE SCHEMA') {
            upsertCatalogObject('SCHEMA', step.entity, {
                createdAt: Date.now()
            });
        }

        else if (step.type === 'CREATE SEQUENCE') {
            upsertCatalogObject('SEQUENCE', step.entity, {
                value: 0,
                createdAt: Date.now()
            });
        }

        else if (step.type === 'DROP') {
            const objectType = String(step.objectType || '').toUpperCase();
            if (objectType === 'TABLE' && step.entity && parser.simulationData.TABLES[step.entity]) {
                delete parser.simulationData.TABLES[step.entity];
                renderTables(parser.simulationData);
            } else if (step.entity) {
                dropCatalogObject(objectType, step.entity);
            }
        }

        else if (step.type === 'TRUNCATE') {
            const tName = step.entity;
            const table = parser.simulationData.TABLES[tName];
            if (table) {
                table.rows = [];
                renderTables(parser.simulationData);
                setTimeout(() => focusTable(tName), 60);
            }
        }

        else if (step.type === 'MERGE') {
            const targetTable = parser.simulationData.TABLES[step.entity];
            const sourceTable = parser.simulationData.TABLES[step.source];
            if (!targetTable || !sourceTable || !Array.isArray(sourceTable.rows) || sourceTable.rows.length === 0) return;

            const targetRefs = new Set((step.targetRefs || [step.entity, 'target']).map((entry) => String(entry).toLowerCase()));
            const sourceRefs = new Set((step.sourceRefs || [step.source, 'source']).map((entry) => String(entry).toLowerCase()));
            const targetKey = String(step.targetKey || '').toLowerCase();
            const sourceKey = String(step.sourceKey || '').toLowerCase();

            if (!targetKey || !sourceKey) return;

            const targetRows = targetTable.rows || [];
            const insertedRowIndices = [];
            const updatedRowIndices = new Set();

            sourceTable.rows.forEach((sourceRow) => {
                const sourceJoinValue = getRowValueByColumn(sourceTable, sourceRow, sourceKey);
                const targetRowIndex = targetRows.findIndex((targetRow) => {
                    const targetJoinValue = getRowValueByColumn(targetTable, targetRow, targetKey);
                    return compareSqlValues(targetJoinValue, '=', sourceJoinValue);
                });

                if (targetRowIndex >= 0) {
                    const targetRow = targetRows[targetRowIndex];
                    (step.updateAssignments || []).forEach((assignment) => {
                        const value = resolveMergeExpressionValue(assignment, {
                            targetTable,
                            sourceTable,
                            targetRow,
                            sourceRow,
                            targetRefs,
                            sourceRefs
                        });
                        setRowValueByColumn(targetTable, targetRow, assignment.col, value);
                    });
                    if ((step.updateAssignments || []).length > 0) {
                        updatedRowIndices.add(targetRowIndex);
                    }
                    return;
                }

                if (step.insertSpec && Array.isArray(step.insertSpec.values) && step.insertSpec.values.length > 0) {
                    const insertColumns = Array.isArray(step.insertSpec.columns) && step.insertSpec.columns.length > 0
                        ? step.insertSpec.columns.map((entry) => String(entry).toLowerCase())
                        : getTableColumnNames(targetTable).map((entry) => entry.toLowerCase());
                    if (insertColumns.length !== step.insertSpec.values.length) return;

                    const nextRow = createEmptyRowForTable(targetTable);
                    step.insertSpec.values.forEach((valueToken, valueIndex) => {
                        const column = insertColumns[valueIndex];
                        const value = resolveMergeExpressionValue(valueToken, {
                            targetTable,
                            sourceTable,
                            targetRow: null,
                            sourceRow,
                            targetRefs,
                            sourceRefs
                        });
                        setRowValueByColumn(targetTable, nextRow, column, value);
                    });

                    targetRows.push(nextRow);
                    insertedRowIndices.push(targetRows.length - 1);
                }
            });

            renderTables(parser.simulationData);
            setTimeout(() => {
                focusTable(step.entity);
                [...updatedRowIndices, ...insertedRowIndices].forEach((rowIndex) => {
                    const rowEl = document.getElementById(`row-${step.entity}-${rowIndex}`);
                    if (rowEl) rowEl.classList.add('highlight-row', 'anim-scan');
                });
            }, 60);
        }
    };

    function handleStoryAdvanceCheckAfterSimulation(parseResult) {
        if (activeGuideSelectionScope !== 'story' || !activeStoryTitleConfig || !parseResult || parseResult.error) return;
        if (hasErrorDiagnostics(parseResult.diagnostics || [])) return;
        evaluateActiveStorySceneProgress(parseResult, { showBlockedNotice: true });
    }

    simulator.onFinish = () => {
        console.log('[SIM] Simulation Finished');
        const lastIndex = simulator.steps.length - 1;
        const lastEl = document.getElementById(`step-${lastIndex}`);
        if (lastEl) {
            lastEl.classList.remove('active');
            lastEl.classList.add('done');
        }

        evaluateActiveLessonTasks(pendingLessonTaskParseResult);
        pendingLessonTaskParseResult = null;
        handleStoryAdvanceCheckAfterSimulation(pendingStoryAdvanceParseResult);
        pendingStoryAdvanceParseResult = null;
    };

    function runSimulation(options = {}) {
        const { fastForward = false } = options;
        const sql = editor.getValue();
        pendingStoryAdvanceParseResult = null;
        if (!sql.trim()) {
            stepPreviewMap = new Map();
            resetProcessRuntimeState();
            resetProcessLogEntries();
            pendingLessonTaskParseResult = null;
            hideProcessResultPanel();
            renderDiagnostics([
                {
                    message: 'Kein SQL eingegeben.',
                    severity: 'error',
                    sqlstate: '42601',
                    line: 1,
                    column: 1,
                    endLine: 1,
                    endColumn: 1,
                    hint: 'Beispiel laden oder SQL eingeben und erneut starten.'
                }
            ]);
            return;
        }

        console.log('Starting Simulation for:', sql);
        simulator.reset();
        stepPreviewMap = new Map();
        resetProcessRuntimeState();
        resetProcessLogEntries();
        pendingLessonTaskParseResult = null;
        hideProcessResultPanel();

        // 1. Parse SQL into Steps (new format: { type, clauses, tables, columns, error, warning, steps })
        const parseResult = parser.parse(sql);
        renderDiagnostics(parseResult.diagnostics || []);

        if (parseResult.error) {
            console.warn('[Parser]', parseResult.error);
            pendingLessonTaskParseResult = null;
            pendingStoryAdvanceParseResult = null;
            return;
        }

        const steps = enrichStepsWithSelectResults(parseResult);
        stepPreviewMap = buildSelectStepPreviewMap(parseResult, steps);

        if (steps.length > 0) {
            pendingLessonTaskParseResult = parseResult;
            pendingStoryAdvanceParseResult = parseResult;
            simulator.speed = parseResult.type === 'CREATE' ? 1400 : 1000;

            // Visualize Initial List
            renderSteps(steps);

            // 2. Load Simulator
            simulator.loadSteps(steps);
            if (fastForward) {
                simulator.fastForward();
            } else {
                // 3. Start
                simulator.start();
            }
        } else {
            console.warn('Parser returned no steps.');
            pendingLessonTaskParseResult = null;
            pendingStoryAdvanceParseResult = null;
        }
    }

    btnPlay.addEventListener('click', () => {
        runSimulation({ fastForward: false });
    });

    btnFF.addEventListener('click', () => {
        if (simulator.isPlaying) {
            simulator.fastForward();
            return;
        }
        runSimulation({ fastForward: true });
    });

    if (btnToggleIntellisense) {
        btnToggleIntellisense.addEventListener('click', () => {
            setIntellisenseEnabled(!isIntellisenseEnabled);
        });
    }

    if (multiIntellisenseList) {
        multiIntellisenseList.addEventListener('mousedown', handleIntellisenseListClick);
        multiIntellisenseList.addEventListener('click', handleIntellisenseListClick);
    }

    if (btnLoadExample) {
        btnLoadExample.addEventListener('click', () => {
            loadSelectedExample();
        });
    }

    if (exampleSelect) {
        exampleSelect.addEventListener('change', () => {
            loadSelectedExample();
        });
    }

    if (btnResetDemo) {
        btnResetDemo.addEventListener('click', () => {
            resetSimulationDataToBaseline();
        });
    }

    if (btnResetStoryProgress) {
        btnResetStoryProgress.addEventListener('click', () => {
            removeStoredStoryProgress();
            resetStoryProgressToDefaults();
            setStoryAutoAdvanceNotice('Story-Fortschritt zurueckgesetzt.');
            updateGuideWindowStoryHint();
        });
    }

    editor.addKeyMap({
        'Ctrl-Enter': () => runSimulation({ fastForward: false }),
        'Cmd-Enter': () => runSimulation({ fastForward: false })
    });


    // Verify Init
    console.log('SQL Editor Initialized');

    // Initial Render of Mock Data (WP5)
    initExampleSelector();
    syncLessonModeUi(activeLessonMode);
    bindLessonModeButtons();
    initLessonTree(activeLessonMode, { initializeEmpty: true });
    bindSqlCoreUnlockApi();
    initSqlCoreCatalog();
    if (exampleSelect && BASIC_SQL_EXAMPLES.length > 0 && !exampleSelect.value) {
        exampleSelect.value = BASIC_SQL_EXAMPLES[0].id;
    }
    initializeEmptyWorkspace();
});
