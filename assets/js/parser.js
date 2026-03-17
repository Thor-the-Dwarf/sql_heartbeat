/**
 * parser.js – SQL Parser (Upgrade WP7)
 * -------------------------------------
 * Zweck  : Zerlegt SQL-Eingabe in Simulator-Steps UND erkennt alle SQL-Clauses
 *          für die Left-Drawer-Visualisierung (Schreib- vs. Ausführungsreihenfolge).
 * Input  : SQL-String (beliebig mehrzeilig)
 * Output : { type, clauses, tables, columns, error, steps }
 * Beispiel:
 *   parser.parse("SELECT id FROM users WHERE id = 1")
 *   → { type:'SELECT', clauses:['SELECT','FROM','WHERE'], tables:['users'],
 *       columns:['id'], error:null, steps:[...] }
 */

class SQLParser {
    constructor() {
        this.steps = [];
        this.rawSQL = '';
        this._parseCatalog = null;
        this._parseTableColumns = null;
        this._parseTableColumnMeta = null;
        this._parseTableRows = null;

        // Mock-Datenbank für Simulator-Steps (Fallback / Tests)
        this.simulationData = {
            TABLES: {
                'users': {
                    columns: [
                        { name: 'id', type: 'INTEGER', isPK: true },
                        { name: 'name', type: 'VARCHAR', isPK: false },
                        { name: 'role', type: 'TEXT', isPK: false }
                    ],
                    rows: [
                        [1, 'Alice', 'Admin'],
                        [2, 'Bob', 'User'],
                        [3, 'Charlie', 'User']
                    ]
                },
                'logs': {
                    columns: [
                        { name: 'log_id', type: 'INTEGER', isPK: true },
                        { name: 'user_id', type: 'INTEGER', isFK: true, fkTarget: 'users.id' },
                        { name: 'message', type: 'TEXT', isPK: false }
                    ],
                    rows: [
                        [101, 1, 'Logged In'],
                        [102, 2, 'Viewed Page'],
                        [103, 1, 'Logout']
                    ]
                }
            },
            VIEWS: {},
            INDEXES: {},
            SCHEMAS: {},
            SEQUENCES: {}
        };

        // Clause-Definitionen: Erkennungs-Regex + kanonischer Name
        // Reihenfolge ist wichtig (längere Patterns zuerst)
        this._clauseDefs = [
            { key: 'WITH', regex: /\bWITH\b/i },
            { key: 'GROUP BY', regex: /\bGROUP\s+BY\b/i },
            { key: 'ORDER BY', regex: /\bORDER\s+BY\b/i },
            { key: 'INSERT INTO', regex: /\bINSERT\s+INTO\b/i },
            { key: 'DELETE FROM', regex: /\bDELETE\s+FROM\b/i },
            { key: 'LEFT JOIN', regex: /\bLEFT\s+(OUTER\s+)?JOIN\b/i },
            { key: 'RIGHT JOIN', regex: /\bRIGHT\s+(OUTER\s+)?JOIN\b/i },
            { key: 'INNER JOIN', regex: /\bINNER\s+JOIN\b/i },
            { key: 'FULL JOIN', regex: /\bFULL\s+(OUTER\s+)?JOIN\b/i },
            { key: 'JOIN', regex: /\bJOIN\b/i },
            { key: 'SELECT', regex: /\bSELECT\b/i },
            { key: 'FROM', regex: /\bFROM\b/i },
            { key: 'WHERE', regex: /\bWHERE\b/i },
            { key: 'HAVING', regex: /\bHAVING\b/i },
            { key: 'DISTINCT', regex: /\bDISTINCT\b/i },
            { key: 'UNION', regex: /\bUNION(?:\s+ALL)?\b/i },
            { key: 'INTERSECT', regex: /\bINTERSECT\b/i },
            { key: 'EXCEPT', regex: /\bEXCEPT\b/i },
            { key: 'LIMIT', regex: /\bLIMIT\b/i },
            { key: 'OFFSET', regex: /\bOFFSET\b/i },
            { key: 'FETCH', regex: /\bFETCH\b/i },
            { key: 'UPDATE', regex: /\bUPDATE\b/i },
            { key: 'SET', regex: /\bSET\b/i },
            { key: 'CREATE TABLE', regex: /\bCREATE\s+TABLE\b/i },
        ];

        this._dialectProfiles = this._buildDialectProfiles();
        this.activeDialect = 'sql-core';
    }

    _buildDialectProfiles() {
        const makeSet = (items) => new Set(items.map((type) => String(type).toUpperCase()));
        const coreTypes = [
            'BIGINT', 'BINARY', 'BIT', 'BLOB', 'BOOL', 'BOOLEAN', 'CHAR', 'CHARACTER', 'CLOB',
            'DATE', 'DATETIME', 'DEC', 'DECIMAL', 'DOUBLE', 'FLOAT', 'INT', 'INTEGER', 'NCHAR',
            'NUMERIC', 'NVARCHAR', 'REAL', 'SMALLINT', 'TEXT', 'TIME', 'TIMESTAMP', 'TINYINT', 'VARCHAR'
        ];

        return {
            'sql-core': {
                label: 'SQL Core',
                allowedTypes: makeSet(coreTypes),
                offsetWithoutLimitPolicy: 'warning',
                supportsLimit: true,
                supportsTop: false,
                supportsInsertReturning: true,
                requiresOrderByForOffset: false,
                supportsFetch: true,
                fetchRequiresOffset: false,
                fetchNextOnly: false,
                supportsRecursiveKeyword: true
            },
            postgres: {
                label: 'PostgreSQL',
                allowedTypes: makeSet([
                    ...coreTypes,
                    'SERIAL', 'BIGSERIAL', 'SMALLSERIAL', 'JSON', 'JSONB', 'UUID', 'BYTEA', 'MONEY'
                ]),
                offsetWithoutLimitPolicy: 'allow',
                supportsLimit: true,
                supportsTop: false,
                supportsInsertReturning: true,
                requiresOrderByForOffset: false,
                supportsFetch: true,
                fetchRequiresOffset: false,
                fetchNextOnly: false,
                supportsRecursiveKeyword: true
            },
            mysql: {
                label: 'MySQL',
                allowedTypes: makeSet([
                    ...coreTypes,
                    'YEAR', 'ENUM', 'SET', 'MEDIUMINT', 'LONGTEXT', 'MEDIUMTEXT', 'TINYTEXT', 'JSON'
                ]),
                offsetWithoutLimitPolicy: 'warning',
                supportsLimit: true,
                supportsTop: false,
                supportsInsertReturning: false,
                requiresOrderByForOffset: false,
                supportsFetch: false,
                fetchRequiresOffset: false,
                fetchNextOnly: false,
                supportsRecursiveKeyword: true
            },
            sqlserver: {
                label: 'SQL Server',
                allowedTypes: makeSet([
                    ...coreTypes,
                    'MONEY', 'SMALLMONEY', 'DATETIME2', 'SMALLDATETIME', 'UNIQUEIDENTIFIER',
                    'XML', 'VARBINARY'
                ]),
                offsetWithoutLimitPolicy: 'allow',
                supportsLimit: false,
                supportsTop: true,
                supportsInsertReturning: false,
                requiresOrderByForOffset: true,
                supportsFetch: true,
                fetchRequiresOffset: true,
                fetchNextOnly: true,
                supportsRecursiveKeyword: false
            },
            oracle: {
                label: 'Oracle',
                allowedTypes: makeSet([
                    ...coreTypes,
                    'NUMBER', 'VARCHAR2', 'NVARCHAR2', 'RAW', 'ROWID', 'UROWID', 'BFILE', 'LONG'
                ]),
                offsetWithoutLimitPolicy: 'allow',
                supportsLimit: false,
                supportsTop: false,
                supportsInsertReturning: false,
                requiresOrderByForOffset: false,
                supportsFetch: true,
                fetchRequiresOffset: false,
                fetchNextOnly: false,
                supportsRecursiveKeyword: false
            }
        };
    }

    getAvailableDialects() {
        return Object.entries(this._dialectProfiles).map(([id, profile]) => ({
            id,
            label: profile.label
        }));
    }

    getDialect() {
        return this.activeDialect;
    }

    setDialect(dialectId) {
        if (!this._dialectProfiles[dialectId]) return false;
        this.activeDialect = dialectId;
        return true;
    }

    _getActiveDialectProfile() {
        return this._dialectProfiles[this.activeDialect] || this._dialectProfiles['sql-core'];
    }

    // ─── Haupt-Einstiegspunkt ────────────────────────────────────────────────

    /**
     * Parst einen SQL-String vollständig.
     * @param {string} sql
     * @returns {{ type:string, clauses:string[], tables:string[], columns:string[], error:string|null, warning:string|null, steps:object[] }}
     */
    parse(sql) {
        this.steps = [];
        this.rawSQL = sql;

        const result = {
            dialect: this.activeDialect,
            dialectLabel: this._getActiveDialectProfile().label,
            type: null,
            clauses: [],
            tables: [],
            columns: [],
            ctes: [],
            statements: [],
            diagnostics: [],
            error: null,
            warning: null,
            steps: []
        };

        if (!sql || sql.trim() === '') {
            result.diagnostics = [
                this._createDiagnostic(sql || '', {
                    message: 'Kein SQL eingegeben.',
                    severity: 'error',
                    sqlstate: '42601',
                    index: 0,
                    hint: 'Mindestens ein SQL-Statement eingeben.'
                })
            ];
            result.error = result.diagnostics[0].message;
            return result;
        }

        const statements = this._splitSqlStatements(sql);
        if (statements.length === 0) {
            result.diagnostics = [
                this._createDiagnostic(sql, {
                    message: 'Kein ausfuehrbares SQL gefunden.',
                    severity: 'error',
                    sqlstate: '42601',
                    index: 0,
                    hint: 'Kommentare entfernen oder ein gueltiges Statement angeben.'
                })
            ];
            result.error = result.diagnostics[0].message;
            return result;
        }

        this._parseCatalog = this._buildParseCatalogSnapshot();
        this._parseTableColumns = this._buildParseTableColumnSnapshot();
        this._parseTableColumnMeta = this._buildParseTableColumnMetaSnapshot();
        this._parseTableRows = this._buildParseTableRowSnapshot();
        const pushUnique = (arr, value) => {
            if (value === null || value === undefined || value === '') return;
            if (!arr.includes(value)) arr.push(value);
        };

        for (let i = 0; i < statements.length; i++) {
            const statementInfo = statements[i];
            const statementResult = this._parseSingle(statementInfo.text);
            const startLoc = this._indexToLineColumn(sql, statementInfo.start);
            const diagnostics = statementResult.diagnostics.map((diag) => ({
                ...this._offsetDiagnostic(diag, startLoc),
                statementIndex: i + 1
            }));

            result.diagnostics.push(...diagnostics);
            result.statements.push({
                index: i + 1,
                type: statementResult.type,
                text: statementInfo.text,
                startLine: startLoc.line,
                diagnostics
            });

            statementResult.clauses.forEach((clause) => pushUnique(result.clauses, clause));
            statementResult.tables.forEach((table) => pushUnique(result.tables, table));
            statementResult.columns.forEach((column) => pushUnique(result.columns, column));
            statementResult.ctes.forEach((cte) => pushUnique(result.ctes, cte));

            if (statementResult.error) {
                break;
            }

            this._applyParseCatalogEffects(statementResult);
            result.steps.push(
                ...statementResult.steps.map((step) => ({
                    ...step,
                    statementIndex: i + 1
                }))
            );
        }

        this._parseCatalog = null;
        this._parseTableColumns = null;
        this._parseTableColumnMeta = null;
        this._parseTableRows = null;
        result.diagnostics = this._sortDiagnostics(result.diagnostics);
        result.type = result.statements.length === 1 ? result.statements[0].type : 'SCRIPT';

        const firstError = result.diagnostics.find((diag) => diag.severity === 'error');
        const firstWarning = result.diagnostics.find((diag) => diag.severity === 'warning');
        result.error = firstError ? firstError.message : null;
        result.warning = firstWarning ? firstWarning.message : null;

        if (firstError) {
            result.steps = [];
        }

        return result;
    }

    _parseSingle(sql) {
        const result = {
            dialect: this.activeDialect,
            dialectLabel: this._getActiveDialectProfile().label,
            type: null,
            clauses: [],
            tables: [],
            columns: [],
            ctes: [],
            diagnostics: [],
            error: null,
            warning: null,
            steps: []
        };

        const analysisSql = this._stripCommentsForAnalysis(sql);
        const normalized = analysisSql.replace(/\s+/g, ' ').trim();
        if (!normalized) {
            result.diagnostics = [
                this._createDiagnostic(sql || '', {
                    message: 'Leeres SQL-Statement.',
                    severity: 'warning',
                    sqlstate: '01000',
                    index: 0,
                    hint: 'Statement entfernen oder mit SQL fuellen.'
                })
            ];
            result.warning = result.diagnostics[0].message;
            return result;
        }

        const upper = normalized.toUpperCase();
        result.clauses = this._detectClauses(normalized);
        result.type = this._detectType(upper);
        const cteNames = result.type === 'SELECT' ? this._extractCteNames(normalized) : [];
        result.ctes = cteNames;
        result.tables = this._extractTables(normalized, { ignoreNames: cteNames });
        result.columns = this._extractColumns(normalized);
        result.diagnostics = this._collectDiagnostics(sql, normalized, result);

        const firstError = result.diagnostics.find((d) => d.severity === 'error');
        const firstWarning = result.diagnostics.find((d) => d.severity === 'warning');
        result.error = firstError ? firstError.message : null;
        result.warning = firstWarning ? firstWarning.message : null;

        if (!firstError) {
            result.steps = this._buildSteps(normalized, upper, result);
        }

        return result;
    }

    _splitSqlStatements(sql) {
        const segments = [];
        let start = 0;
        let inSingleQuote = false;
        let inDoubleQuote = false;
        let inLineComment = false;
        let inBlockComment = false;

        const pushSegment = (segmentStart, segmentEnd) => {
            const raw = sql.slice(segmentStart, segmentEnd);
            const leading = raw.match(/^\s*/)[0].length;
            const trailing = raw.match(/\s*$/)[0].length;
            const contentStart = segmentStart + leading;
            const contentEnd = segmentEnd - trailing;
            if (contentEnd <= contentStart) return;

            const text = sql.slice(contentStart, contentEnd);
            if (!this._stripCommentsForAnalysis(text).trim()) return;

            segments.push({
                start: contentStart,
                end: contentEnd,
                text
            });
        };

        for (let i = 0; i < sql.length; i++) {
            const ch = sql[i];
            const next = sql[i + 1];

            if (inLineComment) {
                if (ch === '\n') inLineComment = false;
                continue;
            }

            if (inBlockComment) {
                if (ch === '*' && next === '/') {
                    inBlockComment = false;
                    i++;
                }
                continue;
            }

            if (!inSingleQuote && !inDoubleQuote) {
                if (ch === '-' && next === '-') {
                    inLineComment = true;
                    i++;
                    continue;
                }
                if (ch === '/' && next === '*') {
                    inBlockComment = true;
                    i++;
                    continue;
                }
            }

            if (ch === '\'' && !inDoubleQuote) {
                if (inSingleQuote && next === '\'') {
                    i++;
                    continue;
                }
                inSingleQuote = !inSingleQuote;
                continue;
            }

            if (ch === '"' && !inSingleQuote) {
                inDoubleQuote = !inDoubleQuote;
                continue;
            }

            if (!inSingleQuote && !inDoubleQuote && ch === ';') {
                pushSegment(start, i + 1);
                start = i + 1;
            }
        }

        pushSegment(start, sql.length);
        return segments;
    }

    _offsetDiagnostic(diag, statementStartLoc) {
        const startLine = statementStartLoc.line + (diag.line - 1);
        const endLine = statementStartLoc.line + (diag.endLine - 1);

        return {
            ...diag,
            line: startLine,
            endLine,
            column: diag.line === 1 ? statementStartLoc.column + diag.column - 1 : diag.column,
            endColumn: diag.endLine === 1 ? statementStartLoc.column + diag.endColumn - 1 : diag.endColumn
        };
    }

    _applyParseCatalogEffects(statementResult) {
        if (!this._parseCatalog) return;

        if (statementResult.type === 'CREATE') {
            const step = statementResult.steps.find((entry) => String(entry.type || '').toUpperCase().startsWith('CREATE'));
            if (step && step.entity) {
                this._registerParseObject(step.objectType || 'TABLE', step.entity);
                if (String(step.objectType || '').toUpperCase() === 'TABLE' && this._parseTableColumns) {
                    const columns = Array.isArray(step.columns)
                        ? step.columns.map((col) => String(typeof col === 'string' ? col : col?.name || '').toLowerCase()).filter(Boolean)
                        : [];
                    this._parseTableColumns.set(step.entity.toLowerCase(), new Set(columns));
                }
                if (String(step.objectType || '').toUpperCase() === 'TABLE' && this._parseTableColumnMeta instanceof Map) {
                    const columnMeta = Array.isArray(step.columns)
                        ? step.columns.map((columnDef) => this._toColumnMeta(columnDef)).filter(Boolean)
                        : [];
                    this._parseTableColumnMeta.set(step.entity.toLowerCase(), columnMeta);
                }
                if (String(step.objectType || '').toUpperCase() === 'TABLE' && this._parseTableRows instanceof Map) {
                    this._parseTableRows.set(step.entity.toLowerCase(), []);
                }
            }
            return;
        }

        if (statementResult.type === 'DROP') {
            const step = statementResult.steps.find((entry) => entry.type === 'DROP');
            if (step && step.objectType && step.entity) {
                this._removeParseObject(step.objectType, step.entity);
                if (String(step.objectType).toUpperCase() === 'TABLE' && this._parseTableColumns) {
                    this._parseTableColumns.delete(step.entity.toLowerCase());
                }
                if (String(step.objectType).toUpperCase() === 'TABLE' && this._parseTableColumnMeta instanceof Map) {
                    this._parseTableColumnMeta.delete(step.entity.toLowerCase());
                }
                if (String(step.objectType).toUpperCase() === 'TABLE' && this._parseTableRows instanceof Map) {
                    this._parseTableRows.delete(step.entity.toLowerCase());
                }
            }
            return;
        }

        if (statementResult.type === 'ALTER') {
            const step = statementResult.steps.find((entry) => entry.type === 'ALTER');
            if (!step || !step.entity) return;

            const action = String(step.action || '').toUpperCase();
            if (action === 'RENAME') {
                const renameMatch = String(step.payload || '').match(/\bTO\s+([a-zA-Z_]\w*)/i);
                if (renameMatch) {
                    this._removeParseObject('TABLE', step.entity);
                    this._registerParseObject('TABLE', renameMatch[1]);
                    if (this._parseTableColumns && this._parseTableColumns.has(step.entity.toLowerCase())) {
                        const cols = this._parseTableColumns.get(step.entity.toLowerCase());
                        this._parseTableColumns.delete(step.entity.toLowerCase());
                        this._parseTableColumns.set(renameMatch[1].toLowerCase(), cols);
                    }
                    if (this._parseTableColumnMeta instanceof Map && this._parseTableColumnMeta.has(step.entity.toLowerCase())) {
                        const meta = this._parseTableColumnMeta.get(step.entity.toLowerCase()) || [];
                        this._parseTableColumnMeta.delete(step.entity.toLowerCase());
                        this._parseTableColumnMeta.set(renameMatch[1].toLowerCase(), meta);
                    }
                    if (this._parseTableRows instanceof Map && this._parseTableRows.has(step.entity.toLowerCase())) {
                        const rows = this._parseTableRows.get(step.entity.toLowerCase()) || [];
                        this._parseTableRows.delete(step.entity.toLowerCase());
                        this._parseTableRows.set(renameMatch[1].toLowerCase(), rows);
                    }
                }
                return;
            }

            if (this._parseTableColumns && this._parseTableColumns.has(step.entity.toLowerCase())) {
                const columnSet = this._parseTableColumns.get(step.entity.toLowerCase());
                if (action === 'ADD' && step.column) {
                    const columnName = String(step.column).toLowerCase();
                    columnSet.add(columnName);
                    if (this._parseTableColumnMeta instanceof Map) {
                        const metaRows = this._parseTableColumnMeta.get(step.entity.toLowerCase()) || [];
                        if (!metaRows.some((meta) => meta.name === columnName)) {
                            metaRows.push(this._toColumnMeta({
                                name: columnName,
                                type: step.columnType || 'TEXT'
                            }));
                        }
                        this._parseTableColumnMeta.set(step.entity.toLowerCase(), metaRows);
                    }
                    const rows = this._getMutableParseTableRows(step.entity);
                    if (Array.isArray(rows)) {
                        rows.forEach((row) => {
                            if (!Object.prototype.hasOwnProperty.call(row, columnName)) {
                                row[columnName] = null;
                            }
                        });
                    }
                } else if (action === 'DROP' && step.column) {
                    const columnName = String(step.column).toLowerCase();
                    columnSet.delete(columnName);
                    if (this._parseTableColumnMeta instanceof Map && this._parseTableColumnMeta.has(step.entity.toLowerCase())) {
                        const metaRows = this._parseTableColumnMeta.get(step.entity.toLowerCase());
                        this._parseTableColumnMeta.set(
                            step.entity.toLowerCase(),
                            metaRows.filter((meta) => meta.name !== columnName)
                        );
                    }
                    const rows = this._getMutableParseTableRows(step.entity);
                    if (Array.isArray(rows)) {
                        rows.forEach((row) => {
                            delete row[columnName];
                        });
                    }
                }
            }
            return;
        }

        if (statementResult.type === 'INSERT') {
            const step = statementResult.steps.find((entry) => entry.type === 'INSERT');
            if (!step || !step.entity) return;

            const allColumns = this._getTableColumnNames(step.entity);
            if (allColumns.length === 0) return;

            const targetColumns = Array.isArray(step.columns) && step.columns.length > 0
                ? step.columns.map((columnName) => String(columnName).toLowerCase())
                : allColumns;
            const rows = Array.isArray(step.rows)
                ? step.rows
                : (Array.isArray(step.values) ? [step.values] : []);
            const targetRows = this._getMutableParseTableRows(step.entity);
            if (!Array.isArray(targetRows)) return;

            rows.forEach((values) => {
                if (!Array.isArray(values)) return;
                targetRows.push(this._buildRowRecordForInsert(allColumns, targetColumns, values));
            });
            return;
        }

        if (statementResult.type === 'UPDATE') {
            const step = statementResult.steps.find((entry) => entry.type === 'UPDATE');
            if (!step || !step.entity) return;

            const targetRows = this._getMutableParseTableRows(step.entity);
            if (!Array.isArray(targetRows) || targetRows.length === 0) return;

            const assignments = Array.isArray(step.modifications) ? step.modifications : [];
            const matchedIndices = this._findMatchingRowIndicesFromRecords(targetRows, step.condition, 'UPDATE');
            matchedIndices.forEach((rowIndex) => {
                const row = targetRows[rowIndex];
                if (!row) return;
                assignments.forEach((assignment) => {
                    const columnName = String(assignment?.col || '').toLowerCase();
                    if (!columnName) return;
                    row[columnName] = assignment.val;
                });
            });
            return;
        }

        if (statementResult.type === 'DELETE') {
            const step = statementResult.steps.find((entry) => entry.type === 'DELETE');
            if (!step || !step.entity) return;

            const targetRows = this._getMutableParseTableRows(step.entity);
            if (!Array.isArray(targetRows) || targetRows.length === 0) return;

            const matchedIndices = this._findMatchingRowIndicesFromRecords(targetRows, step.condition, 'DELETE');
            matchedIndices
                .sort((a, b) => b - a)
                .forEach((rowIndex) => {
                    if (rowIndex >= 0 && rowIndex < targetRows.length) {
                        targetRows.splice(rowIndex, 1);
                    }
                });
            return;
        }

        if (statementResult.type === 'TRUNCATE') {
            const step = statementResult.steps.find((entry) => entry.type === 'TRUNCATE');
            if (!step || !step.entity) return;
            if (this._parseTableRows instanceof Map) {
                this._parseTableRows.set(step.entity.toLowerCase(), []);
            }
            return;
        }

        if (statementResult.type === 'MERGE') {
            const step = statementResult.steps.find((entry) => entry.type === 'MERGE');
            if (!step || !step.entity || !step.source) return;

            const targetRows = this._getMutableParseTableRows(step.entity);
            const sourceRows = this._getTableRowRecords(step.source);
            const targetColumns = this._getTableColumnNames(step.entity);
            if (!Array.isArray(targetRows) || targetColumns.length === 0 || sourceRows.length === 0) return;

            const targetKey = String(step.targetKey || '').toLowerCase();
            const sourceKey = String(step.sourceKey || '').toLowerCase();
            if (!targetKey || !sourceKey) return;

            const targetRefs = new Set(
                Array.isArray(step.targetRefs) && step.targetRefs.length > 0
                    ? step.targetRefs.map((entry) => String(entry).toLowerCase())
                    : [String(step.entity).toLowerCase(), 'target']
            );
            const sourceRefs = new Set(
                Array.isArray(step.sourceRefs) && step.sourceRefs.length > 0
                    ? step.sourceRefs.map((entry) => String(entry).toLowerCase())
                    : [String(step.source).toLowerCase(), 'source']
            );
            const updateAssignments = Array.isArray(step.updateAssignments)
                ? step.updateAssignments.map((assignment) => ({
                    ...assignment,
                    col: String(assignment.col || '').toLowerCase()
                }))
                : [];
            const insertSpec = step.insertSpec || null;

            sourceRows.forEach((sourceRow) => {
                const matchedIndex = targetRows.findIndex((targetRow) => this._compareSqlValues(
                    targetRow[targetKey],
                    '=',
                    sourceRow[sourceKey]
                ));

                if (matchedIndex >= 0) {
                    if (updateAssignments.length > 0) {
                        const targetRow = targetRows[matchedIndex];
                        updateAssignments.forEach((assignment) => {
                            if (!assignment.col) return;
                            targetRow[assignment.col] = this._resolveMergeTokenValue(assignment, {
                                targetRow,
                                sourceRow,
                                targetRefs,
                                sourceRefs
                            });
                        });
                    }
                    return;
                }

                if (!insertSpec) return;

                const insertColumns = Array.isArray(insertSpec.columns) && insertSpec.columns.length > 0
                    ? insertSpec.columns.map((columnName) => String(columnName).toLowerCase())
                    : targetColumns;
                const insertValues = Array.isArray(insertSpec.values) ? insertSpec.values : [];
                if (insertColumns.length !== insertValues.length) return;

                const nextRow = {};
                targetColumns.forEach((columnName) => {
                    nextRow[columnName] = null;
                });
                insertValues.forEach((token, index) => {
                    nextRow[insertColumns[index]] = this._resolveMergeTokenValue(token, {
                        targetRow: null,
                        sourceRow,
                        targetRefs,
                        sourceRefs
                    });
                });
                targetRows.push(nextRow);
            });
        }
    }

    _buildParseCatalogSnapshot() {
        return {
            TABLE: new Set(Object.keys(this.simulationData.TABLES || {}).map((name) => name.toLowerCase())),
            VIEW: new Set(Object.keys(this.simulationData.VIEWS || {}).map((name) => name.toLowerCase())),
            INDEX: new Set(Object.keys(this.simulationData.INDEXES || {}).map((name) => name.toLowerCase())),
            SCHEMA: new Set(Object.keys(this.simulationData.SCHEMAS || {}).map((name) => name.toLowerCase())),
            SEQUENCE: new Set(Object.keys(this.simulationData.SEQUENCES || {}).map((name) => name.toLowerCase()))
        };
    }

    _buildParseTableColumnSnapshot() {
        const snapshot = new Map();
        Object.entries(this.simulationData.TABLES || {}).forEach(([tableName, table]) => {
            const columns = Array.isArray(table?.columns)
                ? table.columns
                    .map((col) => (typeof col === 'string' ? col : col?.name))
                    .filter(Boolean)
                    .map((name) => String(name).toLowerCase())
                : [];
            snapshot.set(String(tableName).toLowerCase(), new Set(columns));
        });
        return snapshot;
    }

    _buildParseTableColumnMetaSnapshot() {
        const snapshot = new Map();
        Object.entries(this.simulationData.TABLES || {}).forEach(([tableName, table]) => {
            const columns = Array.isArray(table?.columns)
                ? table.columns
                    .map((columnDef) => this._toColumnMeta(columnDef))
                    .filter(Boolean)
                : [];
            snapshot.set(String(tableName).toLowerCase(), columns);
        });
        return snapshot;
    }

    _buildParseTableRowSnapshot() {
        const snapshot = new Map();
        Object.entries(this.simulationData.TABLES || {}).forEach(([tableName, table]) => {
            const normalizedTable = String(tableName).toLowerCase();
            const columns = Array.isArray(table?.columns)
                ? table.columns
                    .map((col) => (typeof col === 'string' ? col : col?.name))
                    .filter(Boolean)
                    .map((name) => String(name).toLowerCase())
                : [];
            const rows = Array.isArray(table?.rows) ? table.rows : [];
            const records = rows.map((row) => {
                if (Array.isArray(row)) {
                    const record = {};
                    columns.forEach((columnName, index) => {
                        record[columnName] = row[index];
                    });
                    return record;
                }
                const record = {};
                Object.entries(row || {}).forEach(([key, value]) => {
                    record[String(key).toLowerCase()] = value;
                });
                return record;
            });
            snapshot.set(normalizedTable, records);
        });
        return snapshot;
    }

    _toColumnMeta(columnDef) {
        if (typeof columnDef === 'string') {
            return {
                name: columnDef.toLowerCase(),
                type: 'TEXT',
                isPK: false,
                isUnique: false,
                isNotNull: false,
                isFK: false,
                fkTargetTable: '',
                fkTargetColumn: '',
                fkTarget: ''
            };
        }

        const name = String(columnDef?.name || '').toLowerCase();
        if (!name) return null;

        const type = String(columnDef?.type || 'TEXT').replace(/\s+/g, '').toUpperCase();
        const fkTarget = String(columnDef?.fkTarget || '').toLowerCase();
        const [fkTargetTable, fkTargetColumn] = fkTarget.includes('.') ? fkTarget.split('.', 2) : ['', ''];
        const isPK = Boolean(columnDef?.isPK);
        const isUnique = Boolean(columnDef?.isUnique || isPK);
        const isNotNull = Boolean(columnDef?.isNotNull || columnDef?.notNull || columnDef?.nullable === false || isPK);

        return {
            name,
            type,
            isPK,
            isUnique,
            isNotNull,
            isFK: Boolean(columnDef?.isFK || fkTargetTable),
            fkTargetTable,
            fkTargetColumn,
            fkTarget: fkTargetTable && fkTargetColumn ? `${fkTargetTable}.${fkTargetColumn}` : ''
        };
    }

    _normalizeObjectType(type) {
        const normalized = String(type || '').trim().toUpperCase();
        if (!normalized) return '';
        if (normalized === 'TABLES') return 'TABLE';
        if (normalized === 'VIEWS') return 'VIEW';
        if (normalized === 'INDEXES') return 'INDEX';
        if (normalized === 'SCHEMAS') return 'SCHEMA';
        if (normalized === 'SEQUENCES') return 'SEQUENCE';
        return normalized;
    }

    _simulationStoreForType(type) {
        const normalizedType = this._normalizeObjectType(type);
        if (normalizedType === 'TABLE') return this.simulationData.TABLES || {};
        if (normalizedType === 'VIEW') return this.simulationData.VIEWS || {};
        if (normalizedType === 'INDEX') return this.simulationData.INDEXES || {};
        if (normalizedType === 'SCHEMA') return this.simulationData.SCHEMAS || {};
        if (normalizedType === 'SEQUENCE') return this.simulationData.SEQUENCES || {};
        return {};
    }

    _objectExists(type, name) {
        const normalizedType = this._normalizeObjectType(type);
        const normalizedName = String(name || '').trim().toLowerCase();
        if (!normalizedType || !normalizedName) return false;

        if (this._parseCatalog && this._parseCatalog[normalizedType] instanceof Set) {
            return this._parseCatalog[normalizedType].has(normalizedName);
        }

        const store = this._simulationStoreForType(normalizedType);
        if (Object.prototype.hasOwnProperty.call(store, normalizedName)) return true;
        return Object.keys(store).some((entry) => entry.toLowerCase() === normalizedName);
    }

    _registerParseObject(type, name) {
        const normalizedType = this._normalizeObjectType(type);
        const normalizedName = String(name || '').trim().toLowerCase();
        if (!this._parseCatalog || !this._parseCatalog[normalizedType] || !normalizedName) return;
        this._parseCatalog[normalizedType].add(normalizedName);
    }

    _removeParseObject(type, name) {
        const normalizedType = this._normalizeObjectType(type);
        const normalizedName = String(name || '').trim().toLowerCase();
        if (!this._parseCatalog || !this._parseCatalog[normalizedType] || !normalizedName) return;
        this._parseCatalog[normalizedType].delete(normalizedName);
    }

    _tableExists(tableName) {
        return this._objectExists('TABLE', tableName);
    }

    _getTableDataByName(tableName) {
        const normalized = String(tableName || '').trim().toLowerCase();
        if (!normalized) return null;

        const direct = this.simulationData.TABLES?.[normalized];
        if (direct) return direct;

        const key = Object.keys(this.simulationData.TABLES || {}).find((entry) => entry.toLowerCase() === normalized);
        return key ? this.simulationData.TABLES[key] : null;
    }

    _getTableColumnNames(tableName) {
        const normalized = String(tableName || '').trim().toLowerCase();
        if (this._parseTableColumns instanceof Map && this._parseTableColumns.has(normalized)) {
            return [...this._parseTableColumns.get(normalized)];
        }

        const table = this._getTableDataByName(tableName);
        if (!table || !Array.isArray(table.columns)) return [];

        return table.columns
            .map((col) => (typeof col === 'string' ? col : col?.name))
            .filter(Boolean)
            .map((name) => String(name).toLowerCase());
    }

    _getTableColumnMeta(tableName) {
        const normalized = String(tableName || '').trim().toLowerCase();
        if (this._parseTableColumnMeta instanceof Map && this._parseTableColumnMeta.has(normalized)) {
            return this._parseTableColumnMeta.get(normalized).map((meta) => ({ ...meta }));
        }

        const table = this._getTableDataByName(tableName);
        if (!table || !Array.isArray(table.columns)) return [];

        return table.columns
            .map((col) => this._toColumnMeta(col))
            .filter(Boolean);
    }

    _getTableRowRecords(tableName) {
        const normalized = String(tableName || '').trim().toLowerCase();
        if (this._parseTableRows instanceof Map && this._parseTableRows.has(normalized)) {
            return this._parseTableRows.get(normalized).map((row) => ({ ...row }));
        }

        const table = this._getTableDataByName(tableName);
        if (!table || !Array.isArray(table.rows)) return [];

        const columnNames = this._getTableColumnNames(tableName);
        return table.rows.map((row) => {
            if (Array.isArray(row)) {
                const record = {};
                columnNames.forEach((columnName, index) => {
                    record[columnName] = row[index];
                });
                return record;
            }

            const record = {};
            Object.entries(row || {}).forEach(([key, value]) => {
                record[String(key).toLowerCase()] = value;
            });
            return record;
        });
    }

    _getMutableParseTableRows(tableName) {
        if (!(this._parseTableRows instanceof Map)) return null;
        const normalized = String(tableName || '').trim().toLowerCase();
        if (!this._parseTableRows.has(normalized)) {
            this._parseTableRows.set(normalized, []);
        }
        return this._parseTableRows.get(normalized);
    }

    _normalizeComparable(value) {
        if (value === null || value === undefined) return null;
        if (typeof value === 'number' || typeof value === 'boolean') return value;

        const text = String(value).trim();
        if (/^[+-]?\d+(?:\.\d+)?$/.test(text)) return Number(text);
        if (/^TRUE$/i.test(text)) return true;
        if (/^FALSE$/i.test(text)) return false;
        if (/^NULL$/i.test(text)) return null;
        return text;
    }

    _compareSqlValues(leftRaw, operator, rightRaw) {
        const left = this._normalizeComparable(leftRaw);
        const right = this._normalizeComparable(rightRaw);

        if (operator === '=' || operator === '==') return left === right;
        if (operator === '!=' || operator === '<>') return left !== right;
        if (left === null || right === null) return false;
        if (operator === '>') return left > right;
        if (operator === '>=') return left >= right;
        if (operator === '<') return left < right;
        if (operator === '<=') return left <= right;
        return false;
    }

    _parseConditionGroups(conditionSql) {
        const text = String(conditionSql || '').trim();
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
                    value: this._normalizeInsertValue(match[3])
                });
            }

            if (clauses.length > 0) groups.push(clauses);
        }

        return groups;
    }

    _findMatchingRowIndicesFromRecords(records, conditionSql, mode = '') {
        if (!Array.isArray(records)) return [];
        const text = String(conditionSql || '').trim();
        if (!text) return records.map((_, index) => index);

        const groups = this._parseConditionGroups(text);
        if (!groups) {
            if (mode === 'UPDATE') return records.length > 0 ? [0] : [];
            if (mode === 'DELETE') return records.length > 0 ? [records.length - 1] : [];
            return [];
        }

        const matches = [];
        records.forEach((record, index) => {
            const isMatch = groups.some((group) => group.every((clause) => this._compareSqlValues(
                record[clause.column],
                clause.operator,
                clause.value
            )));
            if (isMatch) matches.push(index);
        });
        return matches;
    }

    _buildRowRecordForInsert(allColumns, targetColumns, values) {
        const record = {};
        allColumns.forEach((columnName) => {
            record[columnName] = null;
        });

        targetColumns.forEach((columnName, index) => {
            record[columnName] = values[index];
        });
        return record;
    }

    _resolveMergeTokenValue(token, context) {
        const raw = String(token?.raw || '').trim();
        if (raw) {
            const ref = /^([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)$/i.exec(raw);
            if (ref) {
                const alias = ref[1].toLowerCase();
                const column = ref[2].toLowerCase();
                if (context.targetRefs.has(alias)) return context.targetRow?.[column];
                if (context.sourceRefs.has(alias)) return context.sourceRow?.[column];
            }
        }

        if (token && Object.prototype.hasOwnProperty.call(token, 'value')) return token.value;
        if (token && Object.prototype.hasOwnProperty.call(token, 'val')) return token.val;
        return this._normalizeInsertValue(raw);
    }

    _collectConstraintDiagnosticsForRows(sql, tableName, rows) {
        const diagnostics = [];
        const table = String(tableName || '').toLowerCase();
        const columnMeta = this._getTableColumnMeta(table);
        if (columnMeta.length === 0) return diagnostics;

        const seenDiagKeys = new Set();
        const pushUniqueDiag = (key, factory) => {
            if (seenDiagKeys.has(key)) return;
            seenDiagKeys.add(key);
            diagnostics.push(factory());
        };

        const byName = new Map(columnMeta.map((meta) => [meta.name, meta]));

        rows.forEach((row) => {
            columnMeta.forEach((meta) => {
                const value = row[meta.name];
                if (meta.isNotNull && (value === null || value === undefined)) {
                    const key = `notnull:${meta.name}`;
                    pushUniqueDiag(key, () => this._createDiagnostic(sql, {
                        message: `NOT NULL verletzt: Spalte "${meta.name}" in Tabelle "${table}" darf nicht NULL sein.`,
                        severity: 'error',
                        sqlstate: '23502',
                        index: this._findKeywordIndex(sql, new RegExp(`\\b${this._escapeRegex(meta.name)}\\b`, 'i')),
                        length: meta.name.length,
                        hint: 'Wert setzen oder Spaltendefinition ohne NOT NULL/PRIMARY KEY verwenden.'
                    }));
                }
            });
        });

        columnMeta
            .filter((meta) => meta.isUnique || meta.isPK)
            .forEach((meta) => {
                const seenValues = new Map();
                rows.forEach((row) => {
                    const normalized = this._normalizeComparable(row[meta.name]);
                    if (normalized === null) return;
                    const valueKey = `${typeof normalized}:${String(normalized)}`;
                    if (seenValues.has(valueKey)) {
                        const key = `unique:${meta.name}:${valueKey}`;
                        pushUniqueDiag(key, () => this._createDiagnostic(sql, {
                            message: `UNIQUE/PRIMARY KEY verletzt: doppelter Wert für Spalte "${meta.name}".`,
                            severity: 'error',
                            sqlstate: '23505',
                            index: this._findKeywordIndex(sql, new RegExp(`\\b${this._escapeRegex(meta.name)}\\b`, 'i')),
                            length: meta.name.length,
                            hint: 'Eindeutigen Schlüsselwert verwenden.'
                        }));
                    } else {
                        seenValues.set(valueKey, true);
                    }
                });
            });

        columnMeta
            .filter((meta) => meta.isFK && meta.fkTargetTable && meta.fkTargetColumn)
            .forEach((meta) => {
                const targetRows = this._getTableRowRecords(meta.fkTargetTable);
                const targetColumns = this._getTableColumnNames(meta.fkTargetTable);
                if (targetColumns.length > 0 && !targetColumns.includes(meta.fkTargetColumn)) return;

                rows.forEach((row) => {
                    const value = row[meta.name];
                    if (value === null || value === undefined) return;
                    const hasRef = targetRows.some((targetRow) => this._compareSqlValues(targetRow[meta.fkTargetColumn], '=', value));
                    if (!hasRef) {
                        const key = `fk:${meta.name}:${String(value)}`;
                        pushUniqueDiag(key, () => this._createDiagnostic(sql, {
                            message: `Fremdschlüssel verletzt: Wert "${value}" in "${meta.name}" existiert nicht in "${meta.fkTargetTable}.${meta.fkTargetColumn}".`,
                            severity: 'error',
                            sqlstate: '23503',
                            index: this._findKeywordIndex(sql, new RegExp(`\\b${this._escapeRegex(meta.name)}\\b`, 'i')),
                            length: meta.name.length,
                            hint: 'Nur vorhandene Schlüsselwerte der Referenztabelle verwenden.'
                        }));
                    }
                });
            });

        return diagnostics;
    }

    // ─── Interne Methoden ────────────────────────────────────────────────────

    /** Erkennt alle SQL-Clauses im Text, in Reihenfolge ihres ersten Vorkommens */
    _detectClauses(sql) {
        const found = [];
        const positions = [];

        for (const def of this._clauseDefs) {
            const match = def.regex.exec(sql);
            if (match) {
                // Normalisiere JOIN-Varianten auf 'JOIN' für die Visualisierung
                const displayKey = def.key.includes('JOIN') ? 'JOIN' : def.key;
                // Nur einmal pro kanonischem Key
                if (!positions.some(p => p.key === displayKey)) {
                    positions.push({ key: displayKey, index: match.index });
                }
            }
        }

        // Sortieren nach Position im Text → Schreibreihenfolge
        positions.sort((a, b) => a.index - b.index);
        return positions.map(p => p.key);
    }

    /** Bestimmt den primären Statement-Typ */
    _detectType(upper) {
        if (upper.startsWith('BEGIN TRANSACTION')) return 'BEGIN';
        if (upper.startsWith('BEGIN')) return 'BEGIN';
        if (upper.startsWith('WITH')) return 'SELECT';
        if (upper.startsWith('SELECT')) return 'SELECT';
        if (upper.startsWith('INSERT')) return 'INSERT';
        if (upper.startsWith('UPDATE')) return 'UPDATE';
        if (upper.startsWith('DELETE')) return 'DELETE';
        if (/^CREATE\s+(?:OR\s+REPLACE\s+)?(?:UNIQUE\s+)?(?:TABLE|VIEW|INDEX|SCHEMA|SEQUENCE)\b/.test(upper)) return 'CREATE';
        if (upper.startsWith('TRUNCATE')) return 'TRUNCATE';
        if (upper.startsWith('MERGE')) return 'MERGE';
        if (upper.startsWith('COMMIT')) return 'COMMIT';
        if (upper.startsWith('ROLLBACK')) return 'ROLLBACK';
        if (upper.startsWith('SAVEPOINT')) return 'SAVEPOINT';
        if (upper.startsWith('GRANT')) return 'GRANT';
        if (upper.startsWith('REVOKE')) return 'REVOKE';
        if (upper.startsWith('DROP')) return 'DROP';
        if (upper.startsWith('ALTER')) return 'ALTER';
        return 'UNKNOWN';
    }

    _detectCreateObjectType(sql) {
        const analysisSql = this._stripCommentsForAnalysis(sql);
        const match = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:UNIQUE\s+)?(TABLE|VIEW|INDEX|SCHEMA|SEQUENCE)\b/i.exec(analysisSql);
        return match ? match[1].toUpperCase() : null;
    }

    _detectDropObjectType(sql) {
        const analysisSql = this._stripCommentsForAnalysis(sql);
        const match = /\bDROP\s+(TABLE|VIEW|INDEX|SCHEMA|SEQUENCE)\b/i.exec(analysisSql);
        return match ? match[1].toUpperCase() : null;
    }

    _parseWithClause(sql) {
        const text = String(sql || '');
        let i = 0;
        const len = text.length;
        const cteNames = [];
        const ctes = [];
        let isRecursive = false;

        const skipWs = () => {
            while (i < len && /\s/.test(text[i])) i++;
        };

        skipWs();
        if (!/^WITH\b/i.test(text.slice(i))) return null;
        i += 4;
        skipWs();

        if (/^RECURSIVE\b/i.test(text.slice(i))) {
            isRecursive = true;
            i += 9;
            skipWs();
        }

        while (i < len) {
            const nameMatch = /^([a-zA-Z_]\w*)/.exec(text.slice(i));
            if (!nameMatch) {
                return {
                    error: {
                        message: 'Syntaxfehler in WITH-Klausel: CTE-Name erwartet.',
                        index: i,
                        hint: 'Beispiel: WITH cte_name AS (SELECT ...)'
                    }
                };
            }

            cteNames.push(nameMatch[1].toLowerCase());
            i += nameMatch[1].length;
            skipWs();

            if (text[i] === '(') {
                const closeColumns = this._findClosingParen(text, i);
                if (closeColumns < 0) {
                    return {
                        error: {
                            message: 'Syntaxfehler in WITH-Klausel: schliessende ")" in CTE-Spaltenliste fehlt.',
                            index: i,
                            hint: 'Klammer in der CTE-Spaltenliste schliessen.'
                        }
                    };
                }
                i = closeColumns + 1;
                skipWs();
            }

            if (!/^AS\b/i.test(text.slice(i))) {
                return {
                    error: {
                        message: 'Syntaxfehler in WITH-Klausel: AS nach CTE-Namen erwartet.',
                        index: i,
                        hint: 'CTE muss die Form "<name> AS (SELECT ...)" haben.'
                    }
                };
            }
            i += 2;
            skipWs();

            if (text[i] !== '(') {
                return {
                    error: {
                        message: 'Syntaxfehler in WITH-Klausel: "(" nach AS erwartet.',
                        index: i,
                        hint: 'CTE-Query muss in Klammern stehen.'
                    }
                };
            }

            const closeQuery = this._findClosingParen(text, i);
            if (closeQuery < 0) {
                return {
                    error: {
                        message: 'Syntaxfehler in WITH-Klausel: schliessende ")" fuer CTE-Query fehlt.',
                        index: i,
                        hint: 'Klammer fuer CTE-SELECT schliessen.'
                    }
                };
            }
            ctes.push({
                name: nameMatch[1].toLowerCase(),
                query: text.slice(i + 1, closeQuery).trim(),
                queryStart: i + 1,
                queryEnd: closeQuery
            });
            i = closeQuery + 1;
            skipWs();

            if (text[i] === ',') {
                i++;
                skipWs();
                continue;
            }
            break;
        }

        const bodyStart = i;
        const body = text.slice(bodyStart).trim();
        if (!body) {
            return {
                error: {
                    message: 'Syntaxfehler in WITH-Klausel: Haupt-SELECT nach CTE erwartet.',
                    index: Math.max(0, bodyStart),
                    hint: 'Nach den CTE-Definitionen ein SELECT-Statement angeben.'
                }
            };
        }

        return {
            cteNames,
            ctes,
            isRecursive,
            body,
            bodyStart
        };
    }

    _splitTopLevelSetParts(sql, baseOffset = 0) {
        const text = String(sql || '');
        const parts = [];
        const operators = [];
        let depth = 0;
        let partStart = 0;
        let inSingleQuote = false;
        let inDoubleQuote = false;
        let inLineComment = false;
        let inBlockComment = false;

        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            const next = text[i + 1];

            if (inLineComment) {
                if (ch === '\n') inLineComment = false;
                continue;
            }
            if (inBlockComment) {
                if (ch === '*' && next === '/') {
                    inBlockComment = false;
                    i++;
                }
                continue;
            }

            if (!inSingleQuote && !inDoubleQuote) {
                if (ch === '-' && next === '-') {
                    inLineComment = true;
                    i++;
                    continue;
                }
                if (ch === '/' && next === '*') {
                    inBlockComment = true;
                    i++;
                    continue;
                }
            }

            if (ch === '\'' && !inDoubleQuote) {
                if (inSingleQuote && next === '\'') {
                    i++;
                    continue;
                }
                inSingleQuote = !inSingleQuote;
                continue;
            }

            if (ch === '"' && !inSingleQuote) {
                inDoubleQuote = !inDoubleQuote;
                continue;
            }

            if (inSingleQuote || inDoubleQuote) continue;

            if (ch === '(') {
                depth++;
                continue;
            }
            if (ch === ')') {
                depth = Math.max(0, depth - 1);
                continue;
            }

            if (depth !== 0) continue;
            if (!/[a-zA-Z_]/.test(ch)) continue;

            let wordEnd = i + 1;
            while (wordEnd < text.length && /[a-zA-Z_]/.test(text[wordEnd])) wordEnd++;
            const word = text.slice(i, wordEnd).toUpperCase();
            if (word !== 'UNION' && word !== 'INTERSECT' && word !== 'EXCEPT') {
                i = wordEnd - 1;
                continue;
            }

            let token = word;
            let tokenEnd = wordEnd;
            if (word === 'UNION') {
                let wsPos = tokenEnd;
                while (wsPos < text.length && /\s/.test(text[wsPos])) wsPos++;
                if (/^ALL\b/i.test(text.slice(wsPos))) {
                    token = 'UNION ALL';
                    tokenEnd = wsPos + 3;
                }
            }

            parts.push(text.slice(partStart, i).trim());
            operators.push({
                token,
                index: baseOffset + i,
                length: token.length
            });
            partStart = tokenEnd;
            i = tokenEnd - 1;
        }

        parts.push(text.slice(partStart).trim());
        return { parts, operators };
    }

    _extractCteNames(sql) {
        const withInfo = this._parseWithClause(sql);
        if (!withInfo || withInfo.error) return [];
        return withInfo.cteNames;
    }

    _extractSetOperations(sql) {
        const text = String(sql || '');
        const withInfo = this._parseWithClause(text);
        const body = withInfo && !withInfo.error ? withInfo.body : text;
        const baseOffset = withInfo && !withInfo.error ? withInfo.bodyStart : 0;
        return this._splitTopLevelSetParts(body, baseOffset).operators;
    }

    _collectKeywordParenthesizedSegments(sql, keywordPattern) {
        const text = String(sql || '');
        const segments = [];
        const regex = new RegExp(`\\b${keywordPattern}\\s*\\(`, 'ig');
        let match;

        while ((match = regex.exec(text)) !== null) {
            const openParenIndex = text.indexOf('(', match.index);
            if (openParenIndex < 0) continue;

            const closeParenIndex = this._findClosingParen(text, openParenIndex);
            if (closeParenIndex < 0) continue;

            segments.push({
                keywordIndex: match.index,
                openParenIndex,
                closeParenIndex,
                content: text.slice(openParenIndex + 1, closeParenIndex).trim()
            });

            regex.lastIndex = closeParenIndex + 1;
        }

        return segments;
    }

    _extractSelectProjectionItems(selectSql) {
        const text = String(selectSql || '').trim();
        if (!text) return null;

        const withInfo = this._parseWithClause(text);
        if (withInfo && withInfo.error) return null;

        const mainSql = withInfo && !withInfo.error ? withInfo.body : text;
        const setParts = this._splitTopLevelSetParts(mainSql);
        const firstPart = String(setParts.parts[0] || mainSql).trim();

        let selectMatch = /\bSELECT\s+(?:TOP\s+\d+\s+)?([\s\S]+?)\s+\bFROM\b/i.exec(firstPart);
        if (!selectMatch) {
            selectMatch = /\bSELECT\s+(?:TOP\s+\d+\s+)?([\s\S]+?)\s*;?\s*$/i.exec(firstPart);
        }
        if (!selectMatch) return null;

        return this._splitSqlList(selectMatch[1])
            .map((entry) => entry.trim())
            .filter(Boolean);
    }

    _hasRecursiveSelfReference(sql, cteName) {
        const query = String(sql || '');
        const name = String(cteName || '').toLowerCase();
        if (!query || !name) return false;

        const refRegex = new RegExp(`\\b(?:FROM|JOIN)\\s+${this._escapeRegex(name)}\\b`, 'i');
        return refRegex.test(query);
    }

    /** Extrahiert Tabellennamen aus FROM / JOIN / INTO / UPDATE-Clauses */
    _extractTables(sql, options = {}) {
        const ignoreNames = new Set(
            Array.isArray(options.ignoreNames)
                ? options.ignoreNames.map((name) => String(name || '').toLowerCase())
                : []
        );

        const tables = new Set();
        const patterns = [
            /\bFROM\s+(\w+)/gi,
            /\bJOIN\s+(\w+)/gi,
            /\bINTO\s+(\w+)/gi,
            /\bUPDATE\s+(\w+)/gi,
            /\bCREATE\s+TABLE\s+(\w+)/gi,
            /\bCREATE\s+VIEW\s+(\w+)/gi,
            /\bALTER\s+TABLE\s+(\w+)/gi,
            /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(\w+)/gi,
            /\bTRUNCATE\s+TABLE\s+(\w+)/gi,
            /\bMERGE\s+INTO\s+(\w+)/gi,
            /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+\w+\s+ON\s+(\w+)/gi,
            /\b(?:GRANT|REVOKE)\s+.+?\bON\s+(?:TABLE\s+)?([a-zA-Z_]\w*)\b/gi,
        ];
        for (const re of patterns) {
            let m;
            while ((m = re.exec(sql)) !== null) {
                const name = String(m[1] || '').toLowerCase();
                if (!name || ignoreNames.has(name)) continue;
                tables.add(name);
            }
        }
        return [...tables];
    }

    /** Extrahiert Spaltennamen aus SELECT-Liste (einfache Heuristik) */
    _extractColumns(sql) {
        const text = String(sql || '');
        const withInfo = this._parseWithClause(text);
        const mainSql = withInfo && !withInfo.error ? withInfo.body : text;
        const setParts = this._splitTopLevelSetParts(mainSql);
        const primarySelect = setParts.parts[0] || mainSql;

        const columns = [];
        const selectMatch = primarySelect.match(/\bSELECT\s+(.+?)\s+\bFROM\b/i);
        if (!selectMatch) return columns;

        const colStr = selectMatch[1];
        if (colStr.trim() === '*') return ['*'];

        this._splitSqlList(colStr).forEach((entry) => {
            const clean = entry.trim().split(/\s+AS\s+/i)[0].trim();
            const col = clean.includes('.') ? clean.split('.')[1] : clean;
            if (col) columns.push(col.trim());
        });
        return columns;
    }

    _collectDiagnostics(rawSql, normalizedSql, result) {
        const diagnostics = [];
        const pushDiag = (diag) => { if (diag) diagnostics.push(diag); };

        this._collectParenthesisDiagnostics(rawSql, diagnostics);

        if (result.type === 'UNKNOWN') {
            const firstTokenIndex = this._findFirstStatementIndex(rawSql);
            pushDiag(this._createDiagnostic(rawSql, {
                    message: 'Unbekannter oder aktuell nicht unterstuetzter SQL-Befehl.',
                    severity: 'error',
                    sqlstate: '42601',
                    index: firstTokenIndex,
                    hint: 'Nur gueltige SQL-Statements verwenden (z.B. SELECT, INSERT, UPDATE, DELETE, CREATE TABLE/VIEW/INDEX/SCHEMA/SEQUENCE, ALTER TABLE, DROP, TRUNCATE, MERGE, BEGIN/COMMIT).'
                }));
            return this._sortDiagnostics(diagnostics);
        }

        if (result.clauses.includes('HAVING') && !result.clauses.includes('GROUP BY')) {
            pushDiag(this._createDiagnostic(rawSql, {
                message: 'Semantik-Hinweis: HAVING ohne GROUP BY.',
                severity: 'warning',
                sqlstate: '01000',
                index: this._findKeywordIndex(rawSql, /\bHAVING\b/i),
                hint: 'HAVING wird in der Regel nach GROUP BY verwendet.'
            }));
        }

        if (result.clauses.includes('OFFSET') && !result.clauses.includes('LIMIT')) {
            const profile = this._getActiveDialectProfile();
            if (profile.offsetWithoutLimitPolicy === 'error' || profile.offsetWithoutLimitPolicy === 'warning') {
                pushDiag(this._createDiagnostic(rawSql, {
                    message: profile.offsetWithoutLimitPolicy === 'error'
                        ? `Syntaxfehler im Dialekt ${profile.label}: OFFSET ohne LIMIT/FETCH ist nicht zulaessig.`
                        : `Semantik-Hinweis (${profile.label}): OFFSET ohne LIMIT kann ungueltig sein.`,
                    severity: profile.offsetWithoutLimitPolicy,
                    sqlstate: profile.offsetWithoutLimitPolicy === 'error' ? '42601' : '01000',
                    index: this._findKeywordIndex(rawSql, /\bOFFSET\b/i),
                    hint: profile.offsetWithoutLimitPolicy === 'error'
                        ? 'ORDER BY ... OFFSET ... FETCH NEXT ... oder LIMIT verwenden.'
                        : 'LIMIT ergaenzen oder DBMS-spezifische Syntax pruefen.'
                }));
            }
        }

        diagnostics.push(...this._collectDialectCompatibilityDiagnostics(rawSql, result));

        if (result.type === 'SELECT') {
            diagnostics.push(...this._validateSelectStatement(rawSql));
        }

        if (result.type === 'CREATE') {
            diagnostics.push(...this._validateCreateStatement(rawSql));
        }
        if (result.type === 'ALTER') {
            diagnostics.push(...this._validateAlterStatement(rawSql));
        }
        if (result.type === 'DROP') {
            diagnostics.push(...this._validateDropStatement(rawSql));
        }
        if (result.type === 'TRUNCATE') {
            diagnostics.push(...this._validateTruncateStatement(rawSql));
        }
        if (result.type === 'MERGE') {
            diagnostics.push(...this._validateMergeStatement(rawSql));
        }
        if (result.type === 'BEGIN') {
            diagnostics.push(...this._validateBeginStatement(rawSql));
        }
        if (result.type === 'COMMIT') {
            diagnostics.push(...this._validateCommitStatement(rawSql));
        }
        if (result.type === 'ROLLBACK') {
            diagnostics.push(...this._validateRollbackStatement(rawSql));
        }
        if (result.type === 'SAVEPOINT') {
            diagnostics.push(...this._validateSavepointStatement(rawSql));
        }
        if (result.type === 'GRANT') {
            diagnostics.push(...this._validateGrantStatement(rawSql));
        }
        if (result.type === 'REVOKE') {
            diagnostics.push(...this._validateRevokeStatement(rawSql));
        }

        if (result.type === 'INSERT') {
            diagnostics.push(...this._validateInsertStatement(rawSql));
        }

        if (result.type === 'UPDATE') {
            diagnostics.push(...this._validateUpdateStatement(rawSql));
        }

        if (result.type === 'DELETE') {
            diagnostics.push(...this._validateDeleteStatement(rawSql));
        }

        return this._sortDiagnostics(diagnostics);
    }

    _collectDialectCompatibilityDiagnostics(rawSql, result) {
        const diagnostics = [];
        const profile = this._getActiveDialectProfile();

        const hasLimitClause = result.clauses.includes('LIMIT');
        const hasOffsetClause = result.clauses.includes('OFFSET');
        const hasOrderByClause = result.clauses.includes('ORDER BY');
        const hasFetchKeyword = /\bFETCH\b/i.test(rawSql);
        const fetchMatch = /\bFETCH\s+(FIRST|NEXT)\s+(\d+)\s+ROWS?\s+ONLY\b/i.exec(rawSql);
        const hasTopKeyword = /\bSELECT\s+TOP\s+\d+\b/i.test(rawSql);
        const hasInsertReturning = result.type === 'INSERT' && /\bRETURNING\b/i.test(rawSql);

        if (!profile.supportsLimit && hasLimitClause) {
            diagnostics.push(this._createDiagnostic(rawSql, {
                message: `Syntaxfehler im Dialekt ${profile.label}: LIMIT wird nicht unterstuetzt.`,
                severity: 'error',
                sqlstate: '42601',
                index: this._findKeywordIndex(rawSql, /\bLIMIT\b/i),
                hint: profile.label === 'SQL Server'
                    ? 'TOP (...) oder ORDER BY ... OFFSET ... FETCH NEXT ... verwenden.'
                    : 'FETCH FIRST ... ROWS ONLY oder dialektkonforme Paginierung verwenden.'
            }));
        }

        if (!profile.supportsTop && hasTopKeyword) {
            diagnostics.push(this._createDiagnostic(rawSql, {
                message: `Syntaxfehler im Dialekt ${profile.label}: TOP wird nicht unterstuetzt.`,
                severity: 'error',
                sqlstate: '42601',
                index: this._findKeywordIndex(rawSql, /\bTOP\b/i),
                hint: 'LIMIT/OFFSET oder FETCH FIRST je nach Dialekt verwenden.'
            }));
        }

        if (!profile.supportsInsertReturning && hasInsertReturning) {
            diagnostics.push(this._createDiagnostic(rawSql, {
                message: `Syntaxfehler im Dialekt ${profile.label}: INSERT ... RETURNING wird nicht unterstuetzt.`,
                severity: 'error',
                sqlstate: '42601',
                index: this._findKeywordIndex(rawSql, /\bRETURNING\b/i),
                hint: profile.label === 'SQL Server'
                    ? 'Statt RETURNING die OUTPUT-Klausel nutzen.'
                    : 'Dialektkonforme Rueckgabe-Syntax verwenden.'
            }));
        }

        if (profile.requiresOrderByForOffset && hasOffsetClause && !hasOrderByClause) {
            diagnostics.push(this._createDiagnostic(rawSql, {
                message: `Syntaxfehler im Dialekt ${profile.label}: OFFSET erfordert ORDER BY.`,
                severity: 'error',
                sqlstate: '42601',
                index: this._findKeywordIndex(rawSql, /\bOFFSET\b/i),
                hint: 'ORDER BY ergaenzen (z. B. ORDER BY id OFFSET ...).'
            }));
        }

        if (hasFetchKeyword && !profile.supportsFetch) {
            diagnostics.push(this._createDiagnostic(rawSql, {
                message: `Syntaxfehler im Dialekt ${profile.label}: FETCH wird nicht unterstuetzt.`,
                severity: 'error',
                sqlstate: '42601',
                index: this._findKeywordIndex(rawSql, /\bFETCH\b/i),
                hint: 'LIMIT/OFFSET oder dialektkonforme Pagination verwenden.'
            }));
            return diagnostics;
        }

        if (hasFetchKeyword && !fetchMatch) {
            diagnostics.push(this._createDiagnostic(rawSql, {
                message: 'Syntaxfehler in FETCH-Klausel.',
                severity: 'error',
                sqlstate: '42601',
                index: this._findKeywordIndex(rawSql, /\bFETCH\b/i),
                hint: 'Erwartet: FETCH FIRST|NEXT <n> ROWS ONLY.'
            }));
        }

        if (hasFetchKeyword && profile.fetchNextOnly && fetchMatch && String(fetchMatch[1]).toUpperCase() !== 'NEXT') {
            diagnostics.push(this._createDiagnostic(rawSql, {
                message: `Syntaxfehler im Dialekt ${profile.label}: FETCH FIRST wird nicht unterstuetzt.`,
                severity: 'error',
                sqlstate: '42601',
                index: this._findKeywordIndex(rawSql, /\bFETCH\s+FIRST\b/i),
                hint: 'FETCH NEXT <n> ROWS ONLY verwenden.'
            }));
        }

        if (hasFetchKeyword && profile.fetchRequiresOffset && !hasOffsetClause) {
            diagnostics.push(this._createDiagnostic(rawSql, {
                message: `Syntaxfehler im Dialekt ${profile.label}: FETCH erfordert OFFSET.`,
                severity: 'error',
                sqlstate: '42601',
                index: this._findKeywordIndex(rawSql, /\bFETCH\b/i),
                hint: 'OFFSET <n> ROWS vor FETCH NEXT ... ROWS ONLY angeben.'
            }));
        }

        if (hasFetchKeyword && profile.requiresOrderByForOffset && !hasOrderByClause) {
            diagnostics.push(this._createDiagnostic(rawSql, {
                message: `Syntaxfehler im Dialekt ${profile.label}: FETCH/OFFSET erfordert ORDER BY.`,
                severity: 'error',
                sqlstate: '42601',
                index: this._findKeywordIndex(rawSql, /\bFETCH\b/i),
                hint: 'ORDER BY ergaenzen (z. B. ORDER BY id OFFSET ... FETCH ...).'
            }));
        }

        return diagnostics;
    }

    _validateSelectStatement(sql) {
        const diagnostics = [];
        const selectIndex = this._findKeywordIndex(sql, /\bSELECT\b/i);
        if (selectIndex < 0 && !/^\s*WITH\b/i.test(sql)) return diagnostics;

        const withInfo = this._parseWithClause(sql);
        const cteNames = withInfo && !withInfo.error ? withInfo.cteNames : [];
        const mainSql = withInfo && !withInfo.error ? withInfo.body : String(sql || '');
        const profile = this._getActiveDialectProfile();

        if (withInfo && withInfo.error) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: withInfo.error.message,
                severity: 'error',
                sqlstate: '42601',
                index: withInfo.error.index,
                hint: withInfo.error.hint
            }));
            return diagnostics;
        }

        if (cteNames.length > 0) {
            const seen = new Set();
            cteNames.forEach((cteName) => {
                if (!seen.has(cteName)) {
                    seen.add(cteName);
                    return;
                }
                diagnostics.push(this._createDiagnostic(sql, {
                    message: `CTE-Name "${cteName}" ist doppelt definiert.`,
                    severity: 'error',
                    sqlstate: '42701',
                    index: this._findKeywordIndex(sql, new RegExp(`\\b${this._escapeRegex(cteName)}\\b`, 'i')),
                    length: cteName.length,
                    hint: 'Jeder CTE-Name darf in einer WITH-Klausel nur einmal vorkommen.'
                }));
            });
        }

        if (withInfo && withInfo.isRecursive) {
            if (!profile.supportsRecursiveKeyword) {
                diagnostics.push(this._createDiagnostic(sql, {
                    message: `Syntaxfehler im Dialekt ${profile.label}: WITH RECURSIVE wird nicht unterstuetzt.`,
                    severity: 'error',
                    sqlstate: '42601',
                    index: this._findKeywordIndex(sql, /\bRECURSIVE\b/i),
                    hint: profile.label === 'SQL Server'
                        ? 'Rekursive CTE im SQL-Server-Stil ohne RECURSIVE formulieren.'
                        : 'Dialektkonforme CTE-Syntax ohne RECURSIVE verwenden.'
                }));
            }

            let recursiveRefCount = 0;
            (withInfo.ctes || []).forEach((cte) => {
                if (!/\bSELECT\b/i.test(cte.query)) {
                    diagnostics.push(this._createDiagnostic(sql, {
                        message: `Syntaxfehler in rekursiver CTE "${cte.name}": SELECT-Query erwartet.`,
                        severity: 'error',
                        sqlstate: '42601',
                        index: cte.queryStart,
                        hint: 'CTE muss eine gueltige SELECT-Definition enthalten.'
                    }));
                    return;
                }

                const selfRef = this._hasRecursiveSelfReference(cte.query, cte.name);
                if (!selfRef) return;

                recursiveRefCount++;
                if (!/\bUNION(?:\s+ALL)?\b/i.test(cte.query)) {
                    diagnostics.push(this._createDiagnostic(sql, {
                        message: `Rekursive CTE "${cte.name}" benoetigt UNION oder UNION ALL zwischen Anker- und Rekursionsteil.`,
                        severity: 'error',
                        sqlstate: '42601',
                        index: cte.queryStart,
                        hint: 'Muster: SELECT ... UNION ALL SELECT ... FROM cte_name ...'
                    }));
                }
            });

            if (recursiveRefCount === 0) {
                diagnostics.push(this._createDiagnostic(sql, {
                    message: 'Semantik-Hinweis: WITH RECURSIVE ohne Selbstreferenz in den CTE-Definitionen.',
                    severity: 'warning',
                    sqlstate: '01000',
                    index: this._findKeywordIndex(sql, /\bRECURSIVE\b/i),
                    hint: 'Mindestens eine CTE sollte sich fuer echte Rekursion selbst referenzieren.'
                }));
            }
        }

        if (!/\bFROM\b/i.test(mainSql)) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: 'Syntaxfehler: SELECT benoetigt eine FROM-Klausel.',
                severity: 'error',
                sqlstate: '42601',
                index: this._findKeywordIndex(sql, /\bSELECT\b/i),
                hint: 'Beispiel: SELECT a FROM t;'
            }));
        }

        const split = this._splitTopLevelSetParts(mainSql, withInfo && !withInfo.error ? withInfo.bodyStart : 0);
        split.parts.forEach((partSql, index) => {
            const trimmed = String(partSql || '').trim();
            if (trimmed) {
                if (!/\bSELECT\b/i.test(trimmed)) {
                    const op = split.operators[Math.max(0, index - 1)];
                    diagnostics.push(this._createDiagnostic(sql, {
                        message: `Syntaxfehler: ${op?.token || 'Set-Operation'} erwartet rechts eine SELECT-Query.`,
                        severity: 'error',
                        sqlstate: '42601',
                        index: op ? op.index : this._findKeywordIndex(sql, /\b(UNION|INTERSECT|EXCEPT)\b/i),
                        length: op?.length || 5,
                        hint: 'Beide Seiten einer Set-Operation muessen vollstaendige SELECT-Queries sein.'
                    }));
                }
                return;
            }

            const op = split.operators[Math.max(0, index - 1)];
            diagnostics.push(this._createDiagnostic(sql, {
                message: `Syntaxfehler: ${op?.token || 'Set-Operation'} ohne rechte Query.`,
                severity: 'error',
                sqlstate: '42601',
                index: op ? op.index : this._findKeywordIndex(sql, /\b(UNION|INTERSECT|EXCEPT)\b/i),
                length: op?.length || 5,
                hint: 'Nach UNION/INTERSECT/EXCEPT eine weitere SELECT-Query angeben.'
            }));
        });

        const existsSegments = this._collectKeywordParenthesizedSegments(sql, 'EXISTS');
        existsSegments.forEach((segment) => {
            if (!segment.content) {
                diagnostics.push(this._createDiagnostic(sql, {
                    message: 'Syntaxfehler: EXISTS erwartet eine Subquery in Klammern.',
                    severity: 'error',
                    sqlstate: '42601',
                    index: segment.keywordIndex,
                    length: 6,
                    hint: 'Beispiel: EXISTS (SELECT 1 FROM t WHERE ...)'
                }));
                return;
            }

            if (!/^(WITH\b[\s\S]*SELECT\b|SELECT\b)/i.test(segment.content)) {
                diagnostics.push(this._createDiagnostic(sql, {
                    message: 'Syntaxfehler: EXISTS erwartet eine SELECT-Subquery.',
                    severity: 'error',
                    sqlstate: '42601',
                    index: segment.keywordIndex,
                    length: 6,
                    hint: 'EXISTS darf nur mit einer SELECT-Subquery verwendet werden.'
                }));
            }
        });

        const inSegments = this._collectKeywordParenthesizedSegments(sql, '(?:NOT\\s+)?IN');
        inSegments.forEach((segment) => {
            if (!segment.content) {
                diagnostics.push(this._createDiagnostic(sql, {
                    message: 'Syntaxfehler: IN erwartet eine Werteliste oder Subquery.',
                    severity: 'error',
                    sqlstate: '42601',
                    index: segment.keywordIndex,
                    length: 2,
                    hint: 'Beispiel: col IN (1,2,3) oder col IN (SELECT id FROM t)'
                }));
                return;
            }

            const isSubquery = /^(WITH\b[\s\S]*SELECT\b|SELECT\b)/i.test(segment.content);
            if (!isSubquery) return;

            const projectionItems = this._extractSelectProjectionItems(segment.content);
            if (!projectionItems || projectionItems.length !== 1 || projectionItems[0] === '*') {
                diagnostics.push(this._createDiagnostic(sql, {
                    message: 'Semantikfehler: Subquery in IN muss genau eine Spalte liefern.',
                    severity: 'error',
                    sqlstate: '42601',
                    index: segment.keywordIndex,
                    length: 2,
                    hint: 'Nur eine Projektion in der IN-Subquery verwenden (z. B. SELECT id ...).'
                }));
            }
        });

        const referencedTables = this._extractTables(sql, { ignoreNames: cteNames });
        referencedTables.forEach((tableName) => {
            const existsAsTable = this._tableExists(tableName);
            const existsAsView = this._objectExists('VIEW', tableName);
            if (existsAsTable || existsAsView) return;

            diagnostics.push(this._createDiagnostic(sql, {
                message: `Objekt nicht gefunden: Relation "${tableName}" existiert nicht.`,
                severity: 'error',
                sqlstate: '42P01',
                index: this._findKeywordIndex(sql, new RegExp(`\\b${this._escapeRegex(tableName)}\\b`, 'i')),
                length: tableName.length,
                hint: 'Existierende Tabelle/View verwenden oder CTE korrekt definieren.'
            }));
        });

        return diagnostics;
    }

    _validateCreateStatement(sql) {
        const objectType = this._detectCreateObjectType(sql);
        if (!objectType) {
            return [this._createDiagnostic(sql, {
                message: 'Syntaxfehler in CREATE-Anweisung.',
                severity: 'error',
                sqlstate: '42601',
                index: this._findKeywordIndex(sql, /\bCREATE\b/i),
                hint: 'Erwartet: CREATE TABLE|VIEW|INDEX|SCHEMA|SEQUENCE ...'
            })];
        }

        if (objectType === 'TABLE') return this._validateCreateTableStatement(sql);
        if (objectType === 'VIEW') return this._validateCreateViewStatement(sql);
        if (objectType === 'INDEX') return this._validateCreateIndexStatement(sql);
        if (objectType === 'SCHEMA') return this._validateCreateSchemaStatement(sql);
        if (objectType === 'SEQUENCE') return this._validateCreateSequenceStatement(sql);
        return [];
    }

    _validateCreateTableStatement(sql) {
        const diagnostics = [];
        const profile = this._getActiveDialectProfile();
        const createIndex = this._findKeywordIndex(sql, /\bCREATE\s+TABLE\b/i);
        if (createIndex < 0) return diagnostics;

        const tableMatch = /\bCREATE\s+TABLE\s+([a-zA-Z_]\w*)/i.exec(sql);
        if (!tableMatch) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: 'Syntaxfehler: Tabellenname nach CREATE TABLE erwartet.',
                severity: 'error',
                sqlstate: '42601',
                index: createIndex,
                hint: 'Beispiel: CREATE TABLE y (a INTEGER);'
            }));
            return diagnostics;
        }

        const tableName = tableMatch[1].toLowerCase();
        const tableNameIndex = tableMatch.index + tableMatch[0].lastIndexOf(tableMatch[1]);

        if (this._tableExists(tableName)) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: `Objektkonflikt: Tabelle "${tableName}" existiert bereits.`,
                severity: 'error',
                sqlstate: '42P07',
                index: tableNameIndex,
                length: tableName.length,
                hint: 'Anderen Namen waehlen oder DROP TABLE verwenden.'
            }));
        }

        const openParenIndex = sql.indexOf('(', tableNameIndex + tableName.length);
        if (openParenIndex === -1) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: 'Syntaxfehler: "(" nach Tabellenname erwartet.',
                severity: 'error',
                sqlstate: '42601',
                index: tableNameIndex + tableName.length,
                hint: 'Spaltendefinitionen in Klammern angeben.'
            }));
            return diagnostics;
        }

        const closeParenIndex = this._findClosingParen(sql, openParenIndex);
        if (closeParenIndex === -1) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: 'Syntaxfehler: schliessende ")" fuer Spaltendefinition fehlt.',
                severity: 'error',
                sqlstate: '42601',
                index: openParenIndex,
                hint: 'Klammerpaare in der CREATE TABLE Definition pruefen.'
            }));
            return diagnostics;
        }

        const definitions = this._splitSqlListWithPositions(
            sql.slice(openParenIndex + 1, closeParenIndex),
            openParenIndex + 1
        );

        if (definitions.length === 0) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: 'CREATE TABLE benoetigt mindestens eine Spalte.',
                severity: 'error',
                sqlstate: '42601',
                index: openParenIndex + 1,
                hint: 'Mindestens eine Spaltendefinition angeben.'
            }));
            return diagnostics;
        }

        const seenColumns = new Set();

        definitions.forEach((def) => {
            const parsed = this._parseCreateColumnWithPosition(def.text, def.start, sql);
            if (!parsed || parsed.diagnostic) {
                if (parsed && parsed.diagnostic) diagnostics.push(parsed.diagnostic);
                return;
            }

            const nameKey = parsed.column.name.toLowerCase();
            if (seenColumns.has(nameKey)) {
                diagnostics.push(this._createDiagnostic(sql, {
                    message: `Doppelte Spaltendefinition: "${parsed.column.name}".`,
                    severity: 'error',
                    sqlstate: '42701',
                    index: parsed.nameIndex,
                    length: parsed.column.name.length,
                    hint: 'Jede Spalte darf nur einmal definiert werden.'
                }));
            } else {
                seenColumns.add(nameKey);
            }

            if (!profile.allowedTypes.has(parsed.baseType)) {
                diagnostics.push(this._createDiagnostic(sql, {
                    message: `Ungueltiger oder im Dialekt ${profile.label} nicht unterstuetzter Datentyp: ${parsed.column.type}.`,
                    severity: 'error',
                    sqlstate: '42704',
                    index: parsed.typeIndex,
                    length: parsed.column.type.length,
                    hint: 'Gueltigen SQL-Datentyp verwenden (z.B. INTEGER, TEXT, VARCHAR).'
                }));
            }
        });

        return diagnostics;
    }

    _validateCreateViewStatement(sql) {
        const diagnostics = [];
        const createIndex = this._findKeywordIndex(sql, /\bCREATE\s+(?:OR\s+REPLACE\s+)?VIEW\b/i);
        if (createIndex < 0) return diagnostics;

        const viewMatch = /\bCREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+([a-zA-Z_]\w*)\s+AS\s+([\s\S]+?)\s*;?\s*$/i.exec(sql);
        if (!viewMatch) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: 'Syntaxfehler in CREATE VIEW-Anweisung.',
                severity: 'error',
                sqlstate: '42601',
                index: createIndex,
                hint: 'Erwartet: CREATE VIEW name AS SELECT ...;'
            }));
            return diagnostics;
        }

        const viewName = viewMatch[1].toLowerCase();
        const viewNameIndex = viewMatch.index + viewMatch[0].lastIndexOf(viewMatch[1]);
        if (this._objectExists('VIEW', viewName)) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: `Objektkonflikt: View "${viewName}" existiert bereits.`,
                severity: 'error',
                sqlstate: '42P07',
                index: viewNameIndex,
                length: viewName.length,
                hint: 'Anderen Namen waehlen oder DROP VIEW verwenden.'
            }));
        }

        const query = viewMatch[2].trim();
        if (!/\bSELECT\b/i.test(query)) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: 'Semantikfehler: CREATE VIEW erwartet SELECT-Query nach AS.',
                severity: 'error',
                sqlstate: '42601',
                index: viewMatch.index + viewMatch[0].toUpperCase().indexOf('AS') + 2,
                hint: 'Beispiel: CREATE VIEW v AS SELECT ... FROM ...;'
            }));
            return diagnostics;
        }

        const sourceTables = this._extractTables(query);
        sourceTables.forEach((tableName) => {
            if (!this._tableExists(tableName)) {
                const tableRegex = new RegExp(`\\b${tableName}\\b`, 'i');
                diagnostics.push(this._createDiagnostic(sql, {
                    message: `Objekt nicht gefunden: Quelltabelle "${tableName}" fuer VIEW existiert nicht.`,
                    severity: 'error',
                    sqlstate: '42P01',
                    index: this._findKeywordIndex(sql, tableRegex),
                    length: tableName.length,
                    hint: 'Nur existierende Tabellen in der VIEW-Definition referenzieren.'
                }));
            }
        });

        return diagnostics;
    }

    _validateCreateIndexStatement(sql) {
        const diagnostics = [];
        const createIndex = this._findKeywordIndex(sql, /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i);
        if (createIndex < 0) return diagnostics;

        const match = /\bCREATE\s+(UNIQUE\s+)?INDEX\s+([a-zA-Z_]\w*)\s+ON\s+([a-zA-Z_]\w*)\s*\(([^)]+)\)\s*;?\s*$/i.exec(sql);
        if (!match) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: 'Syntaxfehler in CREATE INDEX-Anweisung.',
                severity: 'error',
                sqlstate: '42601',
                index: createIndex,
                hint: 'Erwartet: CREATE [UNIQUE] INDEX idx ON t (c1, c2);'
            }));
            return diagnostics;
        }

        const indexName = match[2].toLowerCase();
        const tableName = match[3].toLowerCase();
        const indexNamePos = match.index + match[0].toLowerCase().indexOf(indexName);
        const tableNamePos = match.index + match[0].toLowerCase().indexOf(tableName);

        if (this._objectExists('INDEX', indexName)) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: `Objektkonflikt: Index "${indexName}" existiert bereits.`,
                severity: 'error',
                sqlstate: '42P07',
                index: indexNamePos,
                length: indexName.length,
                hint: 'Anderen Indexnamen waehlen oder DROP INDEX verwenden.'
            }));
        }

        if (!this._tableExists(tableName)) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: `Objekt nicht gefunden: Tabelle "${tableName}" fuer INDEX existiert nicht.`,
                severity: 'error',
                sqlstate: '42P01',
                index: tableNamePos,
                length: tableName.length,
                hint: 'Existierende Tabelle im ON-Teil angeben.'
            }));
            return diagnostics;
        }

        const indexedColumns = this._splitSqlList(match[4]).map((entry) => entry.trim().split(/\s+/)[0]).filter(Boolean);
        const knownColumns = this._getTableColumnNames(tableName);
        if (knownColumns.length > 0) {
            indexedColumns.forEach((columnName) => {
                const normalizedColumn = columnName.toLowerCase();
                if (!knownColumns.includes(normalizedColumn)) {
                    const columnRegex = new RegExp(`\\b${columnName}\\b`, 'i');
                    diagnostics.push(this._createDiagnostic(sql, {
                        message: `Objekt nicht gefunden: Spalte "${columnName}" existiert in Tabelle "${tableName}" nicht.`,
                        severity: 'error',
                        sqlstate: '42703',
                        index: this._findKeywordIndex(sql, columnRegex),
                        length: columnName.length,
                        hint: 'Nur vorhandene Spalten im INDEX verwenden.'
                    }));
                }
            });
        }

        return diagnostics;
    }

    _validateCreateSchemaStatement(sql) {
        const diagnostics = [];
        const createIndex = this._findKeywordIndex(sql, /\bCREATE\s+SCHEMA\b/i);
        if (createIndex < 0) return diagnostics;

        const match = /\bCREATE\s+SCHEMA\s+([a-zA-Z_]\w*)\b/i.exec(sql);
        if (!match) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: 'Syntaxfehler in CREATE SCHEMA-Anweisung.',
                severity: 'error',
                sqlstate: '42601',
                index: createIndex,
                hint: 'Erwartet: CREATE SCHEMA name;'
            }));
            return diagnostics;
        }

        const schemaName = match[1].toLowerCase();
        const schemaNamePos = match.index + match[0].lastIndexOf(match[1]);
        if (this._objectExists('SCHEMA', schemaName)) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: `Objektkonflikt: Schema "${schemaName}" existiert bereits.`,
                severity: 'error',
                sqlstate: '42P06',
                index: schemaNamePos,
                length: schemaName.length,
                hint: 'Anderen Schemanamen waehlen oder DROP SCHEMA verwenden.'
            }));
        }

        return diagnostics;
    }

    _validateCreateSequenceStatement(sql) {
        const diagnostics = [];
        const createIndex = this._findKeywordIndex(sql, /\bCREATE\s+SEQUENCE\b/i);
        if (createIndex < 0) return diagnostics;

        const match = /\bCREATE\s+SEQUENCE\s+([a-zA-Z_]\w*)\b/i.exec(sql);
        if (!match) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: 'Syntaxfehler in CREATE SEQUENCE-Anweisung.',
                severity: 'error',
                sqlstate: '42601',
                index: createIndex,
                hint: 'Erwartet: CREATE SEQUENCE name;'
            }));
            return diagnostics;
        }

        const sequenceName = match[1].toLowerCase();
        const seqNamePos = match.index + match[0].lastIndexOf(match[1]);
        if (this._objectExists('SEQUENCE', sequenceName)) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: `Objektkonflikt: Sequence "${sequenceName}" existiert bereits.`,
                severity: 'error',
                sqlstate: '42P07',
                index: seqNamePos,
                length: sequenceName.length,
                hint: 'Anderen Sequenznamen waehlen oder DROP SEQUENCE verwenden.'
            }));
        }

        return diagnostics;
    }

    _validateInsertStatement(sql) {
        const diagnostics = [];
        const insertIndex = this._findKeywordIndex(sql, /\bINSERT\b/i);
        if (insertIndex < 0) return diagnostics;

        const parsed = this._parseInsertStatement(sql);
        if (!parsed) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: 'Syntaxfehler in INSERT-Anweisung.',
                severity: 'error',
                sqlstate: '42601',
                index: insertIndex,
                hint: 'Erwartet: INSERT INTO t (c1, c2) VALUES (v1, v2), (v3, v4) [RETURNING ...];'
            }));
            return diagnostics;
        }

        if (!this._tableExists(parsed.table)) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: `Objekt nicht gefunden: Tabelle "${parsed.table}" existiert nicht.`,
                severity: 'error',
                sqlstate: '42P01',
                index: this._findKeywordIndex(sql, new RegExp(`\\b${parsed.table}\\b`, 'i')),
                length: parsed.table.length,
                hint: 'Existierende Tabelle verwenden oder zuerst CREATE TABLE ausfuehren.'
            }));
            return diagnostics;
        }

        const knownColumns = this._getTableColumnNames(parsed.table);
        const effectiveColumns = parsed.columns.length > 0 ? parsed.columns : knownColumns;

        if (parsed.columns.length > 0 && knownColumns.length > 0) {
            parsed.columns.forEach((columnName) => {
                if (!knownColumns.includes(columnName)) {
                    diagnostics.push(this._createDiagnostic(sql, {
                        message: `Objekt nicht gefunden: Spalte "${columnName}" existiert in Tabelle "${parsed.table}" nicht.`,
                        severity: 'error',
                        sqlstate: '42703',
                        index: this._findKeywordIndex(sql, new RegExp(`\\b${columnName}\\b`, 'i')),
                        length: columnName.length,
                        hint: 'Nur vorhandene Spalten in der INSERT-Spaltenliste verwenden.'
                    }));
                }
            });
        }

        if (effectiveColumns.length > 0) {
            parsed.rows.forEach((row, rowIdx) => {
                if (row.length !== effectiveColumns.length) {
                    diagnostics.push(this._createDiagnostic(sql, {
                        message: `Wertanzahl passt nicht zur Spaltenanzahl in VALUES-Tuple ${rowIdx + 1}.`,
                        severity: 'error',
                        sqlstate: '42601',
                        index: insertIndex,
                        hint: 'Jedes VALUES-Tuple muss genau so viele Werte wie die Zielspalten enthalten.'
                    }));
                }
            });
        }

        if (knownColumns.length > 0 && parsed.returning.length > 0 && !parsed.returning.includes('*')) {
            parsed.returning.forEach((columnName) => {
                if (!knownColumns.includes(columnName)) {
                    diagnostics.push(this._createDiagnostic(sql, {
                        message: `RETURNING-Spalte "${columnName}" existiert in Tabelle "${parsed.table}" nicht.`,
                        severity: 'error',
                        sqlstate: '42703',
                        index: this._findKeywordIndex(sql, new RegExp(`\\b${columnName}\\b`, 'i')),
                        length: columnName.length,
                        hint: 'Nur vorhandene Spalten in RETURNING verwenden.'
                    }));
                }
            });
        }

        if (knownColumns.length > 0) {
            const targetColumns = parsed.columns.length > 0 ? parsed.columns : knownColumns;
            const newRows = parsed.rows.map((values) => this._buildRowRecordForInsert(knownColumns, targetColumns, values));
            const existingRows = this._getTableRowRecords(parsed.table);
            diagnostics.push(...this._collectConstraintDiagnosticsForRows(sql, parsed.table, [...existingRows, ...newRows]));
        }

        return diagnostics;
    }

    _validateUpdateStatement(sql) {
        const diagnostics = [];
        const updateIndex = this._findKeywordIndex(sql, /\bUPDATE\b/i);
        if (updateIndex < 0) return diagnostics;

        const parsed = this._parseUpdateStatement(sql);
        if (!parsed) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: 'Syntaxfehler in UPDATE-Anweisung.',
                severity: 'error',
                sqlstate: '42601',
                index: updateIndex,
                hint: 'Erwartet: UPDATE t SET c = v [, c2 = v2] [WHERE ...];'
            }));
            return diagnostics;
        }

        if (!this._tableExists(parsed.table)) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: `Objekt nicht gefunden: Tabelle "${parsed.table}" existiert nicht.`,
                severity: 'error',
                sqlstate: '42P01',
                index: this._findKeywordIndex(sql, new RegExp(`\\b${this._escapeRegex(parsed.table)}\\b`, 'i')),
                length: parsed.table.length,
                hint: 'Existierende Tabelle verwenden oder zuerst CREATE TABLE ausfuehren.'
            }));
            return diagnostics;
        }

        const knownColumns = this._getTableColumnNames(parsed.table);
        if (knownColumns.length > 0) {
            parsed.assignments.forEach((assignment) => {
                if (!knownColumns.includes(assignment.col)) {
                    diagnostics.push(this._createDiagnostic(sql, {
                        message: `Objekt nicht gefunden: Spalte "${assignment.col}" existiert in Tabelle "${parsed.table}" nicht.`,
                        severity: 'error',
                        sqlstate: '42703',
                        index: this._findKeywordIndex(sql, new RegExp(`\\b${this._escapeRegex(assignment.col)}\\b`, 'i')),
                        length: assignment.col.length,
                        hint: 'Nur vorhandene Spalten in SET verwenden.'
                    }));
                }
            });

            this._extractConditionColumns(parsed.condition).forEach((conditionColumn) => {
                if (!knownColumns.includes(conditionColumn)) {
                    diagnostics.push(this._createDiagnostic(sql, {
                        message: `Objekt nicht gefunden: Spalte "${conditionColumn}" existiert in Tabelle "${parsed.table}" nicht.`,
                        severity: 'error',
                        sqlstate: '42703',
                        index: this._findKeywordIndex(sql, new RegExp(`\\b${this._escapeRegex(conditionColumn)}\\b`, 'i')),
                        length: conditionColumn.length,
                        hint: 'Nur vorhandene Spalten in WHERE verwenden.'
                    }));
                }
            });

            const existingRows = this._getTableRowRecords(parsed.table);
            const nextRows = existingRows.map((row) => ({ ...row }));
            const matchedIndices = this._findMatchingRowIndicesFromRecords(nextRows, parsed.condition, 'UPDATE');
            matchedIndices.forEach((rowIndex) => {
                parsed.assignments.forEach((assignment) => {
                    nextRows[rowIndex][assignment.col] = assignment.val;
                });
            });
            diagnostics.push(...this._collectConstraintDiagnosticsForRows(sql, parsed.table, nextRows));
        }

        return diagnostics;
    }

    _validateDeleteStatement(sql) {
        const diagnostics = [];
        const deleteIndex = this._findKeywordIndex(sql, /\bDELETE\b/i);
        if (deleteIndex < 0) return diagnostics;

        const parsed = this._parseDeleteStatement(sql);
        if (!parsed) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: 'Syntaxfehler in DELETE-Anweisung.',
                severity: 'error',
                sqlstate: '42601',
                index: deleteIndex,
                hint: 'Erwartet: DELETE FROM t [WHERE ...];'
            }));
            return diagnostics;
        }

        if (!this._tableExists(parsed.table)) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: `Objekt nicht gefunden: Tabelle "${parsed.table}" existiert nicht.`,
                severity: 'error',
                sqlstate: '42P01',
                index: this._findKeywordIndex(sql, new RegExp(`\\b${this._escapeRegex(parsed.table)}\\b`, 'i')),
                length: parsed.table.length,
                hint: 'Existierende Tabelle verwenden oder zuerst CREATE TABLE ausfuehren.'
            }));
            return diagnostics;
        }

        const knownColumns = this._getTableColumnNames(parsed.table);
        if (knownColumns.length > 0) {
            this._extractConditionColumns(parsed.condition).forEach((conditionColumn) => {
                if (!knownColumns.includes(conditionColumn)) {
                    diagnostics.push(this._createDiagnostic(sql, {
                        message: `Objekt nicht gefunden: Spalte "${conditionColumn}" existiert in Tabelle "${parsed.table}" nicht.`,
                        severity: 'error',
                        sqlstate: '42703',
                        index: this._findKeywordIndex(sql, new RegExp(`\\b${this._escapeRegex(conditionColumn)}\\b`, 'i')),
                        length: conditionColumn.length,
                        hint: 'Nur vorhandene Spalten in WHERE verwenden.'
                    }));
                }
            });
        }

        return diagnostics;
    }

    _validateAlterStatement(sql) {
        const diagnostics = [];
        const alterIndex = this._findKeywordIndex(sql, /\bALTER\s+TABLE\b/i);
        if (alterIndex < 0) return diagnostics;

        const tableMatch = /\bALTER\s+TABLE\s+([a-zA-Z_]\w*)\b/i.exec(sql);
        if (!tableMatch) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: 'Syntaxfehler: Tabellenname nach ALTER TABLE erwartet.',
                severity: 'error',
                sqlstate: '42601',
                index: alterIndex,
                hint: 'Beispiel: ALTER TABLE y ADD c INTEGER;'
            }));
            return diagnostics;
        }

        const tableName = tableMatch[1].toLowerCase();
        const operationPart = sql.slice(tableMatch.index + tableMatch[0].length).trim();
        const opMatch = operationPart.match(/^(ADD|DROP|ALTER|RENAME)\b/i);
        if (!opMatch) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: `Syntaxfehler in ALTER TABLE ${tableName}: gueltige Operation fehlt (ADD/DROP/ALTER/RENAME).`,
                severity: 'error',
                sqlstate: '42601',
                index: tableMatch.index + tableMatch[0].length,
                hint: 'Operation nach Tabellenname ergaenzen.'
            }));
            return diagnostics;
        }

        if (!this._tableExists(tableName)) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: `Objekt nicht gefunden: Tabelle "${tableName}" existiert nicht.`,
                severity: 'error',
                sqlstate: '42P01',
                index: tableMatch.index + tableMatch[0].lastIndexOf(tableMatch[1]),
                length: tableMatch[1].length,
                hint: 'Existierende Tabelle verwenden oder zuerst CREATE TABLE ausfuehren.'
            }));
        }

        return diagnostics;
    }

    _validateDropStatement(sql) {
        const diagnostics = [];
        const dropIndex = this._findKeywordIndex(sql, /\bDROP\b/i);
        if (dropIndex < 0) return diagnostics;

        const match = /\bDROP\s+(TABLE|VIEW|INDEX|SCHEMA|SEQUENCE)\s+(IF\s+EXISTS\s+)?([a-zA-Z_]\w*)\b/i.exec(sql);
        if (!match) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: 'Syntaxfehler in DROP-Anweisung.',
                severity: 'error',
                sqlstate: '42601',
                index: dropIndex,
                hint: 'Erwartet: DROP TABLE|VIEW|INDEX|SCHEMA|SEQUENCE [IF EXISTS] name;'
            }));
            return diagnostics;
        }

        const objectType = match[1].toUpperCase();
        const ifExists = Boolean(match[2]);
        const objectName = match[3].toLowerCase();

        if (!ifExists && !this._objectExists(objectType, objectName)) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: `Objekt nicht gefunden: ${objectType} "${objectName}" existiert nicht.`,
                severity: 'error',
                sqlstate: '42P01',
                index: match.index + match[0].lastIndexOf(match[3]),
                length: match[3].length,
                hint: 'IF EXISTS verwenden oder existierenden Objektnamen angeben.'
            }));
        }

        return diagnostics;
    }

    _validateTruncateStatement(sql) {
        const diagnostics = [];
        const truncateIndex = this._findKeywordIndex(sql, /\bTRUNCATE\b/i);
        if (truncateIndex < 0) return diagnostics;

        const match = /\bTRUNCATE\s+TABLE\s+([a-zA-Z_]\w*)\b/i.exec(sql);
        if (!match) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: 'Syntaxfehler in TRUNCATE-Anweisung.',
                severity: 'error',
                sqlstate: '42601',
                index: truncateIndex,
                hint: 'Erwartet: TRUNCATE TABLE name;'
            }));
            return diagnostics;
        }

        const tableName = match[1].toLowerCase();
        if (!this._tableExists(tableName)) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: `Objekt nicht gefunden: Tabelle "${tableName}" existiert nicht.`,
                severity: 'error',
                sqlstate: '42P01',
                index: match.index + match[0].lastIndexOf(match[1]),
                length: match[1].length,
                hint: 'Existierende Tabelle angeben.'
            }));
        }

        return diagnostics;
    }

    _validateMergeStatement(sql) {
        const diagnostics = [];
        const mergeIndex = this._findKeywordIndex(sql, /\bMERGE\b/i);
        if (mergeIndex < 0) return diagnostics;

        const parsed = this._parseMergeStatement(sql);
        if (!parsed) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: 'Syntaxfehler in MERGE-Anweisung.',
                severity: 'error',
                sqlstate: '42601',
                index: mergeIndex,
                hint: 'Erwartet: MERGE INTO target USING source ON t.id = s.id WHEN MATCHED ... WHEN NOT MATCHED ...'
            }));
            return diagnostics;
        }

        if (!this._tableExists(parsed.target)) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: `Objekt nicht gefunden: MERGE-Zieltabelle "${parsed.target}" existiert nicht.`,
                severity: 'error',
                sqlstate: '42P01',
                index: this._findKeywordIndex(sql, new RegExp(`\\b${this._escapeRegex(parsed.target)}\\b`, 'i')),
                length: parsed.target.length,
                hint: 'Zieltabelle zuerst erstellen.'
            }));
        }

        if (!this._tableExists(parsed.source)) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: `Objekt nicht gefunden: MERGE-Quelltabelle "${parsed.source}" existiert nicht.`,
                severity: 'error',
                sqlstate: '42P01',
                index: this._findKeywordIndex(sql, new RegExp(`\\b${this._escapeRegex(parsed.source)}\\b`, 'i')),
                length: parsed.source.length,
                hint: 'Quelltabelle zuerst erstellen.'
            }));
        }

        if (diagnostics.some((entry) => entry.severity === 'error')) {
            return diagnostics;
        }

        const targetColumns = this._getTableColumnNames(parsed.target);
        const sourceColumns = this._getTableColumnNames(parsed.source);
        const targetRefNames = new Set(parsed.targetRefs || []);
        const sourceRefNames = new Set(parsed.sourceRefs || []);

        const pushMissingColumn = (columnName, tableName, hintText) => {
            diagnostics.push(this._createDiagnostic(sql, {
                message: `Objekt nicht gefunden: Spalte "${columnName}" existiert in Tabelle "${tableName}" nicht.`,
                severity: 'error',
                sqlstate: '42703',
                index: this._findKeywordIndex(sql, new RegExp(`\\b${this._escapeRegex(columnName)}\\b`, 'i')),
                length: String(columnName).length,
                hint: hintText
            }));
        };

        if (targetColumns.length > 0 && !targetColumns.includes(parsed.targetKey)) {
            pushMissingColumn(parsed.targetKey, parsed.target, 'ON-Bedingung muss existierende Zielspalte referenzieren.');
        }
        if (sourceColumns.length > 0 && !sourceColumns.includes(parsed.sourceKey)) {
            pushMissingColumn(parsed.sourceKey, parsed.source, 'ON-Bedingung muss existierende Quellspalte referenzieren.');
        }

        parsed.updateAssignments.forEach((assignment) => {
            if (targetColumns.length > 0 && !targetColumns.includes(assignment.col)) {
                pushMissingColumn(assignment.col, parsed.target, 'WHEN MATCHED UPDATE darf nur Zielspalten setzen.');
            }

            this._extractQualifiedColumnRefs(assignment.raw).forEach((ref) => {
                if (targetRefNames.has(ref.alias)) {
                    if (targetColumns.length > 0 && !targetColumns.includes(ref.column)) {
                        pushMissingColumn(ref.column, parsed.target, 'Ausdruck referenziert unbekannte Zielspalte.');
                    }
                } else if (sourceRefNames.has(ref.alias)) {
                    if (sourceColumns.length > 0 && !sourceColumns.includes(ref.column)) {
                        pushMissingColumn(ref.column, parsed.source, 'Ausdruck referenziert unbekannte Quellspalte.');
                    }
                } else {
                    diagnostics.push(this._createDiagnostic(sql, {
                        message: `Unbekannte Tabellenreferenz "${ref.alias}" in MERGE-Ausdruck.`,
                        severity: 'error',
                        sqlstate: '42P01',
                        index: this._findKeywordIndex(sql, new RegExp(`\\b${this._escapeRegex(ref.alias)}\\.${this._escapeRegex(ref.column)}\\b`, 'i')),
                        length: ref.alias.length,
                        hint: 'Nur Ziel- oder Quellalias im MERGE-Ausdruck verwenden.'
                    }));
                }
            });
        });

        if (parsed.insert) {
            const insertColumns = parsed.insert.columns.length > 0 ? parsed.insert.columns : targetColumns;
            if (insertColumns.length > 0 && parsed.insert.values.length !== insertColumns.length) {
                diagnostics.push(this._createDiagnostic(sql, {
                    message: 'Wertanzahl in WHEN NOT MATCHED INSERT passt nicht zur Spaltenanzahl.',
                    severity: 'error',
                    sqlstate: '42601',
                    index: this._findKeywordIndex(sql, /\bWHEN\s+NOT\s+MATCHED\b/i),
                    hint: 'VALUES-Anzahl und INSERT-Spaltenliste angleichen.'
                }));
            }

            if (targetColumns.length > 0) {
                insertColumns.forEach((columnName) => {
                    if (!targetColumns.includes(columnName)) {
                        pushMissingColumn(columnName, parsed.target, 'INSERT-Zielliste darf nur Zieltabellenspalten enthalten.');
                    }
                });
            }

            parsed.insert.values.forEach((expr) => {
                this._extractQualifiedColumnRefs(expr.raw).forEach((ref) => {
                    if (targetRefNames.has(ref.alias)) {
                        if (targetColumns.length > 0 && !targetColumns.includes(ref.column)) {
                            pushMissingColumn(ref.column, parsed.target, 'INSERT-Ausdruck referenziert unbekannte Zielspalte.');
                        }
                    } else if (sourceRefNames.has(ref.alias)) {
                        if (sourceColumns.length > 0 && !sourceColumns.includes(ref.column)) {
                            pushMissingColumn(ref.column, parsed.source, 'INSERT-Ausdruck referenziert unbekannte Quellspalte.');
                        }
                    } else {
                        diagnostics.push(this._createDiagnostic(sql, {
                            message: `Unbekannte Tabellenreferenz "${ref.alias}" in MERGE-INSERT-Ausdruck.`,
                            severity: 'error',
                            sqlstate: '42P01',
                            index: this._findKeywordIndex(sql, new RegExp(`\\b${this._escapeRegex(ref.alias)}\\.${this._escapeRegex(ref.column)}\\b`, 'i')),
                            length: ref.alias.length,
                            hint: 'Nur Ziel- oder Quellalias in INSERT-Werten verwenden.'
                        }));
                    }
                });
            });
        }

        if (!diagnostics.some((entry) => entry.severity === 'error')) {
            const targetRows = this._getTableRowRecords(parsed.target).map((row) => ({ ...row }));
            const sourceRows = this._getTableRowRecords(parsed.source);
            const targetRefNamesForEval = new Set(parsed.targetRefs || []);
            const sourceRefNamesForEval = new Set(parsed.sourceRefs || []);

            sourceRows.forEach((sourceRow) => {
                const matchedIndex = targetRows.findIndex((targetRow) => this._compareSqlValues(
                    targetRow[parsed.targetKey],
                    '=',
                    sourceRow[parsed.sourceKey]
                ));

                if (matchedIndex >= 0) {
                    if (parsed.updateAssignments.length > 0) {
                        const targetRow = targetRows[matchedIndex];
                        parsed.updateAssignments.forEach((assignment) => {
                            targetRow[assignment.col] = this._resolveMergeTokenValue(assignment, {
                                targetRow,
                                sourceRow,
                                targetRefs: targetRefNamesForEval,
                                sourceRefs: sourceRefNamesForEval
                            });
                        });
                    }
                    return;
                }

                if (parsed.insert) {
                    const insertColumns = parsed.insert.columns.length > 0 ? parsed.insert.columns : targetColumns;
                    if (insertColumns.length !== parsed.insert.values.length) return;

                    const nextRow = {};
                    targetColumns.forEach((column) => {
                        nextRow[column] = null;
                    });

                    parsed.insert.values.forEach((valueToken, index) => {
                        nextRow[insertColumns[index]] = this._resolveMergeTokenValue(valueToken, {
                            targetRow: null,
                            sourceRow,
                            targetRefs: targetRefNamesForEval,
                            sourceRefs: sourceRefNamesForEval
                        });
                    });
                    targetRows.push(nextRow);
                }
            });

            diagnostics.push(...this._collectConstraintDiagnosticsForRows(sql, parsed.target, targetRows));
        }

        return diagnostics;
    }

    _validateBeginStatement(sql) {
        const diagnostics = [];
        const beginIndex = this._findKeywordIndex(sql, /\bBEGIN\b/i);
        if (beginIndex < 0) return diagnostics;

        if (!/^\s*BEGIN(?:\s+TRANSACTION)?\s*;?\s*$/i.test(sql)) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: 'Syntaxfehler in BEGIN-Anweisung.',
                severity: 'error',
                sqlstate: '42601',
                index: beginIndex,
                hint: 'Erwartet: BEGIN; oder BEGIN TRANSACTION;'
            }));
        }

        return diagnostics;
    }

    _validateCommitStatement(sql) {
        const diagnostics = [];
        const commitIndex = this._findKeywordIndex(sql, /\bCOMMIT\b/i);
        if (commitIndex < 0) return diagnostics;

        if (!/^\s*COMMIT(?:\s+WORK)?\s*;?\s*$/i.test(sql)) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: 'Syntaxfehler in COMMIT-Anweisung.',
                severity: 'error',
                sqlstate: '42601',
                index: commitIndex,
                hint: 'Erwartet: COMMIT;'
            }));
        }

        return diagnostics;
    }

    _validateRollbackStatement(sql) {
        const diagnostics = [];
        const rollbackIndex = this._findKeywordIndex(sql, /\bROLLBACK\b/i);
        if (rollbackIndex < 0) return diagnostics;

        if (!/^\s*ROLLBACK(?:\s+WORK|\s+TO(?:\s+SAVEPOINT)?\s+[a-zA-Z_]\w*)?\s*;?\s*$/i.test(sql)) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: 'Syntaxfehler in ROLLBACK-Anweisung.',
                severity: 'error',
                sqlstate: '42601',
                index: rollbackIndex,
                hint: 'Erwartet: ROLLBACK; oder ROLLBACK TO SAVEPOINT name;'
            }));
        }

        return diagnostics;
    }

    _validateSavepointStatement(sql) {
        const diagnostics = [];
        const savepointIndex = this._findKeywordIndex(sql, /\bSAVEPOINT\b/i);
        if (savepointIndex < 0) return diagnostics;

        const match = /^\s*SAVEPOINT\s+([a-zA-Z_]\w*)\s*;?\s*$/i.exec(sql);
        if (!match) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: 'Syntaxfehler in SAVEPOINT-Anweisung.',
                severity: 'error',
                sqlstate: '42601',
                index: savepointIndex,
                hint: 'Erwartet: SAVEPOINT name;'
            }));
        }

        return diagnostics;
    }

    _validateGrantStatement(sql) {
        const diagnostics = [];
        const grantIndex = this._findKeywordIndex(sql, /\bGRANT\b/i);
        if (grantIndex < 0) return diagnostics;

        const match = /^\s*GRANT\s+(.+?)\s+ON\s+(?:TABLE\s+)?([a-zA-Z_]\w*)\s+TO\s+([a-zA-Z_]\w*)\s*;?\s*$/i.exec(sql);
        if (!match) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: 'Syntaxfehler in GRANT-Anweisung.',
                severity: 'error',
                sqlstate: '42601',
                index: grantIndex,
                hint: 'Erwartet: GRANT <rechte> ON TABLE <objekt> TO <rolle>;'
            }));
            return diagnostics;
        }

        const tableName = match[2].toLowerCase();
        if (!this._tableExists(tableName)) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: `Objekt nicht gefunden: Tabelle "${tableName}" existiert nicht.`,
                severity: 'error',
                sqlstate: '42P01',
                index: match.index + match[0].toLowerCase().indexOf(tableName),
                length: tableName.length,
                hint: 'Existierende Tabelle angeben oder Berechtigung auf anderes Objekt vergeben.'
            }));
        }

        return diagnostics;
    }

    _validateRevokeStatement(sql) {
        const diagnostics = [];
        const revokeIndex = this._findKeywordIndex(sql, /\bREVOKE\b/i);
        if (revokeIndex < 0) return diagnostics;

        const match = /^\s*REVOKE\s+(.+?)\s+ON\s+(?:TABLE\s+)?([a-zA-Z_]\w*)\s+FROM\s+([a-zA-Z_]\w*)\s*;?\s*$/i.exec(sql);
        if (!match) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: 'Syntaxfehler in REVOKE-Anweisung.',
                severity: 'error',
                sqlstate: '42601',
                index: revokeIndex,
                hint: 'Erwartet: REVOKE <rechte> ON TABLE <objekt> FROM <rolle>;'
            }));
            return diagnostics;
        }

        const tableName = match[2].toLowerCase();
        if (!this._tableExists(tableName)) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: `Objekt nicht gefunden: Tabelle "${tableName}" existiert nicht.`,
                severity: 'error',
                sqlstate: '42P01',
                index: match.index + match[0].toLowerCase().indexOf(tableName),
                length: tableName.length,
                hint: 'Existierende Tabelle angeben oder Berechtigung auf anderes Objekt entziehen.'
            }));
        }

        return diagnostics;
    }

    _collectParenthesisDiagnostics(sql, diagnostics) {
        const openStack = [];
        let inSingleQuote = false;
        let inDoubleQuote = false;

        for (let i = 0; i < sql.length; i++) {
            const ch = sql[i];
            const next = sql[i + 1];

            if (ch === '\'' && !inDoubleQuote) {
                if (inSingleQuote && next === '\'') {
                    i++;
                    continue;
                }
                inSingleQuote = !inSingleQuote;
                continue;
            }

            if (ch === '"' && !inSingleQuote) {
                inDoubleQuote = !inDoubleQuote;
                continue;
            }

            if (inSingleQuote || inDoubleQuote) continue;

            if (ch === '(') {
                openStack.push(i);
            } else if (ch === ')') {
                if (openStack.length === 0) {
                    diagnostics.push(this._createDiagnostic(sql, {
                        message: 'Syntaxfehler: unerwartete ")".',
                        severity: 'error',
                        sqlstate: '42601',
                        index: i,
                        hint: 'Pruefen, ob eine oeffnende "(" fehlt.'
                    }));
                    return;
                }
                openStack.pop();
            }
        }

        if (openStack.length > 0) {
            diagnostics.push(this._createDiagnostic(sql, {
                message: 'Syntaxfehler: schliessende ")" fehlt.',
                severity: 'error',
                sqlstate: '42601',
                index: openStack[openStack.length - 1],
                hint: 'Pruefen, ob alle Klammern geschlossen sind.'
            }));
        }
    }

    _findClosingParen(sql, openParenIndex) {
        let depth = 0;
        let inSingleQuote = false;
        let inDoubleQuote = false;

        for (let i = openParenIndex; i < sql.length; i++) {
            const ch = sql[i];
            const next = sql[i + 1];

            if (ch === '\'' && !inDoubleQuote) {
                if (inSingleQuote && next === '\'') {
                    i++;
                    continue;
                }
                inSingleQuote = !inSingleQuote;
                continue;
            }

            if (ch === '"' && !inSingleQuote) {
                inDoubleQuote = !inDoubleQuote;
                continue;
            }

            if (inSingleQuote || inDoubleQuote) continue;

            if (ch === '(') depth++;
            if (ch === ')') {
                depth--;
                if (depth === 0) return i;
            }
        }

        return -1;
    }

    _splitSqlListWithPositions(value, baseOffset) {
        const parts = [];
        let depth = 0;
        let tokenStart = 0;
        let inSingleQuote = false;
        let inDoubleQuote = false;

        const pushSegment = (endExclusive) => {
            const raw = value.slice(tokenStart, endExclusive);
            const leading = raw.match(/^\s*/)[0].length;
            const trailing = raw.match(/\s*$/)[0].length;
            const trimmed = raw.trim();
            if (!trimmed) return;
            const start = baseOffset + tokenStart + leading;
            const end = baseOffset + endExclusive - trailing;
            parts.push({ text: trimmed, start, end });
        };

        for (let i = 0; i < value.length; i++) {
            const ch = value[i];
            const next = value[i + 1];

            if (ch === '\'' && !inDoubleQuote) {
                if (inSingleQuote && next === '\'') {
                    i++;
                    continue;
                }
                inSingleQuote = !inSingleQuote;
                continue;
            }
            if (ch === '"' && !inSingleQuote) {
                inDoubleQuote = !inDoubleQuote;
                continue;
            }
            if (inSingleQuote || inDoubleQuote) continue;

            if (ch === '(') depth++;
            if (ch === ')') depth = Math.max(0, depth - 1);

            if (ch === ',' && depth === 0) {
                pushSegment(i);
                tokenStart = i + 1;
            }
        }

        pushSegment(value.length);
        return parts;
    }

    _parseCreateColumnWithPosition(definition, startIndex, fullSql) {
        const normalized = definition.trim().replace(/\s+/g, ' ');
        if (!normalized) return null;

        const nameMatch = normalized.match(/^([a-zA-Z_]\w*)\b/);
        if (!nameMatch) {
            return {
                diagnostic: this._createDiagnostic(fullSql, {
                    message: 'Syntaxfehler in Spaltendefinition: gueltiger Spaltenname fehlt.',
                    severity: 'error',
                    sqlstate: '42601',
                    index: startIndex,
                    hint: 'Beispiel: a INTEGER'
                })
            };
        }

        const typeMatch = normalized.match(/^[a-zA-Z_]\w*\s+([a-zA-Z][a-zA-Z0-9_]*(?:\s*\([^)]*\))?)/i);
        if (!typeMatch) {
            return {
                diagnostic: this._createDiagnostic(fullSql, {
                    message: `Datentyp fuer Spalte "${nameMatch[1]}" fehlt.`,
                    severity: 'error',
                    sqlstate: '42601',
                    index: startIndex + normalized.indexOf(nameMatch[1]) + nameMatch[1].length,
                    hint: 'Beispiel: a INTEGER'
                })
            };
        }

        const typeToken = typeMatch[1].replace(/\s+/g, '').toUpperCase();
        const typeStartInNormalized = normalized.toUpperCase().indexOf(typeMatch[1].toUpperCase());
        const upper = normalized.toUpperCase();
        const fkMatch = upper.match(/\bREFERENCES\s+([A-Z_]\w*)\s*\(\s*([A-Z_]\w*)\s*\)/);
        const isPK = upper.includes('PRIMARY KEY');
        const isUnique = isPK || /\bUNIQUE\b/.test(upper);
        const isNotNull = isPK || /\bNOT\s+NULL\b/.test(upper);
        const baseType = typeToken.replace(/\(.*/, '');

        return {
            column: {
                name: nameMatch[1],
                type: typeToken,
                isPK,
                isUnique,
                isNotNull,
                isFK: Boolean(fkMatch),
                fkTarget: fkMatch ? `${fkMatch[1].toLowerCase()}.${fkMatch[2].toLowerCase()}` : ''
            },
            baseType,
            nameIndex: startIndex + normalized.indexOf(nameMatch[1]),
            typeIndex: startIndex + Math.max(typeStartInNormalized, 0)
        };
    }

    _createDiagnostic(sql, { message, severity = 'error', sqlstate = '42601', index = 0, length = 1, hint = '' }) {
        const safeLength = Math.max(1, length);
        const start = this._indexToLineColumn(sql, index);
        const end = this._indexToLineColumn(sql, index + safeLength);
        return {
            message,
            severity,
            sqlstate,
            line: start.line,
            column: start.column,
            endLine: end.line,
            endColumn: end.column,
            hint
        };
    }

    _indexToLineColumn(sql, index) {
        const safeIndex = Math.max(0, Math.min(index, sql.length));
        const before = sql.slice(0, safeIndex);
        const segments = before.split('\n');
        return {
            line: segments.length,
            column: segments[segments.length - 1].length + 1
        };
    }

    _stripCommentsForAnalysis(sql) {
        return sql
            .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
            .replace(/--.*$/gm, '');
    }

    _findFirstStatementIndex(sql) {
        const keywordIndex = this._findKeywordIndex(
            sql,
            /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|MERGE|WITH|GRANT|REVOKE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b/i
        );
        if (keywordIndex > 0) return keywordIndex;
        return this._findKeywordIndex(sql, /\S/);
    }

    _findKeywordIndex(sql, regex) {
        const match = regex.exec(sql);
        return match ? match.index : 0;
    }

    _sortDiagnostics(diagnostics) {
        const severityRank = { error: 0, warning: 1, info: 2 };
        return [...diagnostics].sort((a, b) => {
            if (a.line !== b.line) return a.line - b.line;
            if (a.column !== b.column) return a.column - b.column;
            return (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9);
        });
    }

    /** Generiert die Simulator-Steps (abwärtskompatibel zur alten API) */
    _buildSteps(normalized, upper, result) {
        const steps = [];

        if (result.type === 'CREATE') {
            return this._buildCreateSteps(normalized);
        }
        if (result.type === 'ALTER') {
            return this._buildAlterSteps(normalized);
        }
        if (result.type === 'DROP') {
            return this._buildDropSteps(normalized);
        }
        if (result.type === 'TRUNCATE') {
            return this._buildTruncateSteps(normalized);
        }
        if (result.type === 'MERGE') {
            return this._buildMergeSteps(normalized);
        }
        if (result.type === 'BEGIN') {
            return this._buildBeginSteps(normalized);
        }
        if (result.type === 'COMMIT') {
            return this._buildCommitSteps(normalized);
        }
        if (result.type === 'ROLLBACK') {
            return this._buildRollbackSteps(normalized);
        }
        if (result.type === 'SAVEPOINT') {
            return this._buildSavepointSteps(normalized);
        }
        if (result.type === 'GRANT') {
            return this._buildGrantSteps(normalized);
        }
        if (result.type === 'REVOKE') {
            return this._buildRevokeSteps(normalized);
        }
        if (result.type === 'INSERT') {
            return this._buildInsertSteps(normalized);
        }
        if (result.type === 'UPDATE') {
            return this._buildUpdateSteps(normalized);
        }
        if (result.type === 'DELETE') {
            return this._buildDeleteSteps(normalized);
        }

        if (result.type === 'SELECT') {
            const cteNames = Array.isArray(result.ctes) && result.ctes.length > 0
                ? result.ctes
                : this._extractCteNames(normalized);
            cteNames.forEach((cteName) => {
                steps.push({
                    type: 'WITH',
                    entity: cteName,
                    description: `Materialisiere CTE: ${cteName}`,
                    visual: 'Build CTE'
                });
            });
        }

        // SELECT / Fallback: DBMS-Ausführungsreihenfolge als Steps
        const DBMS_ORDER = ['FROM', 'JOIN', 'WHERE', 'GROUP BY', 'HAVING', 'SELECT', 'DISTINCT', 'ORDER BY', 'LIMIT', 'OFFSET', 'FETCH'];

        for (const clause of DBMS_ORDER) {
            if (!result.clauses.includes(clause)) continue;

            switch (clause) {
                case 'FROM':
                    result.tables.forEach(t => steps.push({
                        type: 'FROM', entity: t,
                        description: `Lade Tabelle: ${t}`, visual: 'Load Table'
                    }));
                    break;
                case 'JOIN':
                    steps.push({ type: 'JOIN', description: 'Verbinde Tabellen (JOIN)', visual: 'Join Table' });
                    break;
                case 'WHERE':
                    steps.push({ type: 'WHERE', description: 'Filtere Zeilen (WHERE)', visual: 'Filter Rows' });
                    break;
                case 'GROUP BY':
                    steps.push({ type: 'GROUP BY', description: 'Gruppiere Zeilen (GROUP BY)', visual: 'Group Rows' });
                    break;
                case 'HAVING':
                    steps.push({ type: 'HAVING', description: 'Filtere Gruppen (HAVING)', visual: 'Filter Groups' });
                    break;
                case 'SELECT':
                    steps.push({ type: 'SELECT', description: `Wähle Spalten: ${result.columns.join(', ')}`, visual: 'Highlight Columns' });
                    break;
                case 'DISTINCT':
                    steps.push({ type: 'DISTINCT', description: 'Entferne Duplikate (DISTINCT)', visual: 'Deduplicate' });
                    break;
                case 'ORDER BY':
                    steps.push({ type: 'ORDER BY', description: 'Sortiere Ergebnis (ORDER BY)', visual: 'Sort Rows' });
                    break;
                case 'LIMIT':
                    steps.push({ type: 'LIMIT', description: 'Begrenze Zeilenzahl (LIMIT)', visual: 'Limit Rows' });
                    break;
                case 'OFFSET':
                    steps.push({ type: 'OFFSET', description: 'Überspringe Zeilen (OFFSET)', visual: 'Offset Rows' });
                    break;
                case 'FETCH':
                    steps.push({ type: 'FETCH', description: 'Lade Fenstergröße (FETCH FIRST/NEXT)', visual: 'Fetch Rows' });
                    break;
            }
        }

        if (result.type === 'SELECT') {
            const setOps = this._extractSetOperations(normalized);
            setOps.forEach((op) => {
                steps.push({
                    type: op.token,
                    description: `Kombiniere Ergebnismengen (${op.token}).`,
                    visual: 'Set Operation'
                });
            });
        }

        steps.push({ type: 'RESULT', description: 'Ergebnis wird generiert...', visual: 'Show Result' });
        return steps;
    }

    _buildCreateSteps(sql) {
        const objectType = this._detectCreateObjectType(sql);
        if (objectType === 'TABLE') return this._buildCreateTableSteps(sql);
        if (objectType === 'VIEW') return this._buildCreateViewSteps(sql);
        if (objectType === 'INDEX') return this._buildCreateIndexSteps(sql);
        if (objectType === 'SCHEMA') return this._buildCreateSchemaSteps(sql);
        if (objectType === 'SEQUENCE') return this._buildCreateSequenceSteps(sql);
        return [];
    }

    _buildCreateTableSteps(sql) {
        const steps = [];
        const m = sql.match(/CREATE\s+TABLE\s+(\w+)\s*\(([\s\S]+)\)\s*;?$/i);
        if (!m) return steps;
        const tableName = m[1].toLowerCase();
        const rawColumns = this._splitSqlList(m[2]);
        const columns = rawColumns
            .map((def) => this._parseCreateColumn(def))
            .filter(Boolean);

        if (columns.length === 0) return steps;

        const canonicalSql = `CREATE TABLE ${tableName} (${columns.map(col => `${col.name} ${col.type}`).join(', ')});`;
        const typeList = [...new Set(columns.map(col => col.type))];
        const columnsDetail = columns.map(col => `\`${col.name}\` -> Typ \`${col.type}\`, NULL erlaubt (Standard), kein Default`);

        steps.push({
            kind: 'CREATE_START',
            type: 'CREATE',
            description: 'Starte DDL-Ausführung für:',
            code: canonicalSql,
            visual: 'Create Table',
            entity: tableName,
            objectType: 'TABLE',
            columns
        });
        steps.push({
            kind: 'PARSE',
            type: 'PARSE',
            description: 'Zerlege SQL in Tokens und baue Syntaxbaum (AST).',
            visual: 'Parse SQL',
            entity: tableName,
            columns
        });
        steps.push({
            kind: 'CHECK',
            type: 'PRÜFEN',
            description: 'Prüfe:',
            details: [
                'Berechtigung: `CREATE TABLE`',
                `Tabelle \`${tableName}\` existiert noch nicht`,
                `Datentypen sind gültig: ${typeList.map(t => `\`${t}\``).join(', ')}`
            ],
            visual: 'Validate DDL',
            entity: tableName,
            columns
        });
        steps.push({
            kind: 'LOCKS',
            type: 'LOCKS',
            description: 'Setze Schema-/DDL-Lock, damit niemand parallel dieselbe Struktur ändert.',
            visual: 'Set Locks',
            entity: tableName,
            columns
        });
        steps.push({
            kind: 'CATALOG_TABLE',
            type: 'KATALOG: TABELLE',
            description: 'Lege Metadaten an:',
            details: [
                `Objekt: Tabelle \`${tableName}\``,
                'interne Objekt-ID / Owner / Schema'
            ],
            visual: 'Catalog Table',
            entity: tableName,
            columns
        });
        steps.push({
            kind: 'CATALOG_COLUMNS',
            type: 'KATALOG: SPALTEN',
            description: 'Lege Spalten-Metadaten an:',
            details: columnsDetail,
            visual: 'Catalog Columns',
            entity: tableName,
            columns
        });
        steps.push({
            kind: 'STORAGE',
            type: 'STORAGE',
            description: 'Lege/initialisiere Speicherstruktur für die Tabelle (Segment/Pages je nach DBMS).',
            visual: 'Init Storage',
            entity: tableName,
            columns
        });
        steps.push({
            kind: 'COMMIT',
            type: 'COMMIT',
            description: 'Mache die Änderung dauerhaft und sichtbar (Transaktion abschließen).',
            visual: 'Commit DDL',
            entity: tableName,
            columns
        });
        steps.push({
            kind: 'RESULT',
            type: 'RESULT',
            description: `Tabelle \`${tableName}\` erfolgreich erstellt.`,
            visual: 'Done',
            entity: tableName,
            objectType: 'TABLE',
            columns
        });
        return steps;
    }

    _buildCreateViewSteps(sql) {
        const steps = [];
        const m = sql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(\w+)\s+AS\s+([\s\S]+?)\s*;?$/i);
        if (!m) return steps;

        const viewName = m[1].toLowerCase();
        const query = m[2].trim();
        steps.push({
            type: 'CREATE VIEW',
            description: `Lege View ${viewName} an.`,
            visual: 'Create View',
            entity: viewName,
            objectType: 'VIEW',
            query
        });
        steps.push({
            type: 'RESULT',
            description: `View ${viewName} erfolgreich erstellt.`,
            visual: 'Done',
            entity: viewName,
            objectType: 'VIEW'
        });
        return steps;
    }

    _buildCreateIndexSteps(sql) {
        const steps = [];
        const m = sql.match(/CREATE\s+(UNIQUE\s+)?INDEX\s+(\w+)\s+ON\s+(\w+)\s*\(([^)]+)\)\s*;?$/i);
        if (!m) return steps;

        const indexName = m[2].toLowerCase();
        const tableName = m[3].toLowerCase();
        const columns = this._splitSqlList(m[4]).map((entry) => entry.trim().split(/\s+/)[0]).filter(Boolean);
        steps.push({
            type: 'CREATE INDEX',
            description: `Lege Index ${indexName} auf ${tableName} an.`,
            visual: 'Create Index',
            entity: indexName,
            objectType: 'INDEX',
            table: tableName,
            unique: Boolean(m[1]),
            columns
        });
        steps.push({
            type: 'RESULT',
            description: `Index ${indexName} erfolgreich erstellt.`,
            visual: 'Done',
            entity: indexName,
            objectType: 'INDEX'
        });
        return steps;
    }

    _buildCreateSchemaSteps(sql) {
        const steps = [];
        const m = sql.match(/CREATE\s+SCHEMA\s+(\w+)/i);
        if (!m) return steps;

        const schemaName = m[1].toLowerCase();
        steps.push({
            type: 'CREATE SCHEMA',
            description: `Lege Schema ${schemaName} an.`,
            visual: 'Create Schema',
            entity: schemaName,
            objectType: 'SCHEMA'
        });
        steps.push({
            type: 'RESULT',
            description: `Schema ${schemaName} erfolgreich erstellt.`,
            visual: 'Done',
            entity: schemaName,
            objectType: 'SCHEMA'
        });
        return steps;
    }

    _buildCreateSequenceSteps(sql) {
        const steps = [];
        const m = sql.match(/CREATE\s+SEQUENCE\s+(\w+)/i);
        if (!m) return steps;

        const sequenceName = m[1].toLowerCase();
        steps.push({
            type: 'CREATE SEQUENCE',
            description: `Lege Sequence ${sequenceName} an.`,
            visual: 'Create Sequence',
            entity: sequenceName,
            objectType: 'SEQUENCE'
        });
        steps.push({
            type: 'RESULT',
            description: `Sequence ${sequenceName} erfolgreich erstellt.`,
            visual: 'Done',
            entity: sequenceName,
            objectType: 'SEQUENCE'
        });
        return steps;
    }

    _buildAlterSteps(sql) {
        const steps = [];
        const m = sql.match(/ALTER\s+TABLE\s+(\w+)\s+(ADD|DROP|ALTER|RENAME)\s+(.+)$/i);
        if (!m) return steps;

        const tableName = m[1].toLowerCase();
        const action = m[2].toUpperCase();
        const payload = m[3].trim();
        let column = null;
        let columnType = null;

        if (action === 'ADD') {
            const addMatch = payload.match(/(?:COLUMN\s+)?([a-zA-Z_]\w*)\s+([a-zA-Z][a-zA-Z0-9_]*(?:\s*\([^)]*\))?)/i);
            if (addMatch) {
                column = addMatch[1];
                columnType = addMatch[2].replace(/\s+/g, '').toUpperCase();
            }
        } else if (action === 'DROP') {
            const dropMatch = payload.match(/(?:COLUMN\s+)?([a-zA-Z_]\w*)/i);
            if (dropMatch) column = dropMatch[1];
        }

        steps.push({
            type: 'ALTER',
            description: `Passe Tabelle ${tableName} an (${action}).`,
            visual: 'Alter Table',
            entity: tableName,
            action,
            payload,
            column,
            columnType
        });
        steps.push({
            type: 'RESULT',
            description: `ALTER TABLE ${tableName} erfolgreich ausgefuehrt.`,
            visual: 'Done',
            entity: tableName
        });
        return steps;
    }

    _buildDropSteps(sql) {
        const steps = [];
        const m = sql.match(/DROP\s+(TABLE|VIEW|INDEX|SCHEMA|SEQUENCE)\s+(IF\s+EXISTS\s+)?(\w+)/i);
        if (!m) return steps;

        const objectType = m[1].toUpperCase();
        const entity = m[3].toLowerCase();
        steps.push({
            type: 'DROP',
            description: `${objectType} ${entity} wird entfernt.`,
            visual: 'Drop Object',
            entity,
            objectType,
            ifExists: Boolean(m[2])
        });
        steps.push({
            type: 'RESULT',
            description: `${objectType} ${entity} erfolgreich entfernt.`,
            visual: 'Done',
            entity,
            objectType
        });
        return steps;
    }

    _buildTruncateSteps(sql) {
        const steps = [];
        const m = sql.match(/TRUNCATE\s+TABLE\s+(\w+)/i);
        if (!m) return steps;

        const entity = m[1].toLowerCase();
        steps.push({
            type: 'TRUNCATE',
            description: `Leere Tabelle ${entity} (TRUNCATE TABLE).`,
            visual: 'Truncate Table',
            entity
        });
        steps.push({
            type: 'RESULT',
            description: `Tabelle ${entity} ist jetzt leer.`,
            visual: 'Done',
            entity
        });
        return steps;
    }

    _buildMergeSteps(sql) {
        const parsed = this._parseMergeStatement(sql);
        if (!parsed) return [];

        return [
            {
                type: 'MERGE',
                description: `Merge Quelle ${parsed.source} in Ziel ${parsed.target}.`,
                visual: 'Merge Rows',
                entity: parsed.target,
                source: parsed.source,
                condition: parsed.onCondition,
                targetKey: parsed.targetKey,
                sourceKey: parsed.sourceKey,
                targetRefs: parsed.targetRefs,
                sourceRefs: parsed.sourceRefs,
                updateAssignments: parsed.updateAssignments,
                insertSpec: parsed.insert
            },
            {
                type: 'RESULT',
                description: `MERGE auf ${parsed.target} abgeschlossen.`,
                visual: 'Done',
                entity: parsed.target
            }
        ];
    }

    _buildBeginSteps() {
        return [
            {
                type: 'BEGIN',
                description: 'Starte Transaktion (BEGIN).',
                visual: 'Begin Transaction'
            },
            {
                type: 'RESULT',
                description: 'Transaktion ist aktiv.',
                visual: 'Done'
            }
        ];
    }

    _buildCommitSteps() {
        return [
            {
                type: 'COMMIT',
                description: 'Schreibe Transaktion dauerhaft (COMMIT).',
                visual: 'Commit Transaction'
            },
            {
                type: 'RESULT',
                description: 'Transaktion erfolgreich abgeschlossen.',
                visual: 'Done'
            }
        ];
    }

    _buildRollbackSteps(sql) {
        const toSavepoint = sql.match(/\bTO(?:\s+SAVEPOINT)?\s+([a-zA-Z_]\w*)\b/i);
        const target = toSavepoint ? toSavepoint[1] : null;
        return [
            {
                type: 'ROLLBACK',
                description: target
                    ? `Rollback bis Savepoint ${target}.`
                    : 'Rolle Transaktion zurueck (ROLLBACK).',
                visual: 'Rollback Transaction',
                savepoint: target
            },
            {
                type: 'RESULT',
                description: target
                    ? `Rollback zu Savepoint ${target} abgeschlossen.`
                    : 'Transaktion zurueckgesetzt.',
                visual: 'Done'
            }
        ];
    }

    _buildSavepointSteps(sql) {
        const m = sql.match(/\bSAVEPOINT\s+([a-zA-Z_]\w*)\b/i);
        if (!m) return [];
        const name = m[1];
        return [
            {
                type: 'SAVEPOINT',
                description: `Setze Savepoint ${name}.`,
                visual: 'Create Savepoint',
                savepoint: name
            },
            {
                type: 'RESULT',
                description: `Savepoint ${name} gesetzt.`,
                visual: 'Done'
            }
        ];
    }

    _buildGrantSteps(sql) {
        const m = sql.match(/GRANT\s+(.+?)\s+ON\s+(?:TABLE\s+)?(\w+)\s+TO\s+(\w+)/i);
        if (!m) return [];
        const privileges = m[1].split(',').map((entry) => entry.trim()).filter(Boolean);
        const entity = m[2].toLowerCase();
        const grantee = m[3];

        return [
            {
                type: 'GRANT',
                description: `Vergib Rechte auf ${entity} an ${grantee}.`,
                visual: 'Grant Privileges',
                entity,
                grantee,
                privileges
            },
            {
                type: 'RESULT',
                description: `Rechte fuer ${grantee} auf ${entity} vergeben.`,
                visual: 'Done'
            }
        ];
    }

    _buildRevokeSteps(sql) {
        const m = sql.match(/REVOKE\s+(.+?)\s+ON\s+(?:TABLE\s+)?(\w+)\s+FROM\s+(\w+)/i);
        if (!m) return [];
        const privileges = m[1].split(',').map((entry) => entry.trim()).filter(Boolean);
        const entity = m[2].toLowerCase();
        const grantee = m[3];

        return [
            {
                type: 'REVOKE',
                description: `Entziehe Rechte auf ${entity} von ${grantee}.`,
                visual: 'Revoke Privileges',
                entity,
                grantee,
                privileges
            },
            {
                type: 'RESULT',
                description: `Rechte fuer ${grantee} auf ${entity} entzogen.`,
                visual: 'Done'
            }
        ];
    }

    _splitSqlList(value) {
        const parts = [];
        let current = '';
        let depth = 0;

        for (const ch of value) {
            if (ch === '(') depth++;
            if (ch === ')') depth = Math.max(0, depth - 1);

            if (ch === ',' && depth === 0) {
                const trimmed = current.trim();
                if (trimmed) parts.push(trimmed);
                current = '';
                continue;
            }
            current += ch;
        }

        const tail = current.trim();
        if (tail) parts.push(tail);
        return parts;
    }

    _escapeRegex(value) {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    _extractConditionColumns(conditionSql) {
        const condition = String(conditionSql || '').trim();
        if (!condition) return [];

        const parts = condition
            .split(/\s+(?:AND|OR)\s+/i)
            .map((entry) => entry.trim())
            .filter(Boolean);

        const columns = new Set();
        parts.forEach((part) => {
            const match = /^([a-zA-Z_]\w*)\s*(=|!=|<>|>=|<=|>|<)\s*.+$/i.exec(part);
            if (!match) return;
            columns.add(match[1].toLowerCase());
        });
        return [...columns];
    }

    _extractQualifiedColumnRefs(expressionSql) {
        const refs = [];
        const expression = String(expressionSql || '');
        const regex = /\b([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)\b/g;
        let match;
        while ((match = regex.exec(expression)) !== null) {
            refs.push({
                alias: match[1].toLowerCase(),
                column: match[2].toLowerCase()
            });
        }
        return refs;
    }

    _parseSetAssignments(setSection) {
        const assignments = this._splitSqlList(setSection || '');
        if (assignments.length === 0) return null;

        const parsed = [];
        for (const assignment of assignments) {
            const match = /^([a-zA-Z_]\w*)\s*=\s*([\s\S]+)$/i.exec(String(assignment).trim());
            if (!match) return null;
            parsed.push({
                col: match[1].toLowerCase(),
                val: this._normalizeInsertValue(match[2]),
                raw: match[2].trim()
            });
        }
        return parsed;
    }

    _parseUpdateStatement(sql) {
        const analysisSql = this._stripCommentsForAnalysis(sql).trim();
        const match = /^UPDATE\s+([a-zA-Z_]\w*)\s+SET\s+([\s\S]+?)(?:\s+WHERE\s+([\s\S]+?))?\s*;?$/i.exec(analysisSql);
        if (!match) return null;

        const assignments = this._parseSetAssignments(match[2]);
        if (!assignments) return null;

        return {
            table: match[1].toLowerCase(),
            assignments,
            condition: match[3] ? match[3].trim() : ''
        };
    }

    _parseDeleteStatement(sql) {
        const analysisSql = this._stripCommentsForAnalysis(sql).trim();
        const match = /^DELETE\s+FROM\s+([a-zA-Z_]\w*)(?:\s+WHERE\s+([\s\S]+?))?\s*;?$/i.exec(analysisSql);
        if (!match) return null;

        return {
            table: match[1].toLowerCase(),
            condition: match[2] ? match[2].trim() : ''
        };
    }

    _parseMergeStatement(sql) {
        const analysisSql = this._stripCommentsForAnalysis(sql).trim();
        const headMatch = /^MERGE\s+INTO\s+([a-zA-Z_]\w*)(?:\s+(?!USING\b)([a-zA-Z_]\w*))?\s+USING\s+([a-zA-Z_]\w*)(?:\s+(?!ON\b)([a-zA-Z_]\w*))?\s+ON\s+([\s\S]+)$/i.exec(analysisSql);
        if (!headMatch) return null;

        const target = headMatch[1].toLowerCase();
        const source = headMatch[3].toLowerCase();
        const targetAlias = (headMatch[2] || headMatch[1]).toLowerCase();
        const sourceAlias = (headMatch[4] || headMatch[3]).toLowerCase();
        const remainder = String(headMatch[5] || '').replace(/;+\s*$/, '').trim();
        if (!remainder) return null;

        const matchedKeyword = /WHEN\s+MATCHED\s+THEN\s+UPDATE\s+SET/i.exec(remainder);
        const notMatchedKeyword = /WHEN\s+NOT\s+MATCHED\s+THEN\s+INSERT/i.exec(remainder);

        const clauseIndexes = [matchedKeyword?.index, notMatchedKeyword?.index]
            .filter((value) => Number.isInteger(value) && value >= 0);
        const clauseStart = clauseIndexes.length > 0 ? Math.min(...clauseIndexes) : remainder.length;
        const onCondition = remainder.slice(0, clauseStart).trim();
        if (!onCondition) return null;

        const targetRefNames = new Set([target, targetAlias, 'target']);
        const sourceRefNames = new Set([source, sourceAlias, 'source']);
        const onMatch = /^([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)\s*=\s*([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)$/i.exec(onCondition);
        if (!onMatch) return null;

        const leftAlias = onMatch[1].toLowerCase();
        const leftColumn = onMatch[2].toLowerCase();
        const rightAlias = onMatch[3].toLowerCase();
        const rightColumn = onMatch[4].toLowerCase();

        let targetKey = null;
        let sourceKey = null;
        if (targetRefNames.has(leftAlias) && sourceRefNames.has(rightAlias)) {
            targetKey = leftColumn;
            sourceKey = rightColumn;
        } else if (sourceRefNames.has(leftAlias) && targetRefNames.has(rightAlias)) {
            targetKey = rightColumn;
            sourceKey = leftColumn;
        } else {
            return null;
        }

        let updateAssignments = [];
        if (matchedKeyword) {
            const updateStart = matchedKeyword.index + matchedKeyword[0].length;
            const updateEnd = notMatchedKeyword && notMatchedKeyword.index > matchedKeyword.index
                ? notMatchedKeyword.index
                : remainder.length;
            const updateSection = remainder.slice(updateStart, updateEnd).trim();
            updateAssignments = this._parseSetAssignments(updateSection) || [];
            if (updateAssignments.length === 0) return null;
        }

        let insertSpec = null;
        if (notMatchedKeyword) {
            const insertStart = notMatchedKeyword.index + notMatchedKeyword[0].length;
            const insertSection = remainder.slice(insertStart).trim();
            const insertMatch = /^(?:\(([^)]*)\))?\s*VALUES\s*\(([\s\S]+)\)\s*$/i.exec(insertSection);
            if (!insertMatch) return null;

            const insertColumns = insertMatch[1]
                ? this._splitSqlList(insertMatch[1]).map((entry) => entry.trim().toLowerCase()).filter(Boolean)
                : [];
            const rawValues = this._splitSqlList(insertMatch[2]).map((entry) => entry.trim()).filter(Boolean);
            if (rawValues.length === 0) return null;

            insertSpec = {
                columns: insertColumns,
                values: rawValues.map((raw) => ({
                    raw,
                    value: this._normalizeInsertValue(raw)
                }))
            };
        }

        if (updateAssignments.length === 0 && !insertSpec) return null;

        return {
            target,
            source,
            targetAlias,
            sourceAlias,
            targetRefs: [...targetRefNames],
            sourceRefs: [...sourceRefNames],
            onCondition,
            targetKey,
            sourceKey,
            updateAssignments,
            insert: insertSpec
        };
    }

    _parseInsertStatement(sql) {
        const analysisSql = this._stripCommentsForAnalysis(sql).trim();
        const match = /^INSERT\s+INTO\s+([a-zA-Z_]\w*)\s*(?:\(([^)]*)\))?\s+VALUES\s+([\s\S]+?)(?:\s+RETURNING\s+(.+?))?\s*;?$/i.exec(analysisSql);
        if (!match) return null;

        const table = match[1].toLowerCase();
        const columns = match[2]
            ? this._splitSqlList(match[2]).map((entry) => entry.trim().toLowerCase()).filter(Boolean)
            : [];
        const tupleGroups = this._extractInsertTupleGroups(match[3]);
        if (!tupleGroups || tupleGroups.length === 0) return null;

        const rows = tupleGroups.map((tuple) => this._splitSqlList(tuple).map((value) => this._normalizeInsertValue(value)));
        const returning = match[4]
            ? this._splitSqlList(match[4]).map((entry) => entry.trim().toLowerCase()).filter(Boolean)
            : [];

        return {
            table,
            columns,
            rows,
            returning
        };
    }

    _extractInsertTupleGroups(valueSection) {
        const tuples = [];
        const text = String(valueSection || '');
        let depth = 0;
        let tupleStart = -1;
        let inSingleQuote = false;
        let inDoubleQuote = false;

        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            const next = text[i + 1];

            if (ch === '\'' && !inDoubleQuote) {
                if (inSingleQuote && next === '\'') {
                    i++;
                    continue;
                }
                inSingleQuote = !inSingleQuote;
                continue;
            }

            if (ch === '"' && !inSingleQuote) {
                inDoubleQuote = !inDoubleQuote;
                continue;
            }

            if (inSingleQuote || inDoubleQuote) continue;

            if (depth === 0) {
                if (/\s/.test(ch) || ch === ',') continue;
                if (ch !== '(') return null;
                tupleStart = i + 1;
                depth = 1;
                continue;
            }

            if (ch === '(') {
                depth++;
            } else if (ch === ')') {
                depth--;
                if (depth < 0) return null;
                if (depth === 0) {
                    const tuple = text.slice(tupleStart, i).trim();
                    if (!tuple) return null;
                    tuples.push(tuple);
                    tupleStart = -1;
                }
            }
        }

        if (depth !== 0 || inSingleQuote || inDoubleQuote) return null;
        return tuples;
    }

    _normalizeInsertValue(rawValue) {
        const trimmed = String(rawValue || '').trim();
        if (/^NULL$/i.test(trimmed)) return null;
        if (/^TRUE$/i.test(trimmed)) return true;
        if (/^FALSE$/i.test(trimmed)) return false;
        if (/^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
        if (/^'.*'$/.test(trimmed)) return trimmed.slice(1, -1).replace(/''/g, '\'');
        if (/^".*"$/.test(trimmed)) return trimmed.slice(1, -1).replace(/""/g, '"');
        return trimmed;
    }

    _parseCreateColumn(definition) {
        const normalized = definition.trim().replace(/\s+/g, ' ');
        if (!normalized) return null;

        const nameMatch = normalized.match(/^([a-zA-Z_]\w*)\s+/);
        if (!nameMatch) return null;
        const name = nameMatch[1];

        const typeMatch = normalized.match(/^[a-zA-Z_]\w*\s+([a-zA-Z][a-zA-Z0-9_]*(?:\s*\([^)]*\))?)/i);
        const type = (typeMatch ? typeMatch[1] : 'TEXT').replace(/\s+/g, '').toUpperCase();

        const upper = normalized.toUpperCase();
        const fkMatch = upper.match(/\bREFERENCES\s+([A-Z_]\w*)\s*\(\s*([A-Z_]\w*)\s*\)/);
        const isPK = upper.includes('PRIMARY KEY');
        const isUnique = isPK || /\bUNIQUE\b/.test(upper);
        const isNotNull = isPK || /\bNOT\s+NULL\b/.test(upper);

        return {
            name,
            type,
            isPK,
            isUnique,
            isNotNull,
            isFK: Boolean(fkMatch),
            fkTarget: fkMatch ? `${fkMatch[1].toLowerCase()}.${fkMatch[2].toLowerCase()}` : ''
        };
    }

    _buildInsertSteps(sql) {
        const parsed = this._parseInsertStatement(sql);
        if (!parsed) return [];

        const rowCount = parsed.rows.length;
        const step = {
            type: 'INSERT',
            description: `Füge ${rowCount} Datensatz${rowCount === 1 ? '' : 'e'} in ${parsed.table} ein.`,
            visual: 'Insert Row',
            entity: parsed.table,
            columns: parsed.columns,
            rows: parsed.rows,
            values: parsed.rows[0] || []
        };
        if (parsed.returning.length > 0) {
            step.returning = parsed.returning;
        }

        const resultDescription = parsed.returning.length > 0
            ? `Daten eingefügt. RETURNING: ${parsed.returning.join(', ')}.`
            : 'Daten eingefügt.';

        return [
            step,
            { type: 'RESULT', description: resultDescription, visual: 'Done' }
        ];
    }

    _buildUpdateSteps(sql) {
        const parsed = this._parseUpdateStatement(sql);
        if (!parsed) return [];

        const details = parsed.condition
            ? `Aktualisiere ${parsed.table} (WHERE ${parsed.condition})`
            : `Aktualisiere ${parsed.table} (alle Zeilen)`;

        return [
            {
                type: 'UPDATE',
                description: details,
                visual: 'Update Rows',
                entity: parsed.table,
                modifications: parsed.assignments,
                condition: parsed.condition
            },
            {
                type: 'RESULT',
                description: 'Daten aktualisiert.',
                visual: 'Done'
            }
        ];
    }

    _buildDeleteSteps(sql) {
        const parsed = this._parseDeleteStatement(sql);
        if (!parsed) return [];

        const details = parsed.condition
            ? `Lösche aus ${parsed.table} (WHERE ${parsed.condition})`
            : `Lösche alle Zeilen aus ${parsed.table}`;

        return [
            {
                type: 'DELETE',
                description: details,
                visual: 'Delete Rows',
                entity: parsed.table,
                condition: parsed.condition
            },
            {
                type: 'RESULT',
                description: 'Daten gelöscht.',
                visual: 'Done'
            }
        ];
    }
}

// Globale Instanz (abwärtskompatibel)
window.sqlParser = new SQLParser();
