/*
 * SQL Studio: the connected database's schema, and what can be worked out
 * from it. The tables and columns, which are views and which of those are
 * expensive, the declared keys, a diagram's boxes and lines, the chain of
 * keys between two tables, and the SELECT that joins the tables picked.
 *
 * A port of fb-api-tool's DbSchema, SchemaGraph, KeyPath, QueryWriter and
 * SchemaAreas (FB_Tools/fb-api-tool/core), which are the reference: when the
 * two disagree, the C# is right and this is the bug.
 *
 * Read from the server rather than from a schema file, because the answer is
 * instance-specific: custom tables, and whatever version that database is
 * actually on.
 *
 * Inlined into a Fishbowl BI page, which does global text replacement on the
 * source: never a brace followed by a percent sign, nor a dollar sign followed
 * by a capital letter, anywhere in this file, comments included.
 */
(function (root) {
    'use strict';

    // Bumped whenever the snapshot learns something new, because JSON saved
    // before that simply does not contain it, and the failure is silent: an
    // old copy loads perfectly well and is just quietly wrong. Version 2 added
    // views; 3 added primary and foreign keys.
    const CACHE_VERSION = 3;

    // ── SMALL HELPERS ──────────────────────────────────────────────────

    function text(v) { return v == null ? '' : String(v); }
    function lc(v) { return text(v).toLowerCase(); }
    function same(a, b) { return lc(a) === lc(b); }

    // OrdinalIgnoreCase, as the C# sorts: the same order on every machine,
    // which a locale-aware compare would not promise.
    function byIgnoreCase(a, b) {
        const x = text(a).toUpperCase();
        const y = text(b).toUpperCase();
        return x < y ? -1 : x > y ? 1 : 0;
    }

    function copyKey(f) {
        return { table: f.table, column: f.column, refTable: f.refTable, refColumn: f.refColumn };
    }

    // runQueryAsync resolves to an array; the REST data-query endpoint wraps
    // it in { results }, and runQuery hands back a string. Taking all three
    // means the same code reads whichever the page was given.
    function rowsOf(result) {
        let r = result;
        if (typeof r === 'string') {
            try { r = JSON.parse(r); } catch (e) { return []; }
        }
        if (Array.isArray(r)) return r;
        if (r && Array.isArray(r.results)) return r.results;
        return [];
    }

    function messageOf(e) {
        if (e && typeof e === 'object' && e.message) return String(e.message);
        return text(e) || 'unknown error';
    }

    // ── THE QUERIES ────────────────────────────────────────────────────

    const QUERIES = Object.freeze({
        // Every column, with what it belongs to. One round trip, joined to
        // TABLES so a view can be told from a base table.
        columns:
            'SELECT c.TABLE_NAME AS tbl, c.COLUMN_NAME AS col, t.TABLE_TYPE AS kind ' +
            'FROM information_schema.COLUMNS c ' +
            'JOIN information_schema.TABLES t ' +
            '  ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME ' +
            'WHERE c.TABLE_SCHEMA = DATABASE() ' +
            'ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION',

        // The views MySQL has to materialise before it can filter them.
        // Matched on the definition text rather than by name, because the
        // answer is per database and a hard-coded list would rot. LIKE rather
        // than REGEXP: it is enough here and is portable across versions.
        heavyViews:
            'SELECT TABLE_NAME AS n FROM information_schema.VIEWS ' +
            'WHERE TABLE_SCHEMA = DATABASE() AND (' +
            "  UPPER(VIEW_DEFINITION) LIKE '%GROUP BY%' OR " +
            "  UPPER(VIEW_DEFINITION) LIKE '%UNION%' OR " +
            "  UPPER(VIEW_DEFINITION) LIKE '%DISTINCT%')",

        // Primary and foreign keys. Read from the same information_schema the
        // columns come from, so it is whatever this database actually
        // declares, custom tables included.
        keys:
            'SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col, ' +
            '  REFERENCED_TABLE_NAME AS rt, REFERENCED_COLUMN_NAME AS rc, CONSTRAINT_NAME AS k ' +
            'FROM information_schema.KEY_COLUMN_USAGE ' +
            'WHERE TABLE_SCHEMA = DATABASE() ' +
            "  AND (CONSTRAINT_NAME = 'PRIMARY' OR REFERENCED_TABLE_NAME IS NOT NULL) " +
            'ORDER BY TABLE_NAME, ORDINAL_POSITION'
    });

    // ── THE SNAPSHOT ───────────────────────────────────────────────────

    /**
     * Every table and view, and the columns on it. Lookups ignore case, as
     * MySQL on Windows does, but every name keeps the spelling the server
     * gave it, since that is what a query written from it should say.
     */
    class Snapshot {
        constructor() {
            this.version = CACHE_VERSION;
            this.server = '';
            this.loadedAt = Date.now();

            // Every declared foreign key: 520 of them on a stock database,
            // which is what makes a join something the tool can offer rather
            // than something you have to remember. Links Fishbowl makes by
            // convention rather than by constraint (custom fields, memos)
            // aren't here.
            this.foreignKeys = [];

            // What failed while loading and was done without: the snapshot
            // is still worth having without its keys.
            this.problems = [];

            this._tables = new Map();   // lower-case name -> { name, columns }

            // Which names are views rather than base tables. They are in the
            // column list either way, but a view is a different thing to
            // query and some of them are expensive.
            this._views = new Map();

            // Views whose definition uses GROUP BY, UNION or DISTINCT. MySQL
            // cannot push a WHERE into one of these: it materialises the whole
            // view first and filters afterwards. On a stock database that is
            // 27 of the 48 views, and it is the difference between a 2 ms
            // query and a 2 s one.
            this._heavy = new Map();

            // Each table's primary key columns. Fishbowl declares one on every
            // table, almost always a single "id".
            this._primary = new Map();

            this._index = null;
        }

        // ── building ──

        /** Adds or replaces a table's columns. */
        setTable(name, columns, isView = false) {
            const key = lc(name);
            const known = this._tables.get(key);
            const spelt = known ? known.name : text(name);
            this._tables.set(key, { name: spelt, columns: Array.from(columns || [], text) });
            if (isView) this.markView(spelt);
            return this;
        }

        removeTable(name) {
            const key = lc(name);
            this._tables.delete(key);
            this._views.delete(key);
            this._heavy.delete(key);
            this._primary.delete(key);
            return this;
        }

        addColumn(table, column) {
            const key = lc(table);
            let entry = this._tables.get(key);
            if (!entry) this._tables.set(key, entry = { name: text(table), columns: [] });
            entry.columns.push(text(column));
            return this;
        }

        markView(name) {
            if (!this._views.has(lc(name))) this._views.set(lc(name), text(name));
            return this;
        }

        markHeavy(name) {
            if (!this._heavy.has(lc(name))) this._heavy.set(lc(name), text(name));
            return this;
        }

        addPrimaryKey(table, column) {
            const key = lc(table);
            let entry = this._primary.get(key);
            if (!entry) this._primary.set(key, entry = { name: text(table), columns: [] });
            entry.columns.push(text(column));
            return this;
        }

        addForeignKey(table, column, refTable, refColumn) {
            const f = { table: text(table), column: text(column), refTable: text(refTable), refColumn: text(refColumn) };
            this.foreignKeys.push(f);
            return f;
        }

        /** Removes the foreign keys the predicate picks; returns how many went. */
        removeForeignKeys(predicate) {
            let removed = 0;
            for (let i = this.foreignKeys.length - 1; i >= 0; i--) {
                if (predicate(this.foreignKeys[i])) { this.foreignKeys.splice(i, 1); removed++; }
            }
            return removed;
        }

        /** Rows from QUERIES.columns. */
        applyColumns(rows) {
            for (const r of rowsOf(rows)) {
                if (!r || typeof r !== 'object') continue;
                // "tbl"/"col" now; "t"/"c" is what JSON written by an older
                // build of the desktop tool holds.
                const t = text(r.tbl != null ? r.tbl : r.t);
                const c = text(r.col != null ? r.col : r.c);
                if (!t || !c) continue;
                this.addColumn(t, c);
                if (r.kind != null && lc(r.kind).includes('view')) this.markView(t);
            }
            return this;
        }

        /** Rows from QUERIES.heavyViews: which views materialise. */
        applyHeavyViews(rows) {
            for (const r of rowsOf(rows)) {
                if (r && typeof r === 'object' && text(r.n)) this.markHeavy(text(r.n));
            }
            return this;
        }

        /** Rows from QUERIES.keys. */
        applyKeys(rows) {
            for (const r of rowsOf(rows)) {
                if (!r || typeof r !== 'object') continue;
                const t = text(r.tbl);
                const c = text(r.col);
                if (!t || !c) continue;
                if (text(r.k).toUpperCase() === 'PRIMARY') this.addPrimaryKey(t, c);
                else if (text(r.rt) && text(r.rc)) this.addForeignKey(t, c, text(r.rt), text(r.rc));
            }
            return this;
        }

        // ── reading ──

        /** Tables and views, sorted. */
        tableNames() {
            return this._names().sort(byIgnoreCase);
        }

        /** In the order they were read, which is what the C# enumerates. */
        _names() {
            return Array.from(this._tables.values(), e => e.name);
        }

        _entry(table) { return this._tables.get(lc(table)) || null; }

        hasTable(table) { return this._tables.has(lc(table)); }

        /** The table's own spelling, or null if there is no such table. */
        name(table) {
            const e = this._entry(table);
            return e ? e.name : null;
        }

        columns(table) {
            const e = this._entry(table);
            return e ? e.columns.slice() : [];
        }

        /** The column's own spelling, or null. */
        column(table, column) {
            const e = this._entry(table);
            if (!e) return null;
            const hit = e.columns.find(c => same(c, column));
            return hit === undefined ? null : hit;
        }

        isView(name) { return this._views.has(lc(name)); }
        isHeavy(name) { return this._heavy.has(lc(name)); }

        primaryKeys(table) {
            const e = this._primary.get(lc(table));
            return e ? e.columns.slice() : [];
        }

        isKey(table, column) {
            const e = this._primary.get(lc(table));
            return !!e && e.columns.some(c => same(c, column));
        }

        // The keys are indexed once rather than scanned on every question: a
        // browser that labels every column would otherwise walk 520 keys for
        // each of tens of thousands of columns. Rebuilt whenever the list is
        // replaced or changes length, which is how it gets edited.
        _keyIndex() {
            const fks = this.foreignKeys;
            const ix = this._index;
            if (ix && ix.of === fks && ix.length === fks.length) return ix;
            const from = new Map();
            const to = new Map();
            const byColumn = new Map();
            const push = (map, key, f) => {
                let list = map.get(key);
                if (!list) map.set(key, list = []);
                list.push(f);
            };
            for (const f of fks) {
                push(from, lc(f.table), f);
                push(to, lc(f.refTable), f);
                const k = lc(f.table) + '.' + lc(f.column);
                if (!byColumn.has(k)) byColumn.set(k, f);
            }
            return (this._index = { of: fks, length: fks.length, from, to, byColumn });
        }

        _refersTo(table, column) {
            return this._keyIndex().byColumn.get(lc(table) + '.' + lc(column)) || null;
        }

        /** What this column points at, if it is a foreign key. */
        refersTo(table, column) {
            const f = this._refersTo(table, column);
            return f ? copyKey(f) : null;
        }

        /** The foreign keys in other tables that point at this one. */
        referencedBy(table) {
            return incoming(this, table).map(copyKey);
        }

        get columnCount() {
            let n = 0;
            for (const e of this._tables.values()) n += e.columns.length;
            return n;
        }

        get viewCount() { return this._views.size; }

        get tableCount() { return this._tables.size; }

        // ── saving ──

        toJSON() {
            const tables = {};
            for (const e of this._tables.values()) tables[e.name] = e.columns.slice();
            const primaryKeys = {};
            for (const e of this._primary.values()) primaryKeys[e.name] = e.columns.slice();
            return {
                version: this.version,
                server: this.server,
                loadedAt: this.loadedAt,
                tables,
                views: Array.from(this._views.values()),
                heavyViews: Array.from(this._heavy.values()),
                primaryKeys,
                foreignKeys: this.foreignKeys.map(copyKey),
                problems: this.problems.slice()
            };
        }

        /**
         * A snapshot from what toJSON wrote, or null when it is from another
         * version: too old to trust, and re-reading it from the server is a
         * second or two once, rather than a diagram with no keys in it.
         */
        static fromJSON(obj) {
            let o = obj;
            if (typeof o === 'string') {
                try { o = JSON.parse(o); } catch (e) { return null; }
            }
            if (!o || typeof o !== 'object' || o.version !== CACHE_VERSION) return null;

            const snap = new Snapshot();
            snap.server = text(o.server);
            if (typeof o.loadedAt === 'number') snap.loadedAt = o.loadedAt;
            const tables = o.tables && typeof o.tables === 'object' ? o.tables : {};
            for (const name of Object.keys(tables)) snap.setTable(name, tables[name] || []);
            for (const v of o.views || []) snap.markView(v);
            for (const v of o.heavyViews || []) snap.markHeavy(v);
            const pks = o.primaryKeys && typeof o.primaryKeys === 'object' ? o.primaryKeys : {};
            for (const t of Object.keys(pks)) for (const c of pks[t] || []) snap.addPrimaryKey(t, c);
            for (const f of o.foreignKeys || []) {
                if (f && f.table && f.column && f.refTable && f.refColumn) {
                    snap.addForeignKey(f.table, f.column, f.refTable, f.refColumn);
                }
            }
            snap.problems = Array.isArray(o.problems) ? o.problems.map(text) : [];
            return snap;
        }
    }

    // The keys on a table (to its parents) and the keys pointing at it (from
    // its children), in the order the server declared them.
    function outgoing(snapshot, table) {
        return snapshot._keyIndex().from.get(lc(table)) || [];
    }

    function incoming(snapshot, table) {
        return snapshot._keyIndex().to.get(lc(table)) || [];
    }

    /** A snapshot from the three queries' rows. */
    function fromRows(columnRows, heavyRows, keyRows) {
        const snap = new Snapshot();
        snap.applyColumns(columnRows);
        snap.applyHeavyViews(heavyRows);
        snap.applyKeys(keyRows);
        return snap;
    }

    /**
     * Reads the schema with run(sql), which resolves to rows. Without the
     * columns there is nothing, so that failure rejects; the views and keys
     * only add to it, so their failures are recorded in problems and the
     * snapshot comes back without them.
     */
    async function load(run) {
        const columnRows = rowsOf(await run(QUERIES.columns));
        const problems = [];
        const attempt = async (what, sql) => {
            try {
                return rowsOf(await run(sql));
            } catch (e) {
                problems.push(what + ': ' + messageOf(e));
                return [];
            }
        };
        const [heavyRows, keyRows] = await Promise.all([
            attempt("Couldn't tell which views materialise", QUERIES.heavyViews),
            attempt("Couldn't read the primary and foreign keys", QUERIES.keys)
        ]);
        const snap = fromRows(columnRows, heavyRows, keyRows);
        snap.problems = problems;
        return snap;
    }

    // ── COMPLETION ─────────────────────────────────────────────────────

    // The keyword set from the tool the desktop editor was ported from, so
    // the same words light up in both.
    const KEYWORDS = Object.freeze([
        'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'LIKE', 'BETWEEN', 'EXISTS',
        'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'IF', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET',
        'DISTINCT', 'UNION', 'ALL', 'INTERSECT', 'EXCEPT', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
        'FULL', 'CROSS', 'ON', 'USING', 'INSERT', 'UPDATE', 'DELETE', 'INTO', 'VALUES', 'SET', 'CREATE',
        'DROP', 'ALTER', 'TABLE', 'VIEW', 'INDEX', 'DATABASE', 'SCHEMA', 'AS', 'WITH', 'TOP', 'FETCH',
        'NEXT', 'ROWS', 'ONLY', 'FOR', 'OVER', 'PARTITION', 'WINDOW', 'RECURSIVE', 'COUNT', 'SUM', 'AVG',
        'MIN', 'MAX', 'COALESCE', 'ISNULL', 'NULLIF', 'CAST', 'CONVERT', 'UPPER', 'LOWER', 'TRIM',
        'SUBSTRING', 'LEN', 'LENGTH', 'REPLACE', 'CONCAT', 'GETDATE', 'NOW', 'DATE', 'YEAR', 'MONTH',
        'DAY', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'CONSTRAINT', 'DEFAULT', 'UNIQUE', 'TRUE',
        'FALSE', 'ASC', 'DESC'
    ]);
    const KEYWORD_SET = new Set(KEYWORDS);

    function isKeyword(word) { return KEYWORD_SET.has(text(word).toUpperCase()); }

    // One table reference: part p, part AS p, `part` p, demodb.part p. The
    // table is group 1 and the alias, if there is one, group 2. A database
    // prefix is dropped, since the schema is keyed by table name alone.
    //
    // The lookahead is load-bearing. Without it the optional alias group
    // matches the NEXT clause keyword and consumes it, so in
    // "FROM so JOIN part" the JOIN is eaten as an alias for so and part is
    // never seen at all, which silently halved the tables in scope. SELECT,
    // UPDATE and DELETE are on the list for a statement written FROM-first,
    // where "FROM part SELECT" would otherwise make SELECT the alias.
    const NOT_AN_ALIAS = [
        'AS', 'ON', 'USING', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER', 'NATURAL',
        'STRAIGHT_JOIN', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'INTERSECT', 'EXCEPT', 'SET',
        'VALUES', 'WINDOW', 'SELECT', 'UPDATE', 'DELETE', 'FOR', 'USE', 'FORCE', 'IGNORE'
    ].join('|');
    const TABLE_REF =
        /(?:`?[A-Za-z_][A-Za-z0-9_]*`?\.)?`?([A-Za-z_][A-Za-z0-9_]*)`?/.source +
        '(?:\\s+(?:AS\\s+)?(?!(?:' + NOT_AN_ALIAS + ')\\b)' +
        /`?([A-Za-z_][A-Za-z0-9_]*)`?/.source + ')?';

    // After FROM, JOIN, or UPDATE, which names its tables the same way.
    const FROM_RX = new RegExp(/\b(?:FROM|JOIN|UPDATE)\s+/.source + TABLE_REF, 'gi');

    // The rest of a comma-separated FROM list: FROM part p, product pr. Only
    // the list itself is searched, up to the clause after it, so a comma in
    // the SELECT list never reads as another table.
    const LIST_ENDS = [
        'WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'SELECT', 'UPDATE', 'DELETE', 'SET', 'UNION', 'INTERSECT',
        'EXCEPT', 'WINDOW', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'CROSS', 'FULL', 'NATURAL', 'STRAIGHT_JOIN', 'ON'
    ].join('|');
    const FROM_LIST_RX = new RegExp('\\bFROM\\s+([^;()]*?)(?=\\b(?:' + LIST_ENDS + ')\\b|[;()]|$)', 'gis');

    const LIST_ITEM_RX = new RegExp(/,\s*/.source + TABLE_REF, 'gi');

    // "JOIN soitem si ON " or "JOIN soitem ON so" at the very end: the table
    // being joined, its alias if it has one, and whatever of the condition
    // has been typed. ON is refused as the alias, or "JOIN so ON" would read
    // ON as one and never see the condition start.
    const JOIN_ON_RX = /\bJOIN\s+(?:`?[A-Za-z_][A-Za-z0-9_]*`?\.)?`?([A-Za-z_][A-Za-z0-9_]*)`?(?:\s+(?:AS\s+)?(?!ON\b)([A-Za-z_][A-Za-z0-9_]*))?\s+ON\s+([A-Za-z0-9_]*)$/i;

    const AFTER_JOIN_RX = /\bJOIN\s+[A-Za-z0-9_]*$/i;

    // The last clause keyword before the caret, ignoring what is being typed.
    const CLAUSE_RX = /\b(SELECT|FROM|WHERE|JOIN|ON|GROUP\s+BY|ORDER\s+BY|HAVING|SET|INTO|UPDATE|VALUES)\b/gi;

    // Directly after FROM/JOIN, with at most a partial word typed.
    const EXPECTS_TABLE_RX = /\b(?:FROM|JOIN|INTO|UPDATE)\s+[A-Za-z0-9_]*$/i;

    /**
     * What the aliases in this statement refer to, as a Map from the alias
     * (lower-cased, since aliases ignore case) to the table as written. A
     * table name is its own alias too, since it works as its own qualifier.
     *
     * The second word after FROM is only an alias if it is not a keyword:
     * "FROM part WHERE" would otherwise bind WHERE as an alias for part.
     */
    function aliases(sql) {
        const map = new Map();
        const add = m => {
            const table = m[1];
            map.set(lc(table), table);
            const alias = m[2] || '';
            if (alias && !isKeyword(alias)) map.set(lc(alias), table);
        };
        const s = text(sql);
        for (const m of s.matchAll(FROM_RX)) add(m);
        for (const list of s.matchAll(FROM_LIST_RX)) {
            for (const m of (list[1] || '').matchAll(LIST_ITEM_RX)) add(m);
        }
        return map;
    }

    /**
     * The tables a statement names, in the order it names them, each with
     * the name to qualify its columns by: the alias if there is one.
     */
    function tablesInOrder(sql) {
        const found = [];
        const add = (m, offset) => {
            const table = m[1];
            const alias = m[2] || '';
            found.push({ at: offset + m.index, table, qualifier: alias && !isKeyword(alias) ? alias : table });
        };
        const s = text(sql);
        for (const m of s.matchAll(FROM_RX)) add(m, 0);
        for (const list of s.matchAll(FROM_LIST_RX)) {
            // The list is the tail of the match, since what ends it is only
            // looked ahead at, so its offset follows from the lengths.
            const body = list[1] || '';
            const at = list.index + list[0].length - body.length;
            for (const m of body.matchAll(LIST_ITEM_RX)) add(m, at);
        }
        found.sort((a, b) => a.at - b.at);
        return found.map(f => ({ table: f.table, qualifier: f.qualifier }));
    }

    /**
     * Is the caret just after JOIN ... ON, where a condition belongs? The
     * editor opens the list there on its own, with nothing typed yet.
     */
    function atJoinCondition(allBefore) {
        return JOIN_ON_RX.test(text(allBefore));
    }

    function completion(t, kind, detail) {
        return { text: t, kind, detail };
    }

    /**
     * The conditions that join the table just named after JOIN to the ones
     * before it, from the declared keys, in both directions:
     * JOIN soitem si ON  gives  si.soId = s.id, and JOIN so s ON  gives
     * s.id = si.soId. Nearest table first, since a join is usually to the
     * table just before it. Empty when the caret isn't at a join condition.
     */
    function joinConditions(snapshot, statement, allBefore) {
        const before = text(allBefore);
        const m = JOIN_ON_RX.exec(before);
        if (!m || !snapshot) return [];

        const joined = m[1];
        const joinedQ = m[2] ? m[2] : joined;

        // Only what is named before this JOIN: the tables it can join to. A
        // FROM-first statement and the usual kind both name them there.
        const earlier = tablesInOrder(before.slice(0, m.index))
            .filter(t => !same(t.qualifier, joinedQ))
            .reverse();

        const offers = [];
        for (const { table, qualifier } of earlier) {
            for (const fk of snapshot.foreignKeys) {
                if (same(fk.table, joined) && same(fk.refTable, table)) {
                    offers.push(completion(`${joinedQ}.${fk.column} = ${qualifier}.${fk.refColumn}`,
                        'join', joined + ' → ' + table));
                } else if (same(fk.table, table) && same(fk.refTable, joined)) {
                    offers.push(completion(`${joinedQ}.${fk.refColumn} = ${qualifier}.${fk.column}`,
                        'join', table + ' → ' + joined));
                }
            }
        }
        const seen = new Set();
        return offers.filter(o => !seen.has(lc(o.text)) && seen.add(lc(o.text)));
    }

    /**
     * Tables with a key to or from any table the statement names, with a few
     * words on how: "joins → so" (it points at so), "joins ← soitem". A Map
     * from the lower-cased table name to those words.
     */
    function related(snapshot, statement) {
        const inScopeSet = new Set(Array.from(aliases(statement).values(), lc));
        const out = new Map();
        for (const fk of snapshot.foreignKeys) {
            if (inScopeSet.has(lc(fk.refTable)) && !inScopeSet.has(lc(fk.table))) {
                if (!out.has(lc(fk.table))) out.set(lc(fk.table), 'joins → ' + fk.refTable);
            } else if (inScopeSet.has(lc(fk.table)) && !inScopeSet.has(lc(fk.refTable))) {
                if (!out.has(lc(fk.refTable))) out.set(lc(fk.refTable), 'joins ← ' + fk.table);
            }
        }
        return out;
    }

    /** The tables this statement names that the schema knows about, as the statement spells them. */
    function inScope(snapshot, statement) {
        const seen = new Set();
        const out = [];
        for (const t of aliases(statement).values()) {
            if (seen.has(lc(t))) continue;
            seen.add(lc(t));
            if (snapshot.hasTable(t)) out.push(t);
        }
        return out;
    }

    /**
     * Where the caret is, given everything before it: 'start', 'selectList',
     * 'tableName', 'condition', 'columnList' or 'unknown'.
     */
    function place(before) {
        // Deliberately not trimmed: the space after FROM is what says the
        // table name has not been typed yet, and trimming it would make
        // "FROM " and "FROM soitem" look the same.
        let t = text(before);
        if (t.trim().length === 0) return 'start';

        // A statement boundary resets everything.
        const semi = t.lastIndexOf(';');
        if (semi >= 0) t = t.slice(semi + 1);
        if (t.trim().length === 0) return 'start';

        if (EXPECTS_TABLE_RX.test(t)) return 'tableName';

        const all = Array.from(t.matchAll(CLAUSE_RX));
        if (all.length === 0) return 'start';

        const last = all[all.length - 1][0].toUpperCase().replace(/\s+/g, ' ');
        switch (last) {
            case 'SELECT': return 'selectList';
            case 'WHERE': case 'ON': case 'HAVING': case 'SET': return 'condition';
            case 'GROUP BY': case 'ORDER BY': return 'columnList';
            default: return 'unknown';   // past the table name, or anywhere else
        }
    }

    /**
     * Does a column belong here more than a keyword does? Used only for
     * order, never to exclude anything: a keyword is legal almost everywhere,
     * and hiding one because the guess said "column" would be worse than
     * showing it second.
     */
    function prefersColumns(where) {
        return where === 'selectList' || where === 'condition' || where === 'columnList';
    }

    /** The short label on the left of a completion row. */
    function kindLabel(kind) {
        switch (kind) {
            case 'keyword': return 'kw';
            case 'table': return 'tbl';
            case 'view': return 'view';
            case 'variable': return 'var';
            case 'join': return 'join';
            default: return 'col';
        }
    }

    function hit(candidate, prefix) {
        return lc(candidate).startsWith(lc(prefix));
    }

    function byLengthThenName(a, b) {
        return a.length - b.length || byIgnoreCase(a, b);
    }

    /** One table or view, labelled as whichever it is. */
    function entry(snapshot, name) {
        const cols = snapshot.columns(name).length + ' cols';
        if (!snapshot.isView(name)) return completion(name, 'table', cols);
        // The warning is the useful half: a materialised view cannot be
        // filtered cheaply, and that is not visible from its name.
        return completion(name, 'view', snapshot.isHeavy(name) ? cols + ' · materialises' : cols);
    }

    function whereLabel(tables) {
        const seen = new Set();
        const list = tables.filter(t => !seen.has(lc(t)) && seen.add(lc(t)))
            .sort((a, b) => a.localeCompare(b, 'en'));
        if (list.length === 1) return list[0];
        if (list.length === 2) return list[0] + ', ' + list[1];
        return list[0] + ' +' + (list.length - 1);
    }

    /**
     * The completions to offer, given the statement, the word being typed
     * and, in options, the text before the caret on its line (before), all
     * the text before the caret (allBefore) and how many to offer (max).
     *
     * Ordering is by what can legally or plausibly come next, which is most
     * of the value: after a qualifier and a dot, that table's columns and
     * nothing else; straight after FROM or JOIN, table names, since nothing
     * else is legal; in a SELECT list, a WHERE or an ORDER BY, columns first
     * and keywords after; at the start of a statement, keywords first.
     *
     * Columns come from the tables THIS statement names. Offering every
     * column in the database once a FROM is written buries the handful that
     * could be meant under thousands that could not. Nothing legal is ever
     * excluded: a keyword is valid almost everywhere, so the guess only
     * changes the order.
     */
    function suggest(snapshot, statement, qualifier, prefix, options = {}) {
        const max = options.max == null ? 14 : options.max;
        const before = options.before == null ? null : text(options.before);
        const allBefore = options.allBefore == null ? null : text(options.allBefore);
        const q = text(qualifier);
        const p = text(prefix);
        const where = place(before);

        // Straight after JOIN ... ON: the conditions the keys allow.
        if (snapshot && q.length === 0 && allBefore !== null) {
            const conditions = joinConditions(snapshot, statement, allBefore);
            if (conditions.length > 0) return conditions.filter(c => hit(c.text, p)).slice(0, max);
        }

        // A qualifier: that table only.
        if (q.length > 0) {
            if (!snapshot) return [];
            const map = aliases(statement);
            const table = map.has(lc(q)) ? map.get(lc(q)) : q;
            if (!snapshot.hasTable(table)) return [];
            return snapshot.columns(table).filter(c => hit(c, p))
                .map(c => completion(c, 'column', table))
                .slice(0, max);
        }

        // Straight after FROM or JOIN: a table name.
        if (snapshot && where === 'tableName') {
            // After JOIN, the tables with a key to or from one already named
            // come first, saying which: of 320 tables, the few that join to
            // soitem are the ones meant.
            const rel = before !== null && AFTER_JOIN_RX.test(before) ? related(snapshot, statement) : new Map();
            return snapshot._names().filter(t => hit(t, p))
                .sort((a, b) => (rel.has(lc(a)) ? 0 : 1) - (rel.has(lc(b)) ? 0 : 1) || byLengthThenName(a, b))
                .map(t => rel.has(lc(t)) ? completion(t, 'table', rel.get(lc(t))) : entry(snapshot, t))
                .slice(0, max);
        }

        if (p.length === 0) return [];

        const keywords = KEYWORDS.filter(k => hit(k, p))
            .sort(byLengthThenName)
            .map(k => completion(k.toUpperCase(), 'keyword', 'keyword'));

        if (!snapshot) return keywords.slice(0, max);

        const tables = snapshot._names().filter(t => hit(t, p))
            .sort(byLengthThenName)
            .map(t => entry(snapshot, t));

        const scope = inScope(snapshot, statement);
        let pool = [];
        if (scope.length > 0) {
            for (const t of scope) for (const c of snapshot.columns(t)) pool.push({ column: c, table: t });
        } else if (p.length >= 3) {
            // Nothing named yet: a SELECT list being written before its FROM.
            // Every column in the database is too many to be useful, so wait
            // until the prefix is specific enough to earn it.
            for (const t of snapshot._names()) for (const c of snapshot.columns(t)) pool.push({ column: c, table: t });
        }
        const groups = new Map();
        for (const x of pool) {
            if (!hit(x.column, p)) continue;
            let g = groups.get(lc(x.column));
            if (!g) groups.set(lc(x.column), g = { column: x.column, tables: [] });
            g.tables.push(x.table);
        }
        // A column on several tables names them all rather than picking one.
        const columns = Array.from(groups.values(), g => completion(g.column, 'column', whereLabel(g.tables)))
            .sort((a, b) => byLengthThenName(a.text, b.text));

        const merged = prefersColumns(where)
            ? columns.concat(keywords, tables)
            : keywords.concat(tables, columns);

        const seen = new Set();
        return merged.filter(c => {
            const key = c.kind + '|' + lc(c.text);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).slice(0, max);
    }

    // ── AREAS ──────────────────────────────────────────────────────────

    // The part of Fishbowl a table belongs to, as the diagram groups and
    // colours them, in the order its key lists them.
    const AREAS = Object.freeze(['sales', 'purchasing', 'inventory', 'manufacturing', 'shipping',
        'accounting', 'setup', 'other']);

    const AREA_NAMES = Object.freeze({
        sales: 'Sales',
        purchasing: 'Purchasing',
        inventory: 'Inventory',
        manufacturing: 'Manufacturing',
        shipping: 'Shipping',
        accounting: 'Accounting',
        setup: 'Setup and users',
        other: 'Other'
    });

    // The schema doesn't say which area a table is in: there are no modules
    // in the database, only 400 tables with names. But the names are
    // consistent, and they're what a Fishbowl person reads them by too: so,
    // soitem and sostatus are sales; po, vendor and receipt are purchasing;
    // part, tag and location are stock. A status or type table goes with the
    // table it describes. A table the names don't place is Other, uncoloured,
    // rather than guessed.
    //
    // First match wins: whole names first, then beginnings. Order matters
    // where beginnings overlap: postatus is purchasing, so purchasing is
    // tried before accounting's "post" (posting to the books).
    const AREA_RULES = [
        ['sales',
            ['so', 'product', 'quote', 'kit'],
            ['soitem', 'sostatus', 'sotype', 'soitemstatus', 'soitemtype', 'customer', 'product', 'pricingrule',
                'quote', 'salesman', 'kititem', 'kitchoice', 'upsell', 'associatedprice']],
        ['purchasing',
            ['po', 'receipt', 'vendor'],
            ['poitem', 'postatus', 'potype', 'poitemstatus', 'poitemtype', 'vendor', 'receipt']],
        ['manufacturing',
            ['mo', 'wo', 'bom'],
            ['moitem', 'mostatus', 'moitemstatus', 'woitem', 'wostatus', 'woitemstatus', 'bom', 'workcenter',
                'routing', 'instruction']],
        ['shipping',
            ['ship', 'pick', 'carrier'],
            ['shipitem', 'shipstatus', 'shiptype', 'shipcarton', 'shipterms', 'pickitem', 'pickstatus', 'picktype',
                'pickitemstatus', 'carrier', 'packag', 'fob']],
        ['inventory',
            ['part', 'tag', 'xo', 'uom', 'location'],
            ['part', 'tag', 'serial', 'location', 'inventory', 'qtyon', 'uom', 'xoitem', 'xostatus', 'xotype',
                'xoitemstatus', 'costlayer', 'tracking', 'cyclecount', 'transfer', 'lot']],
        ['accounting',
            ['payment', 'currency', 'terms'],
            ['account', 'gl', 'journal', 'payment', 'currency', 'taxrate', 'tax', 'paymentterms', 'post',
                'accounting', 'qb', 'xero', 'costing']],
        ['setup',
            ['sysuser', 'property', 'company', 'address', 'country', 'state'],
            ['sysuser', 'user', 'customfield', 'customset', 'customvalue', 'customlist', 'property', 'country',
                'stateconst', 'address', 'company', 'report', 'module', 'plugin', 'setting', 'group', 'access',
                'right', 'email', 'memo']]
    ];

    function areaOf(table) {
        const t = lc(table);
        for (const [area, names] of AREA_RULES) if (names.includes(t)) return area;
        for (const [area, , starts] of AREA_RULES) if (starts.some(s => t.startsWith(s))) return area;
        return 'other';
    }

    function areaName(key) {
        return AREA_NAMES[lc(key)] || AREA_NAMES.other;
    }

    // ── DIAGRAMS ───────────────────────────────────────────────────────
    //
    // Never the whole schema: 320 tables and 520 links drawn at once is a
    // hairball nobody can read. A diagram is about one table, or about the
    // tables one query uses, with their neighbours around them.
    //
    // The layout is by direction, not by physics: what a table points at is
    // to its right, what points at it is to its left. The same table comes
    // out in the same place every time, and "soitem is left of so" reads as
    // "soitem belongs to so" without having to follow a line.
    //
    // A node's column: 0 is the table the diagram is about, positive columns
    // are tables it points at (its parents), negative ones tables that point
    // at it (its children); a second step goes a column further out. Its row
    // is top to bottom within the column.

    const MAX_NODES = 40;

    // How many tables "Show its links" may add beyond MAX_NODES: room for
    // what was asked for, but not without end, since a table like part links
    // to dozens.
    const EXPAND_ROOM = 20;

    /**
     * A small table of labels: sostatus, parttype, uom. Nearly every table
     * points at a few of them, so shown they crowd out the tables the diagram
     * is actually about. "Small" is a name column, few columns in all, and no
     * foreign keys of its own.
     */
    function isLookup(snapshot, table) {
        const e = snapshot ? snapshot._entry(table) : null;
        return !!e
            && e.columns.length <= 4
            && e.columns.some(c => lc(c) === 'name')
            && outgoing(snapshot, table).length === 0;
    }

    function emptyGraph() {
        return { nodes: [], edges: [], trimmed: 0, lookupsHidden: 0 };
    }

    /** The node for a table in a graph, or null. */
    function node(graph, table) {
        return (graph && graph.nodes.find(n => same(n.table, table))) || null;
    }

    // Placement: lower-cased name -> { table, col }, in the order placed,
    // which decides the order of the columns' groups.
    function placeAt(column, table, col) {
        column.set(lc(table), { table, col });
    }

    /** A table's parents, a column to its right, and its children, a column to its left, alphabetically. */
    function neighbours(snapshot, table) {
        const all = outgoing(snapshot, table).map(f => ({ table: f.refTable, side: 1 }))
            .concat(incoming(snapshot, table).map(f => ({ table: f.table, side: -1 })))
            .filter(x => !same(x.table, table));
        const seen = new Set();
        return all.filter(x => !seen.has(lc(x.table)) && seen.add(lc(x.table)))
            .sort((a, b) => byIgnoreCase(a.table, b.table));
    }

    function aroundOnly(snapshot, focus, depth, hideLookups) {
        const column = new Map();
        const graph = emptyGraph();
        if (!snapshot || !snapshot.hasTable(focus)) return { graph, column };
        focus = snapshot.name(focus);

        placeAt(column, focus, 0);
        let frontier = [focus];
        const hidden = new Map();
        const steps = Math.max(1, Number(depth) || 0);

        for (let step = 1; step <= steps && frontier.length > 0; step++) {
            const next = [];
            for (const table of frontier) {
                // Parents to the right, children to the left, nearest first,
                // alphabetical within a step so the diagram is repeatable.
                const around = outgoing(snapshot, table).map(f => ({ other: f.refTable, side: 1 }))
                    .concat(incoming(snapshot, table).map(f => ({ other: f.table, side: -1 })))
                    .sort((a, b) => byIgnoreCase(a.other, b.other));

                for (const { other, side } of around) {
                    if (column.has(lc(other)) || hidden.has(lc(other))) continue;
                    if (hideLookups && isLookup(snapshot, other)) { hidden.set(lc(other), other); continue; }
                    if (column.size >= MAX_NODES) { graph.trimmed++; hidden.set(lc(other), other); continue; }
                    placeAt(column, other, column.get(lc(table)).col + side);
                    next.push(other);
                }
            }
            frontier = next;
        }

        graph.lookupsHidden = hideLookups
            ? Array.from(hidden.values()).filter(t => isLookup(snapshot, t)).length
            : 0;
        return { graph: finish(snapshot, graph, column, focus), column };
    }

    /**
     * One table and its neighbours, up to depth steps out, plus any picked
     * tables and the tables linking them in. Picked is the tables picked for
     * a query: re-centring on the next table along mustn't drop the ones
     * already picked, or so, pickitem and pick (three steps apart) could
     * never all be picked at once.
     *
     * Expand is tables whose own neighbours are drawn too, a step out from
     * wherever the table is: what "Show its links" asks for, to see what lies
     * beyond a table without making it the one the diagram is about.
     */
    function graphAround(snapshot, focus, depth = 1, hideLookups = false, picked = [], expand = []) {
        const { graph, column } = aroundOnly(snapshot, focus, depth, hideLookups);
        if (graph.nodes.length === 0) return graph;

        let added = false;
        for (const k of picked || []) {
            const table = snapshot.name(k);
            if (table === null || column.has(lc(table))) continue;
            // The chain of keys from a table already placed to the one
            // picked: the same one Write query would join along.
            const path = findPath(snapshot, Array.from(column.values(), p => p.table), table, 4);
            if (!path) continue;
            for (const s of path) {
                if (column.has(lc(s.to))) continue;
                placeAt(column, s.to, column.get(lc(s.from)).col + (s.up ? 1 : -1));
                added = true;
            }
        }
        for (const e of expand || []) {
            const table = snapshot.name(e);
            if (table === null || !column.has(lc(table))) continue;
            const at = column.get(lc(table)).col;
            for (const n of neighbours(snapshot, table)) {
                if (column.has(lc(n.table)) || (hideLookups && isLookup(snapshot, n.table))) continue;
                if (column.size >= MAX_NODES + EXPAND_ROOM) { graph.trimmed++; continue; }
                placeAt(column, n.table, at + n.side);
                added = true;
            }
        }
        if (!added) return graph;

        const again = emptyGraph();
        again.trimmed = graph.trimmed;
        again.lookupsHidden = graph.lookupsHidden;
        return finish(snapshot, again, column, graph.nodes.find(n => n.isFocus).table);
    }

    /**
     * The tables a query names, and how they connect: its joins, drawn. Laid
     * out from the first table named, in the same left-and-right order.
     * Tables the keys don't connect to the rest go in a column of their own.
     */
    function graphOf(snapshot, tables, hideLookups = false) {
        const graph = emptyGraph();
        if (!snapshot) return graph;
        const seen = new Set();
        const set = [];
        for (const t of tables || []) {
            if (!snapshot.hasTable(t)) continue;
            const name = snapshot.name(t);
            if (seen.has(lc(name))) continue;
            seen.add(lc(name));
            if (hideLookups && isLookup(snapshot, name)) continue;
            if (set.length < MAX_NODES) set.push(name);
        }
        if (set.length === 0) return graph;

        const inSet = new Set(set.map(lc));
        const column = new Map();
        placeAt(column, set[0], 0);
        const queue = [set[0]];
        while (queue.length > 0) {
            const table = queue.shift();
            for (const f of snapshot.foreignKeys) {
                let other = null;
                let side = 0;
                if (same(f.table, table) && inSet.has(lc(f.refTable))) { other = f.refTable; side = 1; }
                else if (same(f.refTable, table) && inSet.has(lc(f.table))) { other = f.table; side = -1; }
                if (other === null || column.has(lc(other))) continue;
                placeAt(column, other, column.get(lc(table)).col + side);
                queue.push(other);
            }
        }

        // Unconnected: one column past the rightmost, so they are visibly apart.
        const spare = Math.max(...Array.from(column.values(), p => p.col)) + 1;
        for (const t of set) if (!column.has(lc(t))) placeAt(column, t, spare);

        return finish(snapshot, graph, column, set[0]);
    }

    /** Rows within each column, what each box lists, and the lines between boxes. */
    function finish(snapshot, graph, column, focus) {
        const included = new Set(column.keys());

        const groups = new Map();
        for (const p of column.values()) {
            if (!groups.has(p.col)) groups.set(p.col, []);
            groups.get(p.col).push(p);
        }

        for (const members of groups.values()) {
            let row = 0;
            for (const p of members.slice().sort((a, b) => byIgnoreCase(a.table, b.table))) {
                const table = p.table;
                const keys = snapshot.primaryKeys(table);
                const out = outgoing(snapshot, table);
                // The links to tables in this diagram, since those are the
                // ones with a line to follow; the rest are counted, not listed.
                const links = out.filter(f => included.has(lc(f.refTable)))
                    .map(f => ({ column: f.column, refTable: f.refTable }));
                // Keys to lookup tables left out of the diagram. so.statusId is
                // a number that means nothing on its own; sostatus is hidden to
                // keep the diagram readable, but its name is still what someone
                // picking statusId wants, so the link stays in the box.
                const lookups = out.filter(f => !included.has(lc(f.refTable)) && isLookup(snapshot, f.refTable))
                    .map(f => ({ column: f.column, refTable: f.refTable }));
                const listed = new Set(keys.concat(links.map(l => l.column), lookups.map(l => l.column)).map(lc));
                // The table's other columns, in table order: hidden behind
                // "+ n more" until the box is opened, and there to pick for a
                // query once it is.
                const others = snapshot.columns(table).filter(c => !listed.has(lc(c)));
                graph.nodes.push({
                    table,
                    column: p.col,
                    row: row++,
                    isFocus: same(table, focus),
                    keys,
                    links,
                    lookups,
                    others
                });
            }
        }

        graph.edges = snapshot.foreignKeys
            .filter(f => included.has(lc(f.table)) && included.has(lc(f.refTable)))
            .map(copyKey);
        return graph;
    }

    // ── KEY PATHS ──────────────────────────────────────────────────────
    //
    // The best chain of foreign keys from one set of tables to another table:
    // what Write query joins along, and how the diagram links a kept table in.
    //
    // Shortest is not the same as best. part and so are two steps apart
    // through taxrate, since each has a tax rate: part.taxId → taxrate ←
    // so.taxRateId. That join pairs every order with every part that shares
    // its tax rate, which is nobody's question. The meaningful path is three
    // steps, part ← product ← soitem → so: the order lines that sell the part.
    //
    // The difference is the turn. Going up a key to a parent and then back
    // down another key to a different child joins two things only because
    // they share a parent. Going down to a child and back up (soitem joining
    // so and product) joins two things one row is actually about. So a path
    // pays for each up-then-down turn as though it were two steps more, and
    // the clean three-step path beats the turning two-step one. A turn is
    // still taken when nothing else links the two within reach: so →
    // customer ← customerparts, the parts an order's customer is set up to
    // buy, can be what was meant.
    //
    // Between paths of the same length, the one that climbs less wins. part
    // reaches so in three clean steps two ways: down through product to the
    // order lines, then up to their order; or down to moitem and up twice, to
    // the manufacture order and the sales order it was made for. The first is
    // what "the orders for this part" means; the second is a detour through a
    // header. So each step costs ten, a climb one more, a turn twenty more.

    const MAX_STEPS = 3;
    const STEP_COST = 10;
    const CLIMB_COST = 1;
    const TURN_COST = 20;

    // What a way through a table nobody chose costs, beyond its step: less
    // than a step, so it only settles a tie. part reaches vendor in two clean
    // steps through vendorparts or through vendorcostrule, and which of two
    // equal paths was found first is no reason to pick one; the one through a
    // table on the diagram, or one picked anyway, is what was meant.
    const ASIDE_COST = 5;

    // A binary heap, standing in for .NET's PriorityQueue.
    class Heap {
        constructor(compare) { this.items = []; this.compare = compare; }
        get size() { return this.items.length; }
        push(item) {
            const a = this.items;
            a.push(item);
            let i = a.length - 1;
            while (i > 0) {
                const parent = (i - 1) >> 1;
                if (this.compare(a[i], a[parent]) >= 0) break;
                [a[i], a[parent]] = [a[parent], a[i]];
                i = parent;
            }
        }
        pop() {
            const a = this.items;
            const top = a[0];
            const last = a.pop();
            if (a.length > 0) {
                a[0] = last;
                let i = 0;
                for (;;) {
                    const l = 2 * i + 1;
                    const r = l + 1;
                    let m = i;
                    if (l < a.length && this.compare(a[l], a[m]) < 0) m = l;
                    if (r < a.length && this.compare(a[r], a[m]) < 0) m = r;
                    if (m === i) break;
                    [a[i], a[m]] = [a[m], a[i]];
                    i = m;
                }
            }
            return top;
        }
    }

    // Start may be a table, or a list of tables, [table, climbed] pairs or
    // { table, climbed }. A table already climbed to matters: a query that
    // joined uom as the part's weight unit has climbed to it, and going on
    // down from uom to soitem is the same turn as if it were one path: order
    // lines that happen to share the part's unit. Starting afresh from uom
    // made that look like a clean two steps.
    function startsOf(start) {
        const list = typeof start === 'string' ? [start] : Array.from(start || []);
        return list.map(s => {
            if (typeof s === 'string') return { table: s, climbed: false };
            if (Array.isArray(s)) return { table: text(s[0]), climbed: !!s[1] };
            return { table: text(s && s.table), climbed: !!(s && s.climbed) };
        }).filter(s => s.table);
    }

    function stateKey(table, climbed) {
        return lc(table) + (climbed ? '|1' : '|0');
    }

    /**
     * The best path and what it costs, { steps, cost }, so paths to different
     * targets can be weighed against each other; null if nothing reaches the
     * target within maxSteps. Stepping through a table in preferred is free
     * of the aside cost; with no preference given, every table is.
     */
    function cheapestPath(snapshot, start, target, maxSteps = MAX_STEPS, preferred = null) {
        // Every key, from both of its ends, once for the whole search.
        const around = new Map();
        const add = (table, key, up, other) => {
            let list = around.get(lc(table));
            if (!list) around.set(lc(table), list = []);
            list.push({ key, up, other });
        };
        for (const f of snapshot.foreignKeys) {
            if (same(f.table, f.refTable)) continue;   // a table pointing at itself
            add(f.table, f, true, f.refTable);
            add(f.refTable, f, false, f.table);
        }
        const prefer = preferred == null ? null : new Set(Array.from(preferred, lc));

        // The state is the table and whether the path has climbed yet, since
        // the same table reached with and without a climb behind it costs
        // differently from there on. Ties go to whichever was found first, so
        // the same picks always give the same query.
        const best = new Map();
        const queue = new Heap((a, b) => a.cost - b.cost || a.steps - b.steps || a.order - b.order);
        let order = 0;
        for (const s of startsOf(start)) {
            const key = stateKey(s.table, s.climbed);
            if (best.has(key)) continue;
            best.set(key, { cost: 0, steps: 0, back: null, via: null });
            queue.push({ table: s.table, climbed: s.climbed, cost: 0, steps: 0, order: order++ });
        }

        while (queue.size > 0) {
            const at = queue.pop();
            const atKey = stateKey(at.table, at.climbed);
            const here = best.get(atKey);
            if (at.cost !== here.cost || at.steps !== here.steps) continue;   // superseded by a better way here
            if (same(at.table, target)) return { steps: walk(best, atKey), cost: here.cost };
            const keys = around.get(lc(at.table));
            if (here.steps >= maxSteps || !keys) continue;

            for (const { key, up, other } of keys) {
                const climbed = at.climbed || up;
                const nextKey = stateKey(other, climbed);
                const aside = prefer !== null && !same(other, target) && !prefer.has(lc(other));
                const nextCost = here.cost + STEP_COST + (up ? CLIMB_COST : 0)
                    + (at.climbed && !up ? TURN_COST : 0) + (aside ? ASIDE_COST : 0);
                const nextSteps = here.steps + 1;
                const seen = best.get(nextKey);
                if (seen && (seen.cost < nextCost || (seen.cost === nextCost && seen.steps <= nextSteps))) continue;
                best.set(nextKey, { cost: nextCost, steps: nextSteps, back: atKey, via: { from: at.table, to: other, key, up } });
                queue.push({ table: other, climbed, cost: nextCost, steps: nextSteps, order: order++ });
            }
        }
        return null;
    }

    function walk(best, end) {
        const steps = [];
        let at = end;
        for (let e = best.get(at); e && e.back !== null && e.via; e = best.get(at)) {
            steps.push({ from: e.via.from, to: e.via.to, key: copyKey(e.via.key), up: e.via.up });
            at = e.back;
        }
        return steps.reverse();
    }

    /** The steps from whichever start is best placed to the target, or null if none reaches it within maxSteps. */
    function findPath(snapshot, start, target, maxSteps = MAX_STEPS) {
        const found = cheapestPath(snapshot, start, target, maxSteps);
        return found ? found.steps : null;
    }

    // ── WRITE QUERY ────────────────────────────────────────────────────

    // Either { table, column } or [table, column].
    function pairsOf(list) {
        return Array.from(list || [], p => Array.isArray(p)
            ? { table: text(p[0]), column: text(p[1]) }
            : { table: text(p && p.table), column: text(p && p.column) });
    }

    /**
     * A short alias: the initials of the words run together in the name
     * (soitem is si, partcost pc), or its first letter, made unique.
     */
    function makeAlias(table, taken) {
        const words = ['item', 'type', 'status', 'cost', 'tracking', 'group', 'order', 'line'];
        const name = text(table);
        let initials = name.charAt(0);
        for (const w of words) if (lc(name).indexOf(w, 1) > 0) initials += w.charAt(0);
        const base = initials.toLowerCase();
        const used = new Set(Array.from(taken.values(), lc));
        let n = 2;
        let candidate = base;
        while (used.has(lc(candidate)) || isKeyword(candidate)) candidate = base + n++;
        return candidate;
    }

    /** statusId's name is statusName: the id's own word, with Name for Id. */
    function nameFor(column, lookup) {
        return column.length > 2 && column.endsWith('Id') ? column.slice(0, -2) + 'Name' : lookup + 'Name';
    }

    /**
     * What each column should be called in the results, or null where the
     * name it already has will do.
     *
     * pick.num and part.num both come back as "num", and the results table
     * can't show two columns of one name: one hides the other, and which num
     * is which is anyone's guess. So every column of a shared name is named
     * after its table as well, pickNum and partNum, the way Fishbowl names
     * its own copies (soitem.productNum). A name that is still taken, by a
     * column picked under that name, gets a number. A lookup's name is always
     * renamed, since "name" alone says nothing.
     */
    function resultNames(outputs) {
        const counts = new Map();
        for (const o of outputs) counts.set(lc(o.name), (counts.get(lc(o.name)) || 0) + 1);
        const shared = new Set(Array.from(counts.entries()).filter(([, n]) => n > 1).map(([k]) => k));

        const taken = new Set(outputs.filter(o => !shared.has(lc(o.name))).map(o => lc(o.name)));
        return outputs.map(o => {
            if (!shared.has(lc(o.name))) return o.renamed ? o.name : null;
            const name = o.table + o.name.charAt(0).toUpperCase() + o.name.slice(1);
            let candidate = name;
            for (let n = 2; taken.has(lc(candidate)); n++) candidate = name + n;
            taken.add(lc(candidate));
            return candidate;
        });
    }

    /**
     * A SELECT that joins the tables picked in the schema diagram, or null
     * when there is nothing to write.
     *
     * Joined along the declared keys, nearest first: after the first table
     * picked, whichever picked table is best linked to those already joined
     * goes next, so a picked table links the others where it can. Picked
     * part, vendor and vendorparts, in that order, used to join vendor to
     * part through vendorcostrule, a table nobody picked or could see,
     * because vendorparts wasn't in the query yet; vendorparts joins part
     * directly, and then vendor joins vendorparts. When two picked tables
     * have no key between them, the path through other tables is taken (up to
     * three steps) and those tables are joined too, since that is the join
     * someone would have had to work out by hand. Between equal paths, the
     * one through a table on the diagram wins, and one through a table that
     * isn't there is named in a comment under the query.
     *
     * The columns are the ones picked (pickedColumns, { table, column }). A
     * picked table with none picked gets the one column that best says which
     * row is which; a table that is only there to link two picked ones gets
     * none, since its id says nothing. Every join between picked tables is an
     * inner join: making one LEFT is quicker than looking up which column
     * joins to which.
     *
     * pickedLookupNames ({ table, column }) are picked columns that are keys
     * to a lookup table and are wanted as the lookup's name rather than its
     * id: so.statusId as the status's name.
     *
     * drawnTables are the tables on the diagram, preferred as the way
     * through. Empty means no preference, and no comments about tables off
     * the diagram, since a diagram always shows at least the picked tables.
     */
    function writeJoin(snapshot, selected, pickedColumns = [], pickedLookupNames = [], drawnTables = []) {
        if (!snapshot) return null;
        const tables = [];
        for (const t of selected || []) {
            const name = snapshot.name(t);
            if (name !== null && !tables.some(x => same(x, name))) tables.push(name);
        }
        if (tables.length === 0) return null;

        const drawn = Array.from(drawnTables || [], text);
        const shown = drawn.length > 0 ? drawn : null;
        const columns = pairsOf(pickedColumns);
        const lookupNames = pairsOf(pickedLookupNames);

        // Aliases for the picked tables in the order they were picked, before
        // any is joined: joining nearest first can join a later pick sooner,
        // and part, vendor, vendorparts should still read p, v, v2.
        const alias = new Map();
        for (const t of tables) alias.set(lc(t), makeAlias(t, alias));
        const joined = new Set([lc(tables[0])]);
        const order = [tables[0]];
        const joins = [];
        const unjoined = [];
        // Which joined tables were reached by climbing to a parent, so the
        // next path from them pays for turning back down.
        const climbed = new Map([[lc(tables[0]), false]]);

        // The ways through worth taking: the tables picked, and those drawn.
        const preferred = new Set(tables.map(lc));
        if (shown) for (const t of shown) preferred.add(lc(t));
        // A table joined only to link two picked ones, and which two.
        const links = [];

        let remaining = tables.slice(1);
        while (remaining.length > 0) {
            // The picked table best linked to those already in the query, the
            // earlier picked on a tie, so the same picks give the same query.
            let next = null;
            for (const target of remaining) {
                const found = cheapestPath(snapshot, order.map(t => ({ table: t, climbed: climbed.get(lc(t)) })),
                    target, MAX_STEPS, preferred);
                if (found && (next === null || found.cost < next.cost)) next = { target, steps: found.steps, cost: found.cost };
            }

            if (next === null) {
                unjoined.push(...remaining);
                break;
            }

            for (const { from, to, key, up } of next.steps) {
                if (joined.has(lc(to))) continue;
                joined.add(lc(to));
                if (!alias.has(lc(to))) alias.set(lc(to), makeAlias(to, alias));
                order.push(to);
                climbed.set(lc(to), climbed.get(lc(from)) || up);
                if (!same(to, next.target) && !preferred.has(lc(to))) {
                    links.push({ table: to, from: next.steps[0].from, to: next.target });
                }
                // The key is child.column -> parent.id, whichever of the two
                // is the table being added.
                const a = alias.get(lc(to));
                const b = alias.get(lc(from));
                const on = same(key.table, to)
                    ? `${a}.${key.column} = ${b}.${key.refColumn}`
                    : `${a}.${key.refColumn} = ${b}.${key.column}`;
                joins.push(`JOIN ${to} ${a} ON ${on}`);
            }
            // Picked tables passed through on the way are joined already.
            remaining = remaining.filter(t => !joined.has(lc(t)));
        }

        // Picked tables only, in the order they were picked, whatever order
        // they were joined in; each with its picked columns in the order they
        // were picked, or its one identifying column.
        const outputs = [];
        const lookupJoins = [];
        for (const t of tables.filter(x => joined.has(lc(x)))) {
            const all = snapshot.columns(t);
            const chosen = [];
            for (const c of columns) {
                if (!same(c.table, t)) continue;
                const col = all.find(k => same(k, c.column));
                if (col !== undefined && !chosen.some(x => same(x, col))) chosen.push(col);
            }
            for (const c of chosen.length > 0 ? chosen : [identifying(snapshot, t)]) {
                const lookup = lookupNames.some(n => same(n.table, t) && same(n.column, c))
                    ? lookupName(snapshot, t, c)
                    : null;
                if (!lookup) {
                    outputs.push({ table: t, expression: alias.get(lc(t)) + '.' + c, name: c, renamed: false });
                    continue;
                }

                // A join of its own for each, even to a lookup already joined
                // for another column: so.statusId and soitem.statusId are two
                // different statuses. LEFT, because an id left empty is a row
                // still wanted, and an inner join would drop it without a
                // word. The key is recorded under "table.column", which no
                // table name can be, so its alias is kept apart from the
                // tables'.
                const la = makeAlias(lookup.table, alias);
                alias.set(lc(t + '.' + c), la);
                lookupJoins.push(`LEFT JOIN ${lookup.table} ${la} ON ${la}.${lookup.key} = ${alias.get(lc(t))}.${c}`);
                outputs.push({ table: t, expression: la + '.' + lookup.name, name: nameFor(c, lookup.table), renamed: true });
            }
        }

        const names = resultNames(outputs);
        const select = outputs.map((o, i) => o.expression + (names[i] !== null ? ' AS ' + names[i] : ''));

        const lines = ['SELECT ' + select.join(', '), `FROM ${order[0]} ${alias.get(lc(order[0]))}`];
        lines.push(...joins, ...lookupJoins);
        // Said, since it's in the query but nowhere on the diagram.
        if (shown) {
            for (const l of links) lines.push(`-- ${l.table} isn't on the diagram: it's joined to link ${l.from} and ${l.to}`);
        }
        for (const t of unjoined) {
            lines.push(`-- ${t}: no keys link it to the tables above within ${MAX_STEPS} steps, so it isn't joined`);
        }
        return lines.join('\n');
    }

    /** The lookup a column is a key to, { table, name, key }: that lookup, its name column and the key it is joined on; or null. */
    function lookupName(snapshot, table, column) {
        const f = snapshot._refersTo(table, column);
        if (!f || !isLookup(snapshot, f.refTable)) return null;
        const name = snapshot.columns(f.refTable).find(c => same(c, 'name'));
        return { table: f.refTable, name, key: f.refColumn };
    }

    /**
     * The one column that best says which row is which, when none was
     * picked; null for a table the snapshot doesn't have.
     *
     * In order: the table's own number or name; then a copy of another
     * table's (soitem.productNum, a line's partNum); then the id of the thing
     * it is about, when that thing has a number or name of its own
     * (pickitem.partId); and only then its own id, which says nothing.
     */
    function identifying(snapshot, table) {
        if (!snapshot || !snapshot.hasTable(table)) return null;
        const cols = snapshot.columns(table);
        const named = n => cols.find(c => same(c, n));

        for (const preferred of ['num', 'name', 'number', 'code', 'description']) {
            const hitCol = named(preferred);
            if (hitCol !== undefined) return hitCol;
        }

        const copy = cols.find(c => c.length > 3 && (c.endsWith('Num') || c.endsWith('Name')));
        if (copy !== undefined) return copy;

        // Not the line's own header: soitem.soId says which order, not which
        // line, and the same for pickitem.pickId and poitem.poId.
        for (const f of outgoing(snapshot, table)) {
            if (lc(table).startsWith(lc(f.refTable))) continue;
            if (snapshot.hasTable(f.refTable)
                && snapshot.columns(f.refTable).some(c => same(c, 'num') || same(c, 'name'))
                && !isLookup(snapshot, f.refTable)) {
                return f.column;
            }
        }

        const id = named('id');
        return id !== undefined ? id : (cols.length ? cols[0] : null);
    }

    // ── THE BROWSER ────────────────────────────────────────────────────

    /**
     * The schema, filtered for the browser: [{ name: 'Tables' | 'Views',
     * items: [{ name, isView, isHeavy, expanded, columns: [{ table, name,
     * isKey, refersTo, insert }] }] }].
     *
     * A Fishbowl database has several hundred tables and tens of thousands
     * of columns, so the browser is only useful with a filter in front of
     * it. A term matches a table by name, and also matches a table whose
     * COLUMNS match, with those columns pre-expanded, since finding which
     * table holds qtyCommitted is most of what anyone opens this for.
     *
     * Views are listed apart from tables. Mixed in they are easy to query by
     * accident, and some of them are far more expensive than they look.
     */
    function browse(snapshot, filter, maxEach = 400) {
        if (!snapshot) return [];
        const term = lc(text(filter).trim());
        const tables = [];
        const views = [];

        for (const name of snapshot.tableNames()) {
            const view = snapshot.isView(name);
            const into = view ? views : tables;
            if (into.length >= maxEach) continue;
            const columns = snapshot.columns(name);

            if (term.length === 0) {
                into.push(browseItem(snapshot, name, columns, false));
                continue;
            }

            const nameHit = lc(name).includes(term);
            const columnHits = columns.filter(c => lc(c).includes(term));
            if (!nameHit && columnHits.length === 0) continue;

            // Matched by name: keep every column, collapsed. Matched only
            // through a column: show just the ones that matched, expanded, so
            // the reason it is in the list is visible without a click.
            into.push(browseItem(snapshot, name, nameHit ? columns : columnHits, !nameHit));
        }

        const groups = [];
        if (tables.length > 0) groups.push({ name: 'Tables', items: tables });
        if (views.length > 0) groups.push({ name: 'Views', items: views });
        return groups;
    }

    function browseItem(snapshot, name, columns, expanded) {
        return {
            name,
            isView: snapshot.isView(name),
            isHeavy: snapshot.isHeavy(name),
            expanded,
            // Qualified, because that is what a join needs.
            columns: columns.map(c => ({
                table: name,
                name: c,
                isKey: snapshot.isKey(name, c),
                refersTo: snapshot.refersTo(name, c),
                insert: name + '.' + c
            }))
        };
    }

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    /** A one-line summary for the browser's header. */
    function describe(snapshot, groups) {
        if (!snapshot) return 'Not loaded — connect, then Refresh.';
        const count = n => {
            const g = (groups || []).find(x => x.name === n);
            return g ? g.items.length : 0;
        };
        const totalTables = snapshot.tableCount - snapshot.viewCount;
        const d = new Date(snapshot.loadedAt);
        const two = n => String(n).padStart(2, '0');
        return count('Tables') + ' of ' + totalTables + ' tables  ·  ' +
            count('Views') + ' of ' + snapshot.viewCount + ' views  ·  ' +
            snapshot.columnCount.toLocaleString() + ' columns  ·  read ' +
            d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
    }

    /** The hover text for a column in the browser. */
    function columnHint(snapshot, table, column) {
        const f = snapshot.refersTo(table, column);
        if (f) {
            return 'Holds an id from ' + f.refTable + '.' + f.refColumn + '. Join with ON ' + table + '.' + column +
                ' = ' + f.refTable + '.' + f.refColumn + '.';
        }
        return snapshot.isKey(table, column) ? 'The primary key of ' + table + '.' : table + '.' + column;
    }

    /** The hover text for a key in another table that points at this one. */
    function referenceHint(fk) {
        return fk.table + '.' + fk.column + ' holds an id from ' + fk.refTable + '.' + fk.refColumn + '.';
    }

    /** The hover text for a table or view. */
    function tableHint(snapshot, table) {
        if (!snapshot.isView(table)) return 'A table.';
        return snapshot.isHeavy(table)
            ? 'A view built with GROUP BY, UNION or DISTINCT. MySQL assembles the whole thing ' +
              'before applying your WHERE, so filtering it is not cheap — filter the underlying ' +
              'tables instead when it matters.'
            : 'A view. This one filters normally.';
    }

    const Schema = {
        QUERIES, CACHE_VERSION, load, fromRows, Snapshot,
        areaOf, areaName, AREAS,
        isLookup, graphAround, graphOf, node, MAX_NODES, EXPAND_ROOM,
        findPath, cheapestPath, MAX_STEPS,
        writeJoin, lookupName, identifying,
        KEYWORDS, isKeyword, aliases, tablesInOrder, atJoinCondition, joinConditions, related, inScope,
        place, prefersColumns, suggest, kindLabel,
        browse, describe, columnHint, referenceHint, tableHint
    };
    if (typeof module === 'object' && module.exports) module.exports = Schema; else root.Schema = Schema;
})(this);
