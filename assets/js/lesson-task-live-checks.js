(function (root, factory) {
    const api = factory();
    root.lessonTaskLiveChecks = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
}(typeof window !== 'undefined' ? window : globalThis, function () {
    const SQL_LEAD_PATTERN = /\b(SELECT|INSERT(?:\s+INTO)?|UPDATE|DELETE(?:\s+FROM)?|CREATE(?:\s+TABLE|\s+VIEW|\s+INDEX|\s+TRIGGER|\s+DATABASE|\s+SCHEMA|\s+SEQUENCE|\s+TYPE|\s+DOMAIN)?|DROP(?:\s+TABLE|\s+VIEW|\s+INDEX|\s+TRIGGER|\s+DATABASE|\s+SCHEMA|\s+SEQUENCE|\s+TYPE|\s+DOMAIN)?|ALTER(?:\s+TABLE)?|TRUNCATE(?:\s+TABLE)?|GRANT|REVOKE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|LEFT(?:\s+OUTER)?\s+JOIN|RIGHT(?:\s+OUTER)?\s+JOIN|FULL(?:\s+OUTER)?\s+JOIN|INNER\s+JOIN|WHERE|HAVING|ORDER\s+BY|GROUP\s+BY)\b[\s\S]*$/i;
    const COLUMN_TYPE_PATTERN = /\b([a-z_]\w*)\s+(integer|int|bigint|smallint|text|varchar|char|boolean|bool|decimal|numeric|date|timestamp|real|float|double)\b/gi;

    function normalizeWhitespace(value = '') {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function escapeRegex(value = '') {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function buildFlexibleSqlPattern(value = '') {
        const normalized = String(value || '').replace(/`/g, '').trim();
        if (!normalized) return '';
        let pattern = '';
        let previousChar = '';
        let sawWhitespace = false;

        for (const char of normalized) {
            if (/\s/.test(char)) {
                sawWhitespace = pattern.length > 0;
                continue;
            }

            if (sawWhitespace && pattern) {
                const joiner = /[,(]/.test(previousChar) || /[),;]/.test(char) ? '\\s*' : '\\s+';
                pattern += joiner;
                sawWhitespace = false;
            }

            if (char === ';') {
                pattern += ';?';
                previousChar = ';';
                continue;
            }

            pattern += escapeRegex(char);
            previousChar = char;
        }

        return pattern;
    }

    function buildRegexCheck(pattern = '') {
        const safePattern = String(pattern || '').trim();
        if (!safePattern) return null;
        return {
            type: 'statement-regex',
            pattern: safePattern,
            flags: 'i'
        };
    }

    function buildContainsCheck(tokens = []) {
        const safeTokens = (Array.isArray(tokens) ? tokens : [])
            .map((token) => normalizeWhitespace(token))
            .filter(Boolean);
        if (safeTokens.length === 0) return null;
        return {
            type: 'statement-contains',
            tokens: safeTokens
        };
    }

    function extractBacktickedIdentifiers(value = '') {
        return Array.from(String(value || '').matchAll(/`([^`]+)`/g))
            .map((match) => normalizeWhitespace(match[1]))
            .filter(Boolean);
    }

    function extractColumnSpecs(value = '') {
        const safeValue = String(value || '');
        const scopes = [];
        const parenthesized = Array.from(safeValue.matchAll(/\(([^)]+)\)/g)).map((match) => match[1]);
        if (parenthesized.length > 0) {
            scopes.push(parenthesized.join(' '));
        } else {
            scopes.push(safeValue);
        }

        const specs = [];
        scopes.forEach((scope) => {
            let match = null;
            COLUMN_TYPE_PATTERN.lastIndex = 0;
            while ((match = COLUMN_TYPE_PATTERN.exec(scope)) !== null) {
                specs.push({
                    name: String(match[1] || '').toLowerCase(),
                    type: String(match[2] || '').toLowerCase()
                });
            }
        });
        return specs;
    }

    function extractExplicitSqlFragment(value = '') {
        const safeValue = normalizeWhitespace(value);
        if (!safeValue) return '';

        const colonIndex = safeValue.lastIndexOf(':');
        if (colonIndex >= 0) {
            const tail = normalizeWhitespace(safeValue.slice(colonIndex + 1));
            if (tail && SQL_LEAD_PATTERN.test(tail)) {
                return tail;
            }
        }

        const keywordMatch = safeValue.match(SQL_LEAD_PATTERN);
        return keywordMatch ? normalizeWhitespace(keywordMatch[0]) : '';
    }

    function buildRegexFromSqlFragment(fragment = '') {
        const pattern = buildFlexibleSqlPattern(fragment);
        return buildRegexCheck(pattern);
    }

    function deriveCreateTableCheck(taskText = '', lessonBody = '') {
        const normalizedTask = normalizeWhitespace(taskText).toLowerCase();
        const identifiers = extractBacktickedIdentifiers(taskText);
        const tableName = identifiers[0] || '';
        const columnSpecs = [
            ...extractColumnSpecs(taskText),
            ...extractColumnSpecs(lessonBody)
        ];

        if (normalizedTask.includes('nicht `users`') || normalizedTask.includes('nicht users')) {
            return buildRegexCheck('\\bcreate\\s+table\\b(?:\\s+if\\s+not\\s+exists\\b)?\\s+(?!users\\b)[a-z_][\\w]*');
        }

        const tokens = ['create table'];
        if (tableName) tokens.push(tableName);
        columnSpecs.forEach((spec) => {
            if (!spec?.name || !spec?.type) return;
            tokens.push(`${spec.name} ${spec.type}`);
        });
        return buildContainsCheck(tokens);
    }

    function deriveInsertCheck(taskText = '') {
        const normalizedTask = normalizeWhitespace(taskText).toLowerCase();
        const identifiers = extractBacktickedIdentifiers(taskText);
        const tableName = identifiers[0] || '';
        const tokens = ['insert into'];
        if (tableName) tokens.push(tableName);
        if (normalizedTask.includes('null')) tokens.push('null');
        return buildContainsCheck(tokens);
    }

    function deriveSelectCheck(taskText = '') {
        const normalizedTask = normalizeWhitespace(taskText).toLowerCase();
        const identifiers = extractBacktickedIdentifiers(taskText);
        const tableName = identifiers[0] || '';

        if (normalizedTask.includes('alle zeilen') && tableName) {
            return buildRegexCheck(`\\bselect\\b[\\s\\S]*\\*\\s+from\\s+${escapeRegex(tableName)}\\b`);
        }
        if (normalizedTask.includes('nur die namen') && tableName) {
            return buildRegexCheck(`\\bselect\\b[\\s\\S]*\\bname\\b[\\s\\S]*\\bfrom\\b[\\s\\S]*\\b${escapeRegex(tableName)}\\b`);
        }
        if (normalizedTask.includes('leer') && normalizedTask.includes('users')) {
            return buildRegexCheck('\\bselect\\b[\\s\\S]*\\bfrom\\b[\\s\\S]*\\busers\\b');
        }
        if (normalizedTask.startsWith('pruefe per select')) {
            return buildRegexCheck('\\bselect\\b');
        }
        if (normalizedTask.startsWith('gib') || normalizedTask.startsWith('selektiere')) {
            if (tableName) {
                return buildRegexCheck(`\\bselect\\b[\\s\\S]*\\bfrom\\b[\\s\\S]*\\b${escapeRegex(tableName)}\\b`);
            }
            return buildRegexCheck('\\bselect\\b');
        }
        return null;
    }

    function deriveAlterTableCheck(taskText = '') {
        const safeText = normalizeWhitespace(taskText);
        const match = safeText.match(/fuege\s+([a-z_]\w*)\s+([a-z]+)\s+zu\s+([a-z_]\w*)\s+hinzu/i);
        if (match) {
            return buildRegexCheck(`\\balter\\s+table\\b[\\s\\S]*\\b${escapeRegex(match[3])}\\b[\\s\\S]*\\badd\\b[\\s\\S]*\\b${escapeRegex(match[1])}\\b[\\s\\S]*\\b${escapeRegex(match[2])}\\b`);
        }
        return null;
    }

    function deriveGrantOrRevokeCheck(taskText = '') {
        const normalizedTask = normalizeWhitespace(taskText).toLowerCase();
        if (normalizedTask.includes('leserecht')) {
            if (normalizedTask.includes('entzieh')) {
                return buildRegexCheck('\\brevoke\\b[\\s\\S]*\\bselect\\b[\\s\\S]*\\bon\\b[\\s\\S]*\\busers\\b');
            }
            return buildRegexCheck('\\bgrant\\b[\\s\\S]*\\bselect\\b[\\s\\S]*\\bon\\b[\\s\\S]*\\busers\\b');
        }
        if (normalizedTask.includes('schreibrecht') || normalizedTask.includes('insert-recht') || normalizedTask.includes('(insert)')) {
            if (normalizedTask.includes('entzieh')) {
                return buildRegexCheck('\\brevoke\\b[\\s\\S]*\\binsert\\b[\\s\\S]*\\bon\\b[\\s\\S]*\\busers\\b');
            }
            return buildRegexCheck('\\bgrant\\b[\\s\\S]*\\binsert\\b[\\s\\S]*\\bon\\b[\\s\\S]*\\busers\\b');
        }
        return null;
    }

    function deriveTransactionCheck(taskText = '') {
        const normalizedTask = normalizeWhitespace(taskText).toLowerCase();
        if (normalizedTask.includes('starte') && normalizedTask.includes('transaktion')) {
            return buildRegexCheck('\\bbegin\\b');
        }
        if (normalizedTask.includes('bestaetige') && normalizedTask.includes('transaktion')) {
            return buildRegexCheck('\\bcommit\\b');
        }
        if (normalizedTask.includes('verwirf') && normalizedTask.includes('transaktion')) {
            return buildRegexCheck('\\brollback\\b');
        }
        return null;
    }

    function deriveJoinCheck(taskText = '') {
        const normalizedTask = normalizeWhitespace(taskText).toLowerCase();
        if (!normalizedTask.includes('join')) return null;
        if (normalizedTask.includes('left outer join') || normalizedTask.includes('full outer join')) {
            return buildRegexCheck('\\b(left\\s+outer\\s+join|full\\s+outer\\s+join)\\b');
        }
        if (normalizedTask.includes('inner join')) {
            return buildRegexCheck('\\binner\\s+join\\b[\\s\\S]*\\bon\\b');
        }
        if (normalizedTask.includes('left join')) {
            return buildRegexCheck('\\bleft\\s+join\\b[\\s\\S]*\\bon\\b');
        }
        if (normalizedTask.includes('right join')) {
            return buildRegexCheck('\\bright\\s+join\\b');
        }
        if (normalizedTask.includes('full join')) {
            return buildRegexCheck('\\bfull\\s+join\\b');
        }
        return buildRegexCheck('\\bjoin\\b');
    }

    function deriveTaskCheck(taskText = '', context = {}) {
        const safeTaskText = normalizeWhitespace(taskText);
        const safeLessonBody = String(context?.lessonBody || '');
        if (!safeTaskText) return null;

        const explicitTaskFragment = extractExplicitSqlFragment(safeTaskText);
        if (explicitTaskFragment) {
            return buildRegexFromSqlFragment(explicitTaskFragment);
        }

        const lowerTask = safeTaskText.toLowerCase();

        const transactionCheck = deriveTransactionCheck(safeTaskText);
        if (transactionCheck) return transactionCheck;

        const grantOrRevokeCheck = deriveGrantOrRevokeCheck(safeTaskText);
        if (grantOrRevokeCheck) return grantOrRevokeCheck;

        const joinCheck = deriveJoinCheck(safeTaskText);
        if (joinCheck) return joinCheck;

        if (lowerTask.includes('fuege') && lowerTask.includes('hinzu')) {
            const alterTableCheck = deriveAlterTableCheck(safeTaskText);
            if (alterTableCheck) return alterTableCheck;
        }

        if (lowerTask.includes('fuege') || lowerTask.startsWith('insert')) {
            const insertCheck = deriveInsertCheck(safeTaskText);
            if (insertCheck) return insertCheck;
        }

        if (lowerTask.includes('erstelle') || lowerTask.includes('lege') || lowerTask.startsWith('create') || lowerTask.includes('primary key') || lowerTask.includes('foreign key')) {
            const createCheck = deriveCreateTableCheck(safeTaskText, safeLessonBody);
            if (createCheck) return createCheck;
        }

        if (lowerTask.includes('loesche') && lowerTask.includes('tabelle')) {
            return buildRegexCheck('\\bdrop\\s+table\\b');
        }

        if (lowerTask.startsWith('gib') || lowerTask.startsWith('selektiere') || lowerTask.startsWith('pruefe per select')) {
            const selectCheck = deriveSelectCheck(safeTaskText);
            if (selectCheck) return selectCheck;
        }

        if (lowerTask.startsWith('filtere') || lowerTask.startsWith('where')) {
            const whereFragment = extractExplicitSqlFragment(safeTaskText) || safeTaskText;
            if (whereFragment) return buildRegexFromSqlFragment(whereFragment);
        }

        if (/:\s*$/.test(safeTaskText)) {
            const explicitBodyFragment = extractExplicitSqlFragment(safeLessonBody);
            if (explicitBodyFragment) {
                return buildRegexFromSqlFragment(explicitBodyFragment);
            }
        }

        return null;
    }

    return {
        normalizeWhitespace,
        extractExplicitSqlFragment,
        buildFlexibleSqlPattern,
        deriveTaskCheck
    };
}));
