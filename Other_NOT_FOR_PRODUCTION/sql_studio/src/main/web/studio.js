/*
 * SQL Studio: the page. A SQL workspace over the client's own session, in
 * place of the Data module: schema browser, completion, formatter and linter,
 * styled results, and the schema diagram with click-to-write-query.
 *
 * Everything it reaches Fishbowl through is a BI bridge function the panel
 * already provides (runQueryAsync, runRestApiAsync, loadSettings,
 * saveSettings), so the page also opens in the plain BI Reports viewer.
 *
 * Reads go to /api/data-query when the REST connection allows it: that keeps
 * the column names as the statement spelt them, where runQueryAsync lower-cases
 * them. Writes (admin only, UPDATE and INSERT) go to the REST write path and
 * nowhere else; when the server refuses them they are simply not supported.
 */
(function () {
    'use strict';

    const HOST = window.FB_STUDIO || { v: 1, version: 'dev', user: '', userId: 0, admin: false };
    const STORE_KEY = 'cdx.sqlstudio.user.v1';
    const READ_PATH = '/api/data-query';
    const WRITE_PATH = '/api/unsafe/deprecated/data-query';
    // Query-string form only: it is the one with a working witness, and a GET
    // body isn't something every client sends. Longer statements read through
    // runQueryAsync instead.
    const MAX_URL_SQL = 6000;
    const MAX_HISTORY = 40;
    const PAGE_ROWS = 1000;
    const NOT_SUPPORTED = 'UPDATE, INSERT and DELETE statements are not supported.';

    const $ = id => document.getElementById(id);
    const lc = s => String(s == null ? '' : s).toLowerCase();
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const has = name => typeof window[name] === 'function';

    // =====================================================================
    // Settings: per user, through the bridge (never localStorage, which the
    // client clears). Saved a second after the last change.
    // =====================================================================
    const store = {
        data: { sql: '', limit: '500', sideWidth: 290, editorHeight: null, history: [], saved: [],
                diagram: { table: '', depth: 1, hideLookups: true, follow: false } },
        timer: null,
        load() {
            try {
                const raw = has('loadSettings') ? window.loadSettings(STORE_KEY) : null;
                if (raw) Object.assign(this.data, JSON.parse(raw));
            } catch (e) { /* first run, or unreadable: start clean */ }
            this.data.diagram = Object.assign({ table: '', depth: 1, hideLookups: true, follow: false }, this.data.diagram);
        },
        save() {
            clearTimeout(this.timer);
            this.timer = setTimeout(() => this.flush(), 1000);
        },
        flush() {
            clearTimeout(this.timer);
            this.timer = null;
            try { if (has('saveSettings')) window.saveSettings(STORE_KEY, JSON.stringify(this.data)); }
            catch (e) { log('error', 'Your settings could not be saved: ' + errText(e)); }
        }
    };
    // A change made in the last second before Reload or leaving the module is kept too.
    window.addEventListener('pagehide', () => { if (store.timer) store.flush(); });

    // =====================================================================
    // Messages, toast, modal
    // =====================================================================
    let unseen = 0;
    function log(kind, text, sql) {
        const box = $('messages');
        const row = document.createElement('div');
        row.className = 'msg ' + kind;
        const t = new Date();
        row.innerHTML = '<time>' + t.toTimeString().slice(0, 8) + '</time><div><div class="text">' + esc(text) + '</div>'
            + (sql ? '<pre>' + esc(sql) + '</pre>' : '') + '</div>';
        box.prepend(row);
        if (kind === 'error' && currentLowerTab() !== 'messages') {
            unseen++;
            $('msgCount').textContent = String(unseen);
            $('msgCount').hidden = false;
        }
    }

    let toastTimer = null;
    function toast(text) {
        const t = $('toast');
        t.textContent = text;
        t.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
    }

    /** An in-page dialog (the client's native ones would block the whole client). Resolves to the button's value. */
    function dialog({ title, html, buttons, focus, validate }) {
        return new Promise(resolve => {
            const back = $('modalBack');
            const m = $('modal');
            m.innerHTML = '<h2>' + esc(title) + '</h2><div class="body">' + html
                + '<p class="dlg-error" style="color:var(--red)" hidden></p></div><div class="foot"></div>';
            const foot = m.querySelector('.foot');
            const close = v => {
                // validate: a problem to show (the dialog stays open), or nothing.
                const problem = v && validate ? validate(v) : null;
                if (problem) {
                    const p = m.querySelector('.dlg-error');
                    p.textContent = problem;
                    p.hidden = false;
                    return;
                }
                back.hidden = true; document.removeEventListener('keydown', onKey, true);
                // Back to where the keyboard was, so Ctrl+Enter in the editor still runs.
                if (returnTo && returnTo.isConnected) returnTo.focus();
                resolve(v);
            };
            const returnTo = document.activeElement;
            const onKey = e => {
                // An open picker list has Escape and Enter for itself.
                const pick = e.target.closest && e.target.closest('.prm-pick');
                if (pick && !pick.querySelector('.prm-list').hidden && (e.key === 'Enter' || e.key === 'Escape')) return;
                if (e.key === 'Escape') { e.preventDefault(); close(null); }
                if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); const p = buttons.find(b => b.primary); if (p) close(p.value); }
            };
            buttons.forEach(b => {
                const el = document.createElement('button');
                el.className = b.cls || (b.primary ? 'primary' : 'tool');
                el.textContent = b.text;
                el.addEventListener('click', () => close(b.value));
                foot.appendChild(el);
            });
            back.hidden = false;
            document.addEventListener('keydown', onKey, true);
            const f = focus ? m.querySelector(focus) : foot.lastChild;
            if (f) f.focus();
        });
    }

    async function ask(title, text, yes, no) {
        return await dialog({ title, html: '<p>' + esc(text) + '</p>',
            buttons: [{ text: no || 'Cancel', value: false }, { text: yes, value: true, primary: true }] }) === true;
    }

    function errText(e) {
        if (e == null) return 'Unknown error';
        if (typeof e === 'string') return e;
        return e.message || e.statusMessage || e.error || (e.status ? 'HTTP ' + e.status : JSON.stringify(e));
    }

    // =====================================================================
    // Editor
    // =====================================================================
    const ta = $('sql');
    const pre = $('highlight');
    const gutter = $('gutter');
    let lintIssues = [];

    // The values the last run gave its parameters, shown in grey after each
    // one until the editor is clicked or typed in: token -> { type, value, label }.
    let shownParams = null;

    /**
     * The overlay: SqlText's colouring, with the parameter values after their
     * parameters. Built from the tokens rather than from highlightHtml, so a
     * value can go in the middle of a token (a parameter inside a string).
     * The values push the rest of their line along, which the textarea under
     * it doesn't see; that is why they go as soon as the editor is used.
     */
    function overlayHtml(text) {
        if (!shownParams || !shownParams.size) return SqlText.highlightHtml(text);
        const marks = [];   // { at, html }: after these offsets
        text.replace(PARAM, (tok, code, title, def, at) => {
            const p = shownParams.get(tok);
            if (!p) return tok;
            let v;
            if (p.type.pick) v = useAt(text, { m: tok, type: p.type }, at) === 'label' ? "'" + p.label + "'" : p.value + ' (' + p.label + ')';
            else v = p.value;
            marks.push({ at: at + tok.length, html: '<span class="prm-shown"> = ' + esc(v) + '</span>' });
            return tok;
        });
        let html = '', k = 0;
        SqlText.tokenize(text).forEach(t => {
            const end = t.start + t.text.length;
            let from = t.start;
            const wrap = s => (t.kind === 'plain' ? esc(s) : '<span class="tk-' + t.kind + '">' + esc(s) + '</span>');
            for (; k < marks.length && marks[k].at <= end; k++) {
                html += wrap(text.slice(from, marks[k].at)) + marks[k].html;
                from = marks[k].at;
            }
            if (from < end) html += wrap(text.slice(from, end));
        });
        return html;
    }

    function hideParams() {
        if (!shownParams) return;
        shownParams = null;
        paint();
    }

    function paint() {
        const text = ta.value;
        // A trailing newline needs a character after it, or the overlay's last line collapses.
        pre.innerHTML = overlayHtml(text) + '\n ';
        const lines = text.split('\n').length;
        const errLines = new Set(lintIssues.filter(i => i.severity === 'error').map(i => lineOf(text, i.start)));
        let g = '';
        for (let i = 1; i <= lines; i++) g += (errLines.has(i) ? '<span class="err">' + i + '</span>' : i) + '\n';
        gutter.innerHTML = g;
        syncScroll();
    }

    function syncScroll() {
        pre.scrollTop = ta.scrollTop;
        pre.scrollLeft = ta.scrollLeft;
        gutter.scrollTop = ta.scrollTop;
    }

    function lineOf(text, offset) {
        let n = 1;
        for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
        return n;
    }

    let lintTimer = null;
    function relint() {
        clearTimeout(lintTimer);
        lintTimer = setTimeout(() => {
            try { lintIssues = SqlText.lint(ta.value, schema ? schemaLookup : undefined) || []; }
            catch (e) { lintIssues = []; }
            showLint();
            paint();
        }, 250);
    }

    const schemaLookup = {
        hasTable: t => !!(schema && schema.hasTable(t)),
        columns: t => (schema ? schema.columns(t) : [])
    };

    function showLint() {
        const chip = $('lintChip');
        const list = $('lintList');
        if (!lintIssues.length) { chip.hidden = true; list.hidden = true; return; }
        const worst = ['error', 'warning', 'info'].find(s => lintIssues.some(i => i.severity === s));
        const n = lintIssues.length;
        chip.className = 'lint-chip ' + worst;
        chip.textContent = n + (worst === 'error' ? (n === 1 ? ' problem' : ' problems') : n === 1 ? ' note' : ' notes');
        chip.hidden = false;
        list.innerHTML = lintIssues.map((i, k) =>
            '<li class="' + i.severity + '" data-k="' + k + '"><span class="sev">' + i.severity.toUpperCase()
            + '</span><span>Line ' + lineOf(ta.value, i.start) + ': ' + esc(i.message) + '</span></li>').join('');
        list.hidden = false;
    }

    $('lintList').addEventListener('click', e => {
        const li = e.target.closest('li');
        if (!li) return;
        const i = lintIssues[+li.dataset.k];
        ta.focus();
        ta.setSelectionRange(i.start, Math.max(i.start, i.end));
    });
    $('lintChip').addEventListener('click', () => { $('lintList').hidden = !$('lintList').hidden; });

    /** Replaces the editor's text as an edit, so Ctrl+Z can take it back. */
    function setText(text, select) {
        ta.focus();
        ta.select();
        if (!document.execCommand('insertText', false, text)) ta.value = text;
        if (select) ta.setSelectionRange(select[0], select[1]);
        else ta.setSelectionRange(0, 0);
        changed();
    }

    function insertAtCaret(text) {
        ta.focus();
        if (!document.execCommand('insertText', false, text)) {
            const s = ta.selectionStart;
            ta.setRangeText(text, s, ta.selectionEnd, 'end');
        }
        changed();
    }

    function changed() {
        store.data.sql = ta.value;
        store.save();
        shownParams = null;
        updateDoc();
        // An edit of a recalled query makes it the one being worked on.
        if (!recall.stepping) { recall.index = -1; updateRecall(); }
        paint();
        relint();
        if (diagram.state && store.data.diagram.follow) scheduleRedraw();
    }

    ta.addEventListener('input', () => {
        changed();
        // The text a completion just put in is not more typing: offering the
        // list again over it made the next Enter pick from it instead of
        // starting a new line.
        if (completion.inserting) return;
        maybeComplete();
    });
    ta.addEventListener('scroll', syncScroll);
    ta.addEventListener('click', closeComplete);
    ta.addEventListener('blur', () => setTimeout(closeComplete, 150));
    // Clicking back in the editor puts the text back where the caret thinks it is.
    ta.addEventListener('mousedown', hideParams);

    ta.addEventListener('keydown', e => {
        // Ctrl+Enter always runs, list or no list.
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); closeComplete(); run(); return; }
        if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); stepRecall(e.key === 'ArrowLeft' ? 1 : -1); return; }
        if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) hideParams();
        if (completion.open && handleCompletionKey(e)) return;
        if ((e.key === 'F' || e.key === 'f') && e.ctrlKey && e.shiftKey) { e.preventDefault(); format(); return; }
        if (e.key === ' ' && e.ctrlKey) { e.preventDefault(); openComplete(true); return; }
        if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); insertAtCaret('    '); return; }
        if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
            // Keep the line's indent.
            const s = ta.selectionStart;
            const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
            const indent = /^[ \t]*/.exec(ta.value.slice(lineStart, s))[0];
            e.preventDefault();
            insertAtCaret('\n' + indent);
        }
    });

    // -- previous and next: the queries run lately, newest first -----------------
    // index -1 is what was in the editor before stepping back (kept as the
    // draft, so stepping forward past the newest brings it back).
    const recall = { index: -1, draft: '', stepping: false };
    const sameSql = (a, b) => String(a).replace(/\s+/g, ' ').trim() === String(b).replace(/\s+/g, ' ').trim();

    function stepRecall(dir) {   // 1 = older, -1 = newer
        const h = store.data.history;
        let i = recall.index + dir;
        // The newest is usually what is in the editor already: step past it.
        while (i >= 0 && i < h.length && sameSql(h[i].sql, ta.value)) i += dir;
        if (i < -1 || i >= h.length) return;
        if (recall.index === -1) recall.draft = ta.value;
        recall.index = i;
        recall.stepping = true;
        try {
            const text = i === -1 ? recall.draft : h[i].sql;
            setText(text, [text.length, text.length]);
        } finally { recall.stepping = false; }
        updateRecall();
        if (i >= 0) setRunInfo('Recent query ' + (i + 1) + ' of ' + h.length + ' · run ' + new Date(h[i].at).toLocaleString()
            + (h[i].ok ? '' : ' · it failed'));
        else setRunInfo('Back to what you were writing.');
    }

    function updateRecall() {
        const h = store.data.history;
        let older = recall.index + 1;
        while (older < h.length && sameSql(h[older].sql, ta.value)) older++;
        $('btnPrevQuery').disabled = older >= h.length;
        $('btnNextQuery').disabled = recall.index === -1;
    }
    $('btnPrevQuery').addEventListener('click', () => stepRecall(1));
    $('btnNextQuery').addEventListener('click', () => stepRecall(-1));

    /** The statement the caret is in, or the whole text when there is only one. */
    function statementAtCaret() {
        const text = ta.value;
        if (ta.selectionEnd > ta.selectionStart) {
            return { text: text.slice(ta.selectionStart, ta.selectionEnd).trim(), start: ta.selectionStart, end: ta.selectionEnd };
        }
        const parts = SqlText.splitStatements(text);
        if (parts.length <= 1) return parts[0] || { text: text.trim(), start: 0, end: text.length };
        const c = ta.selectionStart;
        return parts.find(p => c >= p.start && c <= p.end + 1) || parts.filter(p => p.start <= c).pop() || parts[0];
    }

    function format() {
        const text = ta.value;
        if (!text.trim()) return;
        const parts = SqlText.splitStatements(text);
        const pretty = parts.length > 1 ? parts.map(p => SqlText.pretty(p.text)).join(';\n\n') + ';' : SqlText.pretty(text);
        if (pretty !== text) setText(pretty);
    }

    // =====================================================================
    // Completion: tables after FROM / JOIN, columns of the query's tables
    // where columns go, alias.column after a dot.
    // =====================================================================
    // chosen: the list was asked for (Ctrl+Space) or moved through with the
    // arrows. Only then does Enter take an item; otherwise Enter is a new
    // line, as it is with no list, and Tab is what takes the item. A list
    // that pops up while typing must never swallow the Enter that ends a line.
    const completion = { open: false, items: [], index: 0, from: 0, chosen: false, inserting: false };
    const completeEl = $('complete');

    /** True when the caret is inside a string or a comment, where nothing should be offered. */
    function caretInText(pos) {
        let inside = false;
        try {
            SqlText.tokenize(ta.value).some(t => {
                if (t.start >= pos) return true;
                if ((t.kind === 'string' || t.kind === 'comment') && pos > t.start && pos <= t.start + t.text.length) {
                    // At the end of a closed string the caret is outside it.
                    const closed = t.kind === 'string' && t.text.length > 1 && t.text[t.text.length - 1] === t.text[0];
                    inside = !(closed && pos === t.start + t.text.length);
                }
                return false;
            });
        } catch (e) { inside = false; }
        return inside;
    }

    function maybeComplete() {
        const before = ta.value.slice(0, ta.selectionStart);
        if (caretInText(ta.selectionStart)) { closeComplete(); return; }
        if (/\bON\s$/i.test(before)) openComplete(true);   // the join conditions the keys allow
        else if (/[A-Za-z0-9_]$|\.$/.test(before) && /([A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_]*$/.exec(before)[0].length >= (before.endsWith('.') ? 1 : 2)) openComplete(false);
        else closeComplete();
    }

    function tablesInQuery(sql) {
        if (typeof Schema.tablesInOrder === 'function') {
            try { return Schema.tablesInOrder(sql).map(t => ({ table: t.table, alias: t.qualifier && lc(t.qualifier) !== lc(t.table) ? t.qualifier : null })); }
            catch (e) { /* fall through */ }
        }
        const out = [];
        const re = /\b(?:FROM|JOIN|UPDATE|INTO)\s+`?([A-Za-z_][A-Za-z0-9_]*)`?(?:\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*))?/gi;
        let m;
        while ((m = re.exec(sql))) {
            const alias = m[2] && !/^(ON|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|GROUP|ORDER|LIMIT|SET|USING|STRAIGHT_JOIN|UNION|HAVING)$/i.test(m[2]) ? m[2] : null;
            out.push({ table: m[1], alias });
        }
        return out;
    }

    function openComplete(manual) {
        if (!schema) { closeComplete(); return; }
        const caret = ta.selectionStart;
        const before = ta.value.slice(0, caret);
        const m = /(?:([A-Za-z_][A-Za-z0-9_]*)\.)?([A-Za-z_][A-Za-z0-9_]*)?$/.exec(before);
        const qualifier = m[1];
        const word = m[2] || '';
        if (!qualifier && !word && !manual) { closeComplete(); return; }
        // fb-api-tool's own ordering (Schema.suggest): after a dot that table's
        // columns; after FROM / JOIN the tables, the ones that join first;
        // after JOIN … ON the conditions the keys allow; elsewhere the
        // statement's columns, then keywords.
        const st = statementAtCaret();
        const statement = st.text || ta.value;
        const prefixStart = caret - word.length - (qualifier ? qualifier.length + 1 : 0);
        const lineStart = ta.value.lastIndexOf('\n', prefixStart - 1) + 1;
        let ranked = [];
        try {
            ranked = Schema.suggest(schema, statement, qualifier || '', word, {
                max: 40, before: ta.value.slice(lineStart, prefixStart), allBefore: ta.value.slice(0, caret - word.length)
            }).map(i => ({ text: i.text, kind: i.kind, detail: i.detail || '' }));
        } catch (e) { ranked = []; }
        if (!ranked.length || (ranked.length === 1 && lc(ranked[0].text) === lc(word))) { closeComplete(); return; }
        completion.items = ranked;
        completion.index = 0;
        completion.from = caret - word.length;
        completion.chosen = !!manual;
        completion.open = true;
        renderComplete();
    }

    function renderComplete() {
        completeEl.innerHTML = completion.items.map((it, i) =>
            '<div class="item' + (i === completion.index ? ' active' : '') + '" data-i="' + i + '"><span class="kind ' + it.kind + '">'
            + ({ table: 'T', view: 'V', column: 'C', keyword: 'K', join: 'J', variable: '@' }[it.kind] || '') + '</span><span class="text">'
            + esc(it.text) + '</span><span class="detail">' + esc(it.detail) + '</span></div>').join('');
        // Monospace and unwrapped: the caret's place is its line and column.
        const before = ta.value.slice(0, completion.from);
        const line = before.split('\n').length - 1;
        const col = before.length - before.lastIndexOf('\n') - 1;
        const cw = charWidth();
        const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
        const codeLeft = ta.parentElement.offsetLeft;
        completeEl.style.left = Math.max(0, codeLeft + 10 + col * cw - ta.scrollLeft) + 'px';
        completeEl.style.top = (8 + (line + 1) * lh - ta.scrollTop + 2) + 'px';
        completeEl.hidden = false;
        const active = completeEl.querySelector('.active');
        if (active) active.scrollIntoView({ block: 'nearest' });
    }

    let cachedCharWidth = 0;
    function charWidth() {
        if (cachedCharWidth) return cachedCharWidth;
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:' + getComputedStyle(ta).font;
        probe.textContent = 'MMMMMMMMMM';
        document.body.appendChild(probe);
        cachedCharWidth = probe.getBoundingClientRect().width / 10 || 7.2;
        probe.remove();
        return cachedCharWidth;
    }

    completeEl.addEventListener('mousedown', e => {
        const item = e.target.closest('.item');
        if (!item) return;
        e.preventDefault();
        completion.index = +item.dataset.i;
        acceptComplete();
    });

    function handleCompletionKey(e) {
        if (e.key === 'ArrowDown') { completion.index = (completion.index + 1) % completion.items.length; completion.chosen = true; renderComplete(); }
        else if (e.key === 'ArrowUp') { completion.index = (completion.index - 1 + completion.items.length) % completion.items.length; completion.chosen = true; renderComplete(); }
        else if (e.key === 'Tab' || (e.key === 'Enter' && completion.chosen)) acceptComplete();
        else if (e.key === 'Escape') closeComplete();
        else if (e.key === 'Enter') { closeComplete(); return false; }   // a new line, below
        else return false;
        e.preventDefault();
        return true;
    }

    function acceptComplete() {
        const it = completion.items[completion.index];
        closeComplete();
        if (!it) return;
        ta.setSelectionRange(completion.from, ta.selectionStart);
        completion.inserting = true;
        try { insertAtCaret(it.text); } finally { completion.inserting = false; }
    }

    function closeComplete() {
        completion.open = false;
        completeEl.hidden = true;
    }

    // =====================================================================
    // Schema: read once per page load (Refresh reads it again)
    // =====================================================================
    let schema = null;
    let schemaLoading = null;

    function loadSchema() {
        if (!has('runQueryAsync')) {
            $('schemaStatus').textContent = 'Not running inside Fishbowl: nothing to read.';
            $('schemaStatus').className = 'schema-status bad';
            return Promise.resolve(null);
        }
        $('schemaStatus').textContent = 'Reading the schema…';
        $('schemaStatus').className = 'schema-status';
        const t0 = performance.now();
        schemaLoading = Schema.load(sql => window.runQueryAsync(sql)).then(snap => {
            schema = snap;
            const tables = snap.tableNames().length;
            $('schemaStatus').textContent = tables + ' tables · ' + snap.columnCount.toLocaleString() + ' columns · '
                + snap.foreignKeys.length.toLocaleString() + ' links  (' + Math.round(performance.now() - t0) + ' ms)';
            (snap.problems || []).forEach(p => log('error', 'Schema: ' + p));
            renderSchemaTree();
            relint();
            redrawDiagram();
            return snap;
        }).catch(e => {
            $('schemaStatus').textContent = 'The schema could not be read.';
            $('schemaStatus').className = 'schema-status bad';
            log('error', 'Reading the schema failed: ' + errText(e));
            return null;
        });
        return schemaLoading;
    }
    $('btnRefreshSchema').addEventListener('click', loadSchema);

    // -- the schema browser --------------------------------------------------
    const treeOpen = new Set();       // 'area:sales', 'table:so', 'refs:so'
    let filterTimer = null;
    $('schemaFilter').addEventListener('input', () => { clearTimeout(filterTimer); filterTimer = setTimeout(renderSchemaTree, 150); });

    // Two ways to list the schema: "Tables", fb-api-tool's own browser (tables,
    // then views, alphabetical), and "Schema", grouped by part of Fishbowl.
    $('schemaView').addEventListener('click', e => {
        const b = e.target.closest('button[data-view]');
        if (!b) return;
        store.data.schemaView = b.dataset.view;
        store.save();
        renderSchemaTree();
    });

    function renderSchemaTree() {
        const view = store.data.schemaView === 'areas' ? 'areas' : 'tables';
        $('schemaView').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
        $('schemaTree').classList.toggle('flat', view === 'tables');
        if (view === 'tables') renderTableTree(); else renderAreaTree();
    }

    const treeActs = '<span class="acts"><button data-act="rows" title="Show its first 100 rows">Rows</button>'
        + '<button data-act="diagram" title="Draw it and what it connects to">Diagram</button></span>';

    /** fb-api-tool's browser: a match through a column shows that table with just those columns, open. */
    function renderTableTree() {
        const tree = $('schemaTree');
        if (!schema) { tree.innerHTML = '<div class="note">The schema isn\'t loaded.</div>'; $('schemaInfo').textContent = ''; return; }
        const filter = $('schemaFilter').value.trim();
        const groups = Schema.browse(schema, filter);
        $('schemaInfo').textContent = Schema.describe(schema, groups);
        let html = '';
        groups.forEach(g => {
            const gk = 'group:' + g.name;
            // Tables start open, views closed, as fb-api-tool's do; a filter opens both.
            const gOpen = filter || (treeOpen.has(gk) !== (g.name === 'Tables'));
            html += '<div class="group-head" data-key="' + gk + '"><span class="twisty">' + (gOpen ? '▾' : '▸') + '</span>'
                + esc(g.name.toUpperCase()) + ' <span class="n">(' + g.items.length + ')</span></div>';
            if (!gOpen) return;
            g.items.forEach(it => {
                const k = 'table:' + lc(it.name);
                const open = it.expanded || treeOpen.has(k);
                const all = schema.columns(it.name).length;
                html += '<div class="node" style="--depth:1" data-table="' + esc(it.name) + '" data-key="' + esc(k) + '" title="'
                    + esc(Schema.tableHint ? Schema.tableHint(schema, it.name) || '' : '') + '"><span class="twisty">' + (open ? '▾' : '▸') + '</span>'
                    + '<span class="kind' + (it.isView ? ' view' : '') + '">' + (it.isView ? 'view' : 'tbl') + '</span>'
                    + '<span class="name">' + esc(it.name) + '</span><span class="count">(' + all + ')</span>'
                    + (it.isHeavy ? '<span class="heavytag" title="MySQL builds this view in full before applying any WHERE, so filtering it is not cheap">Materialises</span>' : '')
                    + treeActs + '</div>';
                if (!open) return;
                it.columns.forEach(c => {
                    html += '<div class="node col" style="--depth:2" data-table="' + esc(it.name) + '" data-column="' + esc(c.name) + '" title="'
                        + esc(Schema.columnHint ? Schema.columnHint(schema, it.name, c.name) : c.insert) + '"><span class="twisty"></span>'
                        + '<span class="name">' + esc(c.name) + '</span>' + (c.isKey ? '<span class="keytag">Key</span>' : '')
                        + (c.refersTo ? '<span class="reftag">→ ' + esc(c.refersTo.refTable) + '</span>' : '') + '</div>';
                });
                const refs = schema.referencedBy(it.name);
                if (refs.length && !it.expanded) {
                    const rk = 'refs:' + lc(it.name);
                    const ro = treeOpen.has(rk);
                    html += '<div class="node refs" style="--depth:2" data-key="' + esc(rk) + '"><span class="twisty">' + (ro ? '▾' : '▸')
                        + '</span><span class="name">Referenced by (' + refs.length + ')</span></div>';
                    if (ro) refs.forEach(r => {
                        html += '<div class="node ref" style="--depth:3" data-table="' + esc(r.table) + '" data-jump="1" title="'
                            + esc(Schema.referenceHint ? Schema.referenceHint(r) : r.table + '.' + r.column) + '"><span class="twisty"></span>'
                            + '<span class="name">← ' + esc(r.table) + '.' + esc(r.column) + '</span></div>';
                    });
                }
            });
        });
        tree.innerHTML = html || '<div class="note">Nothing matches.</div>';
    }

    function renderAreaTree() {
        const tree = $('schemaTree');
        if (!schema) { tree.innerHTML = '<div class="note">The schema isn\'t loaded.</div>'; $('schemaInfo').textContent = ''; return; }
        $('schemaInfo').textContent = '';
        const q = lc($('schemaFilter').value.trim());
        const byArea = new Map();
        schema.tableNames().forEach(t => {
            const tableHit = !q || lc(t).includes(q);
            const colHits = q && !tableHit ? schema.columns(t).filter(c => lc(c).includes(q)) : null;
            if (!tableHit && !(colHits && colHits.length)) return;
            const a = Schema.areaOf(t);
            if (!byArea.has(a)) byArea.set(a, []);
            byArea.get(a).push({ t, colHits });
        });
        const hl = s => {
            if (!q) return esc(s);
            const i = lc(s).indexOf(q);
            return i < 0 ? esc(s) : esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + q.length)) + '</mark>' + esc(s.slice(i + q.length));
        };
        let html = '';
        (Schema.AREAS || [...byArea.keys()]).forEach(a => {
            const list = byArea.get(a);
            if (!list) return;
            const areaOpen = q || treeOpen.has('area:' + a);
            html += '<div class="group-head" data-key="area:' + a + '"><span class="twisty">' + (areaOpen ? '▾' : '▸') + '</span><i style="background:'
                + (Diagram.AREA_TINT[a] || Diagram.AREA_TINT.other) + '"></i>' + esc(Schema.areaName(a)) + ' <span class="n">' + list.length + '</span></div>';
            if (!areaOpen) return;
            list.forEach(({ t, colHits }) => {
                const open = treeOpen.has('table:' + lc(t)) || (colHits && colHits.length);
                html += '<div class="node" style="--depth:1" data-table="' + esc(t) + '" data-key="table:' + esc(lc(t)) + '" title="Double-click to insert">'
                    + '<span class="twisty">' + (open ? '▾' : '▸') + '</span><span class="name">' + hl(t) + '</span>'
                    + (schema.isView(t) ? ' <span class="badge">view</span>' : '')
                    + (schema.isHeavy(t) ? ' <span class="badge heavy" title="A view that is slow to query: it builds every row before filtering">slow</span>' : '')
                    + '<span class="acts"><button data-act="rows" title="Show its first 100 rows">Rows</button>'
                    + '<button data-act="diagram" title="Draw it and what it connects to">Diagram</button></span></div>';
                if (!open) return;
                const cols = colHits && colHits.length ? colHits : schema.columns(t);
                cols.forEach(c => {
                    const fk = schema.refersTo(t, c);
                    html += '<div class="node" style="--depth:2" data-table="' + esc(t) + '" data-column="' + esc(c) + '" title="'
                        + esc(fk ? t + '.' + c + ' holds an id from ' + fk.refTable + '.' + fk.refColumn : 'Double-click to insert ' + t + '.' + c) + '">'
                        + '<span class="twisty"></span>' + (schema.isKey(t, c) ? '<span class="key">⚿</span>' : '')
                        + '<span class="name">' + hl(c) + '</span>' + (fk ? '<span class="meta">→ ' + esc(fk.refTable) + '</span>' : '') + '</div>';
                });
                const refs = schema.referencedBy(t);
                if (refs.length && !(colHits && colHits.length)) {
                    const ro = treeOpen.has('refs:' + lc(t));
                    html += '<div class="node" style="--depth:2" data-key="refs:' + esc(lc(t)) + '"><span class="twisty">' + (ro ? '▾' : '▸')
                        + '</span><span class="name meta">Referenced by (' + refs.length + ')</span></div>';
                    if (ro) refs.forEach(r => {
                        html += '<div class="node" style="--depth:3" data-table="' + esc(r.table) + '" data-jump="1" title="'
                            + esc(r.table + '.' + r.column + ' holds an id from ' + r.refTable + '.' + r.refColumn) + '"><span class="twisty"></span>'
                            + '<span class="name">← ' + esc(r.table) + '.' + esc(r.column) + '</span></div>';
                    });
                }
            });
        });
        tree.innerHTML = html || '<div class="note">Nothing matches.</div>';
    }

    $('schemaTree').addEventListener('click', e => {
        const act = e.target.closest('button[data-act]');
        const node = e.target.closest('[data-key], [data-table]');
        if (act && node) {
            e.stopPropagation();
            const t = node.dataset.table;
            if (act.dataset.act === 'rows') runRead('SELECT * FROM ' + t + ' LIMIT 100', { label: t + ': first 100 rows', keepEditor: true });
            if (act.dataset.act === 'diagram') showInDiagram(t);
            return;
        }
        if (!node) return;
        if (node.dataset.jump) { showInDiagram(node.dataset.table); return; }
        const k = node.dataset.key;
        if (k && !node.dataset.column) {
            if (!treeOpen.delete(k)) treeOpen.add(k);
            renderSchemaTree();
        }
    });
    $('schemaTree').addEventListener('dblclick', e => {
        const node = e.target.closest('[data-table]');
        if (!node || node.dataset.jump) return;
        insertAtCaret(node.dataset.column ? node.dataset.table + '.' + node.dataset.column : node.dataset.table);
    });

    // =====================================================================
    // Running
    // =====================================================================
    let restReads = null;   // null: not tried yet; false: not available this session
    let running = false;

    function run() {
        closeComplete();
        const st = statementAtCaret();
        if (!st.text) return;
        runStatement(st.text);
    }
    $('btnRun').addEventListener('click', run);
    $('btnFormat').addEventListener('click', format);

    async function runStatement(raw) {
        // Fishbowl looks at how a statement starts: a leading comment would hide the SELECT.
        let sql = SqlText.stripComments(raw).trim().replace(/;\s*$/, '');
        if (!sql) return;
        sql = await withParameters(sql);
        if (sql == null) return;
        if (lastParamValues) { shownParams = lastParamValues; paint(); }
        const norm = SqlText.normalise(sql);
        if (norm.problem) { log('error', norm.problem, sql); showLower('messages'); return; }
        if (norm.changed) sql = norm.sql;
        const kind = SqlText.statementKind(sql);
        if (kind === 'select' || kind === 'other') {
            return runRead(sql, { reordered: norm.changed, written: raw.trim() });
        }
        if (kind === 'with') {
            return fail('Fishbowl only runs statements that start with SELECT. Wrap it: SELECT * FROM (WITH … SELECT …) AS t', sql);
        }
        return runWrite(kind, sql, raw.trim());
    }

    function fail(text, sql) {
        setRunInfo(text, 'bad');
        log('error', text, sql);
        toast(text);
    }

    function setRunInfo(text, cls) {
        $('runInfo').textContent = text;
        $('runInfo').className = 'run-info ' + (cls || '');
    }

    function busy(on) {
        running = on;
        $('btnRun').disabled = on;
        $('btnRun').textContent = on ? 'Running…' : '▶ Run';
    }

    /** Reads rows, keeping the statement's own column names where the REST connection allows. */
    async function readRows(sql, timeout) {
        if (restReads !== false && has('runRestApiAsync') && sql.length <= MAX_URL_SQL) {
            try {
                const r = await window.runRestApiAsync({ path: READ_PATH, queryParameters: [['query', sql]], timeout });
                restReads = true;
                return asRows(r);
            } catch (e) {
                const s = e && e.status;
                // No REST connection, or no right to the endpoint: the bridge's runQuery still works.
                if (restReads === null && (!s || s === 401 || s === 403 || s === 404 || s === 405)) restReads = false;
                else throw e;
            }
        }
        if (!has('runQueryAsync')) throw new Error('Not running inside Fishbowl.');
        return asRows(await window.runQueryAsync(sql));
    }

    function asRows(r) {
        if (typeof r === 'string') {
            try { r = JSON.parse(r); } catch (e) { throw new Error(r); }
        }
        if (r && !Array.isArray(r)) {
            if (Array.isArray(r.results)) r = r.results;
            else if (Array.isArray(r.rows)) r = r.rows;
            else if (r.message || r.error) throw new Error(r.message || r.error);
            else r = [r];
        }
        return r || [];
    }

    async function runRead(sql, opts) {
        opts = opts || {};
        if (running) return;
        const limit = +store.data.limit;
        let sent = sql;
        let limited = false;
        if (limit > 0 && SqlText.limitApplies(sql)) { sent = SqlText.applyLimit(sql, limit); limited = true; }
        busy(true);
        setRunInfo('Running…');
        const t0 = performance.now();
        try {
            const rows = await readRows(sent, 300000);
            const ms = Math.round(performance.now() - t0);
            showResults(rows, sent);
            const capped = limited && rows.length >= limit;
            const msg = rows.length.toLocaleString() + (rows.length === 1 ? ' row' : ' rows') + (capped ? ' (the Rows limit)' : '') + ' · ' + ms + ' ms';
            setRunInfo((opts.label ? opts.label + ' · ' : '') + msg, 'ok');
            log('ok', msg + (opts.reordered ? ' · ran with SELECT moved before FROM' : '') + (restReads === false ? ' · column names in lower case' : ''), sent);
            if (!opts.keepEditor) remember(opts.written || sql, true, rows.length, ms);
            showLower('results');
        } catch (e) {
            const text = errText(e);
            fail(text, sent);
            if (!opts.keepEditor) remember(opts.written || sql, false, 0, Math.round(performance.now() - t0));
            showLower('messages');
        } finally {
            busy(false);
        }
    }

    // -- parameters ------------------------------------------------------------
    // The Data module's own: a dollar sign, a type code and {Prompt|default},
    // the prompt with its spaces as underscores. Add parameter writes one at
    // the caret; Run asks for every one in the statement, each with the input
    // its type wants, and puts the value in its place. A record type gives
    // the record's id, as Fishbowl's own does.
    //
    // The page's source must never hold a dollar sign before a capital letter:
    // BiBrowserPanel replaces those by global text substitution before the page
    // loads. Tokens are built from DOLLAR, and found with \x24.
    const DOLLAR = String.fromCharCode(36);
    const rec = (from, label, extra, order) => ({ from, label, extra: extra || "''", order: order || label });
    const PARAM_TYPES = [
        // Records: a picker; the value is the id.
        { code: 'SO', name: 'Sales Order', pick: rec('so', 'so.num', 'so.billToName', 'so.id DESC') },
        { code: 'PO', name: 'Purchase Order', pick: rec('po', 'po.num', 'po.remitToName', 'po.id DESC') },
        { code: 'MO', name: 'Manufacture Order', pick: rec('mo', 'mo.num', '', 'mo.id DESC') },
        { code: 'WO', name: 'Work Order', pick: rec('wo', 'wo.num', '', 'wo.id DESC') },
        { code: 'TO', name: 'Transfer Order', pick: rec('xo', 'xo.num', '', 'xo.id DESC') },
        { code: 'PICK', name: 'Pick', pick: rec('pick', 'pick.num', '', 'pick.id DESC') },
        { code: 'SHIP', name: 'Shipment', pick: rec('ship', 'ship.num', '', 'ship.id DESC') },
        { code: 'RECEIPT', name: 'Receipt', pick: rec('receipt LEFT JOIN po ON po.id = receipt.poId LEFT JOIN so ON so.id = receipt.soId LEFT JOIN xo ON xo.id = receipt.xoId',
            'CAST(receipt.id AS CHAR)', "COALESCE(CONCAT('PO ', po.num), CONCAT('SO ', so.num), CONCAT('TO ', xo.num), '')", 'receipt.id DESC') },
        { code: 'PART', name: 'Part', pick: rec('part', 'part.num', 'part.description') },
        { code: 'PROD', name: 'Product', pick: rec('product', 'product.num', 'product.description') },
        { code: 'BOM', name: 'Bill of Material', pick: rec('bom', 'bom.num', 'bom.description') },
        { code: 'CUST', name: 'Customer', pick: rec('customer', 'customer.name') },
        { code: 'CG', name: 'Customer Group', pick: rec('accountgroup', 'accountgroup.name') },
        { code: 'VEND', name: 'Vendor', pick: rec('vendor', 'vendor.name') },
        { code: 'CAR', name: 'Carrier', pick: rec('carrier', 'carrier.name', 'carrier.description') },
        { code: 'CLASS', name: 'QuickBooks Class', pick: rec('qbclass', 'qbclass.name') },
        { code: 'USER', name: 'User', pick: rec('sysuser', 'sysuser.userName') },
        { code: 'LG', name: 'Location Group', pick: rec('locationgroup', 'locationgroup.name') },
        { code: 'LOC', name: 'Location', pick: rec('location JOIN locationgroup ON locationgroup.id = location.locationGroupId', 'location.name', 'locationgroup.name') },
        // Values: typed in.
        { code: 'TEXT', name: 'Text', input: 'text', quote: true },
        { code: 'NUM', name: 'Number', input: 'number', returns: 'the entered whole number' },
        { code: 'QTY', name: 'Quantity', input: 'number', returns: 'the entered quantity' },
        { code: 'MONEY', name: 'Money', input: 'number', returns: 'the entered money value' },
        { code: 'DATE', name: 'Date', input: 'date', quote: true, returns: 'the date as YYYY-MM-DD' },
        { code: 'CHECK', name: 'Check Box', input: 'check', returns: '1 or 0' }
    ];
    PARAM_TYPES.forEach(t => {
        if (!t.returns) t.returns = t.pick ? 'the selected ' + t.name.toLowerCase() + '\'s id' : 'the entered ' + t.name.toLowerCase();
    });
    const PARAM_BY_CODE = new Map(PARAM_TYPES.map(t => [t.code, t]));
    const PARAM = new RegExp(String.fromCharCode(92) + 'x24(' + PARAM_TYPES.map(t => t.code).join('|') + ')' + String.fromCharCode(92) + '{([^}|]+)(?:' + String.fromCharCode(92) + '|([^}]*))?}', 'g');
    const sqlText = v => String(v).replace(/\\/g, '\\\\').replace(/'/g, "''");

    $('btnAddParam').addEventListener('click', addParameter);

    /** Add parameter: the type and its prompt, written at the caret in the Data module's own form. */
    async function addParameter() {
        const caret = [ta.selectionStart, ta.selectionEnd];
        const opts = g => PARAM_TYPES.filter(t => !!t.pick === g).map(t => '<option value="' + t.code + '">' + esc(t.name) + '</option>').join('');
        const html = '<p>Run asks for its value each time, with a picker for a record. The value goes in its place in the statement.</p>'
            + '<label>Type</label><select id="prmType" style="width:100%;padding:5px"><optgroup label="Records (the value is the id)">' + opts(true)
            + '</optgroup><optgroup label="Values">' + opts(false) + '</optgroup></select>'
            + '<p id="prmReturns" style="color:var(--muted);margin:4px 0 0"></p>'
            + '<label>Prompt</label><input type="text" id="prmPrompt" placeholder="e.g. Sales order">'
            + '<label>Default value <span style="color:var(--muted)">(optional)</span></label><input type="text" id="prmDefault">'
            + '<label style="display:flex;gap:6px;align-items:center;margin-top:10px"><input type="checkbox" id="prmQuote"> Put it in quotes, as text and dates need</label>'
            + '<p style="color:var(--muted)">Inserts <code id="prmPreview"></code></p>';
        const pending = dialog({ title: 'Add parameter', html, focus: '#prmPrompt',
            buttons: [{ text: 'Cancel', value: false }, { text: 'Add', value: true, primary: true }] });
        const type = $('prmType'), prompt = $('prmPrompt'), def = $('prmDefault'), quote = $('prmQuote');
        type.value = store.data.lastParamType && PARAM_BY_CODE.has(store.data.lastParamType) ? store.data.lastParamType : 'SO';
        const token = () => {
            const t = PARAM_BY_CODE.get(type.value);
            const p = prompt.value.trim().replace(/[{}|]/g, '').replace(/\s+/g, '_') || t.name.replace(/\s+/g, '_');
            const body = DOLLAR + t.code + '{' + p + (def.value.trim() ? '|' + def.value.trim().replace(/[{}|]/g, '') : '') + '}';
            return quote.checked ? "'" + body + "'" : body;
        };
        const refresh = typeChanged => {
            const t = PARAM_BY_CODE.get(type.value);
            if (typeChanged) quote.checked = !!t.quote;
            def.disabled = !!t.pick;
            if (t.pick) def.value = '';
            // A record is its id, as in the Data module: compared with a number
            // or name column it matches nothing, and that looks like a broken query.
            const tbl = t.pick && t.pick.from.split(' ')[0], col = labelColumn(t);
            $('prmReturns').textContent = 'Returns ' + t.returns + '.'
                + (t.pick && col ? ' Compared with ' + tbl + '.' + col + ' it gives the ' + col + ' instead, as text.'
                    + ' (The Data module always gives the id.)' : '');
            $('prmPreview').textContent = token();
        };
        type.addEventListener('change', () => refresh(true));
        [prompt, def, quote].forEach(e => e.addEventListener('input', () => refresh(false)));
        refresh(true);
        if (!await pending) return;
        store.data.lastParamType = type.value;
        store.save();
        ta.focus();
        ta.setSelectionRange(caret[0], caret[1]);
        insertAtCaret(token());
    }

    /** Asks for every parameter in the statement; null when cancelled. */
    /**
     * A record parameter is its id, as in the Data module, unless it is
     * compared with the column the picker shows: part.num = … gets the part's
     * number, customer.name = … the customer's name. Decided at each place it
     * is used, so one parameter can be both. Null for a type with no such column.
     */
    function labelColumn(t) {
        const m = t.pick && /^[a-z]+\.([A-Za-z]+)$/.exec(t.pick.label);
        return m ? m[1] : null;
    }
    function useAt(sql, f, at) {
        const col = labelColumn(f.type) && SqlText.comparedColumn(sql, at, at + f.m.length);
        return col && lc(col) === lc(labelColumn(f.type)) ? 'label' : 'id';
    }

    let lastParamValues = null;

    async function withParameters(sql) {
        lastParamValues = null;
        const found = [];
        sql.replace(PARAM, (m, code, title, def, at) => {
            let f = found.find(x => x.m === m);
            if (!f) found.push(f = { m, code, title, def: (def || '').split('|')[0], type: PARAM_BY_CODE.get(code), uses: new Set() });
            if (f.type.pick) f.uses.add(useAt(sql, f, at));
            return m;
        });
        if (!found.length) return sql;
        const saved = store.data.paramValues || (store.data.paramValues = {});
        const keyOf = f => f.code + '|' + lc(f.title);
        let html = '';
        found.forEach((f, i) => {
            const t = f.type, last = saved[keyOf(f)] || {};
            const title = f.title.replace(/_/g, ' ');
            const label = esc(title) + (lc(title) === lc(t.name) ? '' : ' <span style="color:var(--muted)">' + esc(t.name) + '</span>');
            if (t.pick) {
                html += '<label>' + label + '</label><div class="prm-pick" data-i="' + i + '">'
                    + '<input type="text" class="prm-search" placeholder="Search ' + esc(t.name.toLowerCase()) + 's" value="' + esc(last.label || '') + '">'
                    + '<input type="hidden" class="prm-value" value="' + esc(last.value || '') + '" data-label="' + esc(last.label || '') + '"><div class="prm-list" hidden></div>'
                    + '<div class="prm-chosen" hidden></div></div>';
            } else if (t.input === 'check') {
                const on = last.value != null ? last.value === '1' : f.def === '1' || lc(f.def) === 'true';
                html += '<label style="display:flex;gap:6px;align-items:center;margin-top:10px"><input type="checkbox" class="prm-value" data-i="' + i + '"' + (on ? ' checked' : '') + '> ' + label + '</label>';
            } else {
                const v = last.value != null ? last.value : f.def;
                html += '<label>' + label + '</label><input type="' + (t.input === 'date' ? 'date' : 'text') + '" class="prm-value" data-i="' + i + '"'
                    + (t.input === 'number' ? ' inputmode="decimal"' : '') + ' value="' + esc(v) + '">';
            }
        });
        const m = $('modal');
        const read = () => found.map((f, i) => {
            const el = m.querySelector('[data-i="' + i + '"].prm-value') || m.querySelector('.prm-pick[data-i="' + i + '"] .prm-value');
            return f.type.input === 'check' ? (el.checked ? '1' : '0') : el.value.trim();
        });
        const pending = dialog({ title: 'Query parameters', html, focus: 'input:not([type=hidden])',
            buttons: [{ text: 'Cancel', value: false }, { text: 'Run', value: true, primary: true }],
            validate: () => {
                const values = read();
                const labelOf = i => { const v = m.querySelector('.prm-pick[data-i="' + i + '"] .prm-value'); return v ? v.dataset.label : ''; };
                const bad = found.findIndex((f, i) => values[i] === '' || (f.type.pick && !/^\d+$/.test(values[i]))
                    || (f.type.pick && f.uses.has('label') && !labelOf(i))
                    || (f.type.input === 'number' && !/^-?\d+(\.\d+)?$/.test(values[i])));
                if (bad < 0) return null;
                const f = found[bad];
                return f.title.replace(/_/g, ' ') + (f.type.pick ? ': pick one from the list.' : f.type.input === 'number' ? ': enter a number.' : ': enter a value.');
            } });
        wirePickers(found);
        if (!await pending) return null;
        // A closed dialog keeps its fields until the next one opens.
        const values = read();
        const labels = found.map((f, i) => { const v = m.querySelector('.prm-pick[data-i="' + i + '"] .prm-value'); return v ? v.dataset.label || '' : ''; });
        found.forEach((f, i) => { saved[keyOf(f)] = { value: values[i], label: labels[i] }; });
        store.save();
        // Shown after each parameter in the editor once the run starts.
        lastParamValues = new Map(found.map((f, i) => [f.m, { type: f.type, value: values[i], label: labels[i] }]));
        // Place by place: a record compared with its number or name gets that,
        // as text; anything else its id. In quotes already, a value's own
        // quotes are doubled; a number or name outside them gets them.
        return sql.replace(PARAM, (tok, code, title, def, at) => {
            const i = found.findIndex(f => f.m === tok);
            const f = found[i];
            const quoted = sql[at - 1] === "'" && sql[at + tok.length] === "'";
            if (f.type.pick && useAt(sql, f, at) === 'label') return quoted ? sqlText(labels[i]) : "'" + sqlText(labels[i]) + "'";
            return quoted ? sqlText(values[i]) : values[i];
        });
    }

    /** Each picker searches its table as you type and keeps the chosen record's id. */
    function wirePickers(found) {
        $('modal').querySelectorAll('.prm-pick').forEach(box => {
            const f = found[+box.dataset.i];
            const search = box.querySelector('.prm-search'), value = box.querySelector('.prm-value'), list = box.querySelector('.prm-list');
            const shown = box.querySelector('.prm-chosen');
            let timer = null, token = 0, rows = [], active = -1;
            // What the statement will get, said under the box: a record type is its id.
            const showChosen = () => {
                const noun = f.type.name.toLowerCase(), col = labelColumn(f.type), label = value.dataset.label || search.value;
                const id = 'id ' + value.value, named = col + ' ' + label;
                shown.textContent = !value.value ? ''
                    : f.uses.has('label') && f.uses.has('id') ? 'Runs with ' + noun + ' ' + id + ', and ' + named + ' where compared with ' + col
                    : f.uses.has('label') ? 'Runs with ' + noun + ' ' + named + ' (' + id + ')'
                    : 'Runs with ' + noun + ' ' + id + ' (' + label + ')';
                shown.hidden = !value.value;
            };
            const choose = r => {
                value.value = String(r.id);
                value.dataset.label = r.label;
                search.value = r.label;
                list.hidden = true;
                showChosen();
            };
            const paint = () => {
                list.innerHTML = rows.length ? rows.map((r, i) => '<div class="prm-item' + (i === active ? ' active' : '') + '" data-i="' + i + '"><b>'
                    + esc(r.label) + '</b>' + (r.extra ? ' <span>' + esc(r.extra) + '</span>' : '') + '</div>').join('')
                    : '<div class="prm-none">Nothing matches.</div>';
                list.hidden = false;
                const a = list.querySelector('.active');
                if (a) a.scrollIntoView({ block: 'nearest' });
            };
            showChosen();
            const lookup = async () => {
                const q = search.value.trim();
                const mine = ++token;
                const p = f.type.pick;
                const like = "'%" + sqlText(q).replace(/[%_]/g, m => '\\' + m) + "%'";
                const sql = 'SELECT ' + (p.from.split(' ')[0]) + '.id AS id, ' + p.label + ' AS label, ' + p.extra + ' AS extra FROM ' + p.from
                    + (q ? ' WHERE ' + p.label + ' LIKE ' + like + (p.extra !== "''" ? ' OR ' + p.extra + ' LIKE ' + like : '') : '')
                    + ' ORDER BY ' + p.order + ' LIMIT 50';
                let found = [];
                try { found = await window.runQueryAsync(sql); } catch (e) { found = []; }
                if (mine !== token) return;   // a newer search has started
                rows = found;
                active = rows.length ? 0 : -1;
                // Typed in full: a part number or name that matches one record exactly is that record.
                const exact = q ? rows.filter(r => lc(r.label) === lc(q)) : [];
                if (exact.length === 1 && !value.value) { value.value = String(exact[0].id); value.dataset.label = exact[0].label; showChosen(); }
                paint();
            };
            search.addEventListener('input', () => { value.value = ''; value.dataset.label = ''; showChosen(); clearTimeout(timer); timer = setTimeout(lookup, 200); });
            const open = () => { if (!has('runQueryAsync')) return; clearTimeout(timer); timer = setTimeout(lookup, 0); };
            search.addEventListener('focus', open);
            search.addEventListener('mousedown', () => { if (list.hidden) open(); });
            // The dialog focuses the first box before this runs, so its focus event has gone.
            if (document.activeElement === search) open();
            search.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
            // Arrows move through the list and Enter takes the highlighted one,
            // rather than running with nothing picked. The dialog leaves Enter
            // to an open list (data-own-enter).
            search.addEventListener('keydown', e => {
                if (list.hidden || !rows.length) return;
                if (e.key === 'ArrowDown') { active = Math.min(rows.length - 1, active + 1); paint(); e.preventDefault(); }
                else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); paint(); e.preventDefault(); }
                else if (e.key === 'Enter' && active >= 0) { choose(rows[active]); e.preventDefault(); e.stopPropagation(); }
                else if (e.key === 'Escape') { list.hidden = true; e.preventDefault(); e.stopPropagation(); }
            });
            list.addEventListener('mousedown', e => {
                const it = e.target.closest('.prm-item');
                if (!it) return;
                e.preventDefault();
                choose(rows[+it.dataset.i]);
            });
        });
    }

    // -- writes ------------------------------------------------------------------
    async function runWrite(kind, sql, written) {
        if (kind === 'delete') return fail('DELETE statements are not supported.', sql);
        if (kind !== 'update' && kind !== 'insert') {
            return fail('SQL Studio runs SELECT statements' + (HOST.admin ? ', UPDATE and INSERT.' : '.'), sql);
        }
        if (!HOST.admin) return fail('Only an administrator can run UPDATE and INSERT statements.', sql);
        if (!$('chkWrites').checked) return fail('This is an ' + kind.toUpperCase() + '. Tick Allow writes, at the top, to run it.', sql);
        if (running) return;
        if (!has('runRestApiAsync')) return fail(NOT_SUPPORTED, sql);

        const plan = kind === 'update' ? planUpdate(sql) : planInsert(sql);
        busy(true);
        let matched = null, ids = null;
        try {
            if (plan && plan.count) matched = +(((await readRows(plan.count, 60000))[0] || {}).n ?? NaN);
            if (plan && plan.ids) ids = (await readRows(plan.ids, 60000)).map(r => r.id ?? r.ID ?? Object.values(r)[0]);
        } catch (e) { /* the preview is a courtesy: the confirmation says it couldn't count */ }
        busy(false);

        const target = plan && plan.table ? plan.table : 'the table';
        const noWhere = kind === 'update' && plan && !plan.where;
        const html = (noWhere ? '<p class="warn"><b>This UPDATE has no WHERE clause: it changes every row in ' + esc(target) + '.</b></p>' : '')
            + '<p>' + (kind === 'update'
                ? (Number.isFinite(matched) ? '<b>' + matched.toLocaleString() + (matched === 1 ? ' row' : ' rows') + '</b> in ' + esc(target) + ' match its WHERE clause now.'
                    : 'The rows it would change in ' + esc(target) + ' could not be counted first.')
                : 'It adds rows to ' + esc(target) + '.') + '</p>'
            + '<pre>' + SqlText.highlightHtml(sql) + '</pre>'
            + '<p class="caution">There is no undo, and Fishbowl\'s change history won\'t record this change. Fishbowl\'s own rules for these records are not checked.</p>';
        const go = await dialog({ title: 'Run this ' + kind.toUpperCase() + '?', html,
            buttons: [{ text: 'Cancel', value: false }, { text: 'Run ' + kind.toUpperCase(), value: true, cls: 'danger' }] });
        if (!go) { setRunInfo('Not run.'); return; }

        busy(true);
        setRunInfo('Running…');
        const t0 = performance.now();
        try {
            await window.runRestApiAsync({ path: WRITE_PATH, queryParameters: [['query', sql]], timeout: 120000 });
            const ms = Math.round(performance.now() - t0);
            remember(written || sql, true, null, ms);
            // Nothing in the reply says what changed, so read it back.
            let back = null;
            if (ids && ids.length && plan.table) back = 'SELECT * FROM ' + plan.table + ' WHERE id IN (' + ids.slice(0, 1000).join(',') + ')';
            else if (kind === 'insert' && plan && plan.table && schema && schema.isKey(plan.table, 'id')) back = 'SELECT * FROM ' + plan.table + ' ORDER BY id DESC LIMIT 20';
            if (back) {
                const rows = await readRows(back, 60000);
                showResults(rows, back);
                showLower('results');
            }
            const text = kind.toUpperCase() + ' sent · ' + ms + ' ms' + (back ? (kind === 'update' ? ' · the rows it matched, as they are now' : ' · the newest rows in ' + plan.table) : '');
            setRunInfo(text, 'ok');
            log('ok', text, sql);
        } catch (e) {
            const s = e && e.status;
            const text = s === 403 || s === 404 || s === 405 ? NOT_SUPPORTED : errText(e);
            remember(written || sql, false, null, Math.round(performance.now() - t0));
            fail(text, sql);
        } finally {
            busy(false);
        }
    }

    /** Top-level keyword positions in a statement (outside strings, comments and brackets). */
    function topLevel(sql) {
        const toks = SqlText.tokenize(sql);
        const out = [];
        let depth = 0;
        toks.forEach(t => {
            if (t.text === '(') depth++;
            else if (t.text === ')') depth--;
            else if (depth === 0 && /^[A-Za-z_]+$/.test(t.text) && !/comment|string/.test(t.kind)) out.push({ word: t.text.toUpperCase(), start: t.start, end: t.start + t.text.length });
        });
        return out;
    }

    /** UPDATE t [alias] [joins] SET … [WHERE …]: what it targets, and queries that count and list the rows it matches. */
    function planUpdate(sql) {
        const kw = topLevel(sql);
        const set = kw.find(k => k.word === 'SET');
        if (!set) return null;
        const where = kw.find(k => k.word === 'WHERE' && k.start > set.start);
        const stop = kw.find(k => (k.word === 'ORDER' || k.word === 'LIMIT') && k.start > (where || set).start);
        const tablePart = sql.slice(kw[0].end, set.start).trim();
        const whereText = where ? sql.slice(where.end, stop ? stop.start : sql.length).trim() : '';
        const m = /^`?([A-Za-z_][A-Za-z0-9_]*)`?(?:\s+(?:AS\s+)?`?([A-Za-z_][A-Za-z0-9_]*)`?)?$/i.exec(tablePart);
        const table = m ? m[1] : (/^`?([A-Za-z_][A-Za-z0-9_]*)/.exec(tablePart) || [])[1];
        const from = ' FROM ' + tablePart + (whereText ? ' WHERE ' + whereText : '');
        const plan = { table, where: whereText, count: 'SELECT COUNT(*) AS n' + from };
        // A single table with an id: list the ids first, so the rows can be read back after.
        if (m && schema && schema.isKey(m[1], 'id')) plan.ids = 'SELECT ' + (m[2] || m[1]) + '.id AS id' + from + ' LIMIT 1001';
        return plan;
    }

    function planInsert(sql) {
        const m = /^\s*INSERT\s+(?:IGNORE\s+)?(?:INTO\s+)?`?([A-Za-z_][A-Za-z0-9_]*)`?/i.exec(sql);
        return m ? { table: m[1] } : null;
    }

    // =====================================================================
    // Results grid
    // =====================================================================
    const grid = { columns: [], rows: [], view: [], sortCol: -1, sortDir: 1, shown: 0, sel: null, numeric: [], pills: [],
                   filters: [], widths: [] };
    const DATE_RX = /^\d{4}-\d{2}-\d{2}(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?)?$/;

    function showResults(rows, sql) {
        const got = [];
        rows.forEach(r => Object.keys(r).forEach(k => { if (!got.includes(k)) got.push(k); }));
        const cols = orderColumns(got, sql);
        grid.columns = cols;
        grid.rows = rows.map(r => cols.map(c => cell(r[c])));
        grid.sortCol = -1;
        grid.sel = null;
        grid.filters = cols.map(() => null);
        grid.numeric = cols.map((c, i) => grid.rows.length > 0 && grid.rows.every(r => r[i] == null || r[i] === '' || /^-?\d+(\.\d+)?(E[+-]?\d+)?$/i.test(r[i])));
        // A column's decimal places: as many as its values need, at least two
        // if any need one, so 561.000000000 and 513.700000000 read 561.00 and 513.70.
        grid.decimals = cols.map((c, i) => {
            if (!grid.numeric[i]) return 0;
            let d = 0;
            grid.rows.forEach(r => { const m = r[i] && /\.(\d*?)0*$/.exec(r[i]); if (m && m[1].length > d) d = m[1].length; });
            return d ? Math.min(6, Math.max(2, d)) : 0;
        });
        // A pill column has a handful of distinct values; the first few thousand rows show whether it does.
        const sample = grid.rows.length > 5000 ? grid.rows.slice(0, 5000) : grid.rows;
        grid.pills = cols.map((c, i) => {
            try { return SqlText.isPillColumn(c, sample.map(r => r[i])); } catch (e) { return false; }
        });
        grid.tones = cols.map(() => new Map());
        grid.widths = cols.map((c, i) => savedWidth(c) || autoWidth(i));
        $('resultFilter').value = '';
        $('resultsBar').hidden = false;
        applyView();
    }

    /**
     * The columns in the order the SELECT list names them, whatever order the
     * JSON keys arrived in: a CSV comes out laid out as the statement wrote it.
     * * and t.* take the table's own column order from the schema. Anything
     * the list can't account for keeps its place after the rest.
     */
    function orderColumns(keys, sql) {
        let items = [];
        try { items = SqlText.selectColumns(sql || ''); } catch (e) { items = []; }
        if (!items.length) return keys;
        const norm = s => lc(s).replace(/\s+/g, ' ').trim();
        const left = keys.slice();
        const out = [];
        const take = name => {
            const i = left.findIndex(k => norm(k) === norm(name));
            if (i >= 0) out.push(left.splice(i, 1)[0]);
        };
        const tables = tablesInQuery(sql);
        items.forEach(it => {
            if (it.name != null) { take(it.name); return; }
            if (!schema) return;
            const which = it.star ? tables.filter(t => same(t.alias, it.star) || same(t.table, it.star)) : tables;
            which.forEach(t => schema.columns(t.table).forEach(take));
        });
        return out.concat(left);
    }

    /** Every value as text: numbers and flags as written, bit(1) as 0/1, objects as JSON. */
    function cell(v) {
        if (v == null) return null;
        if (typeof v === 'string') {
            // bit(1) arrives as the raw byte; never compare against a literal control character.
            if (v.length === 1 && v.charCodeAt(0) <= 1) return String(v.charCodeAt(0));
            return v;
        }
        if (typeof v === 'object') return JSON.stringify(v);
        return String(v);
    }

    // -- formatted or raw ---------------------------------------------------------
    // Formatted (the default) tidies what MySQL pads: DECIMAL(28,9) arrives as
    // 25.620000000 and a DATETIME at midnight as 2026-10-28 00:00:00.0. Raw
    // shows exactly what the server sent, as the Data module's Raw data box
    // does. Sorting, filtering, Copy and both exports always use the values
    // as sent; only the screen changes.
    const isRaw = () => !!store.data.rawData;

    function display(v, c) {
        if (isRaw()) return v;
        if (grid.numeric[c] && /^-?\d+(\.\d+)?$/.test(v)) {
            const d = grid.decimals[c];
            if (!d) return v.replace(/\.0*$/, '');
            const [whole, frac = ''] = v.split('.');
            return whole + '.' + (frac + '000000').slice(0, d);
        }
        const m = DATE_RX.exec(v);
        if (m) {
            const day = v.slice(0, 10);
            return m[1] == null || (m[1] === '00' && m[2] === '00' && m[3] === '00') ? day : day + ' ' + m[1] + ':' + m[2] + ':' + m[3];
        }
        return v;
    }

    $('chkRaw').addEventListener('change', e => {
        store.data.rawData = e.target.checked;
        store.save();
        renderGrid();
    });

    // -- widths ---------------------------------------------------------------------
    // Fixed layout from widths decided here, rather than the browser measuring
    // every cell: a 5,000-row result lays out at once, and a width dragged by
    // hand stays put. Dragged widths are kept per user, by column name, so the
    // next query naming that column gets it too. Double-click the edge to fit.
    function savedWidth(name) {
        const w = (store.data.colWidths || {})[lc(name)];
        return w > 0 ? w : 0;
    }

    function autoWidth(c) {
        let n = String(grid.columns[c]).length + 3;
        const sample = Math.min(grid.rows.length, 300);
        for (let i = 0; i < sample; i++) {
            const v = grid.rows[i][c];
            const s = v == null ? 'NULL' : display(v, c);
            if (s.length > n) n = s.length;
        }
        return Math.max(56, Math.min(420, Math.round(n * 7.4 + 26)));
    }

    // -- filtering and sorting -----------------------------------------------------
    const NULL_KEY = '␀';   // stands for NULL in a column filter's value set
    const keyOf = v => (v == null ? NULL_KEY : v);

    function applyView() {
        const q = lc($('resultFilter').value.trim());
        let view = grid.rows.map((r, i) => i);
        if (q) view = view.filter(i => grid.rows[i].some(v => v != null && lc(v).includes(q)));
        grid.filters.forEach((set, c) => {
            if (set) view = view.filter(i => set.has(keyOf(grid.rows[i][c])));
        });
        if (grid.sortCol >= 0) {
            const c = grid.sortCol, num = grid.numeric[c], d = grid.sortDir;
            view.sort((a, b) => {
                const x = grid.rows[a][c], y = grid.rows[b][c];
                if (x == null || y == null) return (x == null) - (y == null);
                return d * (num ? parseFloat(x) - parseFloat(y) : x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' }));
            });
        }
        grid.view = view;
        grid.shown = Math.min(PAGE_ROWS, view.length);
        const narrowed = q || grid.filters.some(Boolean);
        $('resultCount').textContent = (narrowed ? view.length.toLocaleString() + ' of ' : '') + grid.rows.length.toLocaleString() + (grid.rows.length === 1 ? ' row' : ' rows');
        const nf = grid.filters.filter(Boolean).length;
        $('btnClearFilters').hidden = !nf;
        $('btnClearFilters').textContent = 'Clear column filter' + (nf === 1 ? '' : 's') + ' (' + nf + ')';
        renderGrid();
    }

    $('btnClearFilters').addEventListener('click', () => {
        grid.filters = grid.columns.map(() => null);
        applyView();
    });

    function renderGrid() {
        const wrap = $('gridWrap');
        closeColumnMenu();
        if (!grid.columns.length) {
            // An empty result has no columns to show: the server sends [] alone.
            wrap.innerHTML = '<div class="placeholder">' + (grid.rows.length ? '' : 'The statement ran, and no rows matched.') + '</div>';
            return;
        }
        const total = 48 + grid.widths.reduce((s, w) => s + w, 0);
        let h = '<table class="grid" style="width:' + total + 'px"><colgroup><col style="width:48px">'
            + grid.widths.map(w => '<col style="width:' + w + 'px">').join('') + '</colgroup><thead><tr><th class="rn">#</th>';
        grid.columns.forEach((c, i) => {
            h += '<th data-c="' + i + '" class="' + (grid.numeric[i] ? 'num' : '') + (grid.filters[i] ? ' filtered' : '') + '" title="' + esc(c)
                + ': click to sort"><span class="th-name">' + esc(c) + '</span>'
                + (grid.sortCol === i ? '<span class="arrow">' + (grid.sortDir > 0 ? '▲' : '▼') + '</span>' : '')
                + '<button class="th-filter" data-filter="' + i + '" title="Filter this column">▾</button>'
                + '<span class="th-resize" data-resize="' + i + '" title="Drag to resize; double-click to fit"></span></th>';
        });
        h += '</tr></thead><tbody>';
        h += rowsHtml(0, grid.shown);
        h += '</tbody></table>';
        if (grid.shown < grid.view.length) h += moreHtml();
        wrap.innerHTML = h;
    }

    function rowsHtml(from, to) {
        let h = '';
        const raw = isRaw();
        for (let k = from; k < to; k++) {
            const i = grid.view[k];
            const r = grid.rows[i];
            h += '<tr data-r="' + i + '"><td class="rn">' + (k + 1) + '</td>';
            r.forEach((v, c) => {
                if (v == null) { h += '<td class="null' + (grid.numeric[c] ? ' num' : '') + '">NULL</td>'; return; }
                const shown = display(v, c);
                let tone = '';
                // Only a pill column is coloured, and it holds a dozen values at
                // most: work each one's tone out once. Asking for every cell cost
                // a second for each thousand rows drawn.
                if (!raw && grid.pills[c]) {
                    const cache = grid.tones[c];
                    if (cache.has(v)) tone = cache.get(v);
                    else {
                        try { tone = SqlText.cellTone(grid.columns[c], v) || ''; } catch (e) { tone = ''; }
                        tone = tone === 'none' || tone === 'empty' ? '' : tone;
                        cache.set(v, tone);
                    }
                }
                const body = !raw && grid.pills[c] && tone ? '<span class="pill tone-' + tone + '">' + esc(shown) + '</span>' : esc(shown);
                h += '<td class="' + (grid.numeric[c] ? 'num' : '') + '" title="' + esc(v.length > 40 ? v.slice(0, 600) : '') + '">' + body + '</td>';
            });
            h += '</tr>';
        }
        return h;
    }

    function moreHtml() {
        return '<div class="more-rows"><button class="tool" id="btnMoreRows">Show ' + Math.min(PAGE_ROWS, grid.view.length - grid.shown).toLocaleString()
            + ' more (' + (grid.view.length - grid.shown).toLocaleString() + ' not shown)</button></div>';
    }

    // -- the column filter menu: Excel's, values with their counts -------------------
    let columnMenu = null;

    function closeColumnMenu() {
        if (columnMenu) { columnMenu.remove(); columnMenu = null; }
    }

    function openColumnMenu(c, anchor) {
        closeColumnMenu();
        // The values left by the other filters, as Excel offers them.
        const counts = new Map();
        const q = lc($('resultFilter').value.trim());
        grid.rows.forEach(r => {
            if (q && !r.some(v => v != null && lc(v).includes(q))) return;
            if (grid.filters.some((set, k) => k !== c && set && !set.has(keyOf(r[k])))) return;
            const k = keyOf(r[c]);
            counts.set(k, (counts.get(k) || 0) + 1);
        });
        const num = grid.numeric[c];
        const values = [...counts.keys()].sort((a, b) => a === NULL_KEY ? -1 : b === NULL_KEY ? 1
            : num ? parseFloat(a) - parseFloat(b) : a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
        const MAX = 1000;
        const current = grid.filters[c];
        const m = document.createElement('div');
        m.className = 'col-menu';
        m.innerHTML = '<div class="cm-sort"><button data-sort="1">Sort ascending</button><button data-sort="-1">Sort descending</button></div>'
            + '<input type="search" class="cm-search" placeholder="Search values" spellcheck="false">'
            + '<label class="cm-all"><input type="checkbox"> <b>(Select all)</b></label>'
            + '<div class="cm-list">' + values.slice(0, MAX).map((v, k) => '<label><input type="checkbox" data-k="' + k + '"'
                + (!current || current.has(v) ? ' checked' : '') + '> <span class="' + (v === NULL_KEY ? 'null' : '') + '">'
                + esc(v === NULL_KEY ? 'NULL' : v === '' ? '(blank)' : display(v, c)) + '</span><i>' + counts.get(v).toLocaleString() + '</i></label>').join('')
            + '</div>' + (values.length > MAX ? '<div class="cm-note">The first ' + MAX.toLocaleString() + ' of ' + values.length.toLocaleString()
                + ' values. Search to find others.</div>' : '')
            + '<div class="cm-foot"><button class="tool cm-clear">Clear</button><div class="spacer"></div><button class="tool cm-cancel">Cancel</button>'
            + '<button class="primary cm-ok">OK</button></div>';
        document.body.appendChild(m);
        const r = anchor.getBoundingClientRect();
        m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.left)) + 'px';
        m.style.top = Math.max(8, Math.min(window.innerHeight - m.offsetHeight - 8, r.bottom + 2)) + 'px';
        columnMenu = m;

        const boxes = [...m.querySelectorAll('.cm-list input')];
        const all = m.querySelector('.cm-all input');
        const visible = () => boxes.filter(b => !b.parentElement.hidden);
        const syncAll = () => { const v = visible(); all.checked = v.length > 0 && v.every(b => b.checked); all.indeterminate = !all.checked && v.some(b => b.checked); };
        syncAll();
        all.addEventListener('change', () => { visible().forEach(b => { b.checked = all.checked; }); });
        boxes.forEach(b => b.addEventListener('change', syncAll));
        m.querySelector('.cm-search').addEventListener('input', e => {
            const s = lc(e.target.value);
            boxes.forEach(b => { b.parentElement.hidden = !!s && !lc(b.parentElement.textContent).includes(s); });
            syncAll();
        });
        m.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => {
            grid.sortCol = c;
            grid.sortDir = +b.dataset.sort;
            applyView();
        }));
        m.querySelector('.cm-clear').addEventListener('click', () => { grid.filters[c] = null; applyView(); });
        m.querySelector('.cm-cancel').addEventListener('click', closeColumnMenu);
        m.querySelector('.cm-ok').addEventListener('click', () => {
            // Searching then OK keeps only what the search shows, as in Excel.
            const s = m.querySelector('.cm-search').value;
            const keep = boxes.filter(b => b.checked && (!s || !b.parentElement.hidden)).map(b => values[+b.dataset.k]);
            const hiddenBeyondMax = values.length > MAX && !s;
            grid.filters[c] = keep.length === values.length || (hiddenBeyondMax && keep.length === Math.min(MAX, values.length)) ? null : new Set(keep);
            applyView();
        });
        m.querySelector('.cm-search').focus();
    }

    document.addEventListener('mousedown', e => {
        if (columnMenu && !columnMenu.contains(e.target) && !e.target.closest('.th-filter')) closeColumnMenu();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && columnMenu) closeColumnMenu(); });

    // -- resizing ------------------------------------------------------------------
    $('gridWrap').addEventListener('pointerdown', e => {
        const h = e.target.closest('.th-resize');
        if (!h) return;
        e.preventDefault();
        e.stopPropagation();
        const c = +h.dataset.resize;
        const table = $('gridWrap').querySelector('table.grid');
        const col = table.querySelectorAll('col')[c + 1];
        const x0 = e.clientX, w0 = grid.widths[c];
        h.setPointerCapture(e.pointerId);
        const move = ev => {
            grid.widths[c] = Math.max(40, Math.round(w0 + ev.clientX - x0));
            col.style.width = grid.widths[c] + 'px';
            table.style.width = (48 + grid.widths.reduce((s, w) => s + w, 0)) + 'px';
        };
        const up = () => {
            h.removeEventListener('pointermove', move);
            h.removeEventListener('pointerup', up);
            const widths = store.data.colWidths || (store.data.colWidths = {});
            widths[lc(grid.columns[c])] = grid.widths[c];
            store.save();
        };
        h.addEventListener('pointermove', move);
        h.addEventListener('pointerup', up);
    });

    $('gridWrap').addEventListener('dblclick', e => {
        const h = e.target.closest('.th-resize');
        if (h) {
            const c = +h.dataset.resize;
            if (store.data.colWidths) delete store.data.colWidths[lc(grid.columns[c])];
            store.save();
            grid.widths[c] = autoWidth(c);
            renderGrid();
            return;
        }
        const td = e.target.closest('td');
        if (td && !td.classList.contains('rn')) copyText(grid.rows[+td.parentElement.dataset.r][td.cellIndex - 1] ?? '', 'Value copied');
    });

    $('gridWrap').addEventListener('click', e => {
        if (e.target.id === 'btnMoreRows') {
            const from = grid.shown;
            grid.shown = Math.min(grid.shown + PAGE_ROWS, grid.view.length);
            $('gridWrap').querySelector('tbody').insertAdjacentHTML('beforeend', rowsHtml(from, grid.shown));
            e.target.parentElement.remove();
            if (grid.shown < grid.view.length) $('gridWrap').insertAdjacentHTML('beforeend', moreHtml());
            return;
        }
        const fb = e.target.closest('.th-filter');
        if (fb) {
            e.stopPropagation();
            const c = +fb.dataset.filter;
            if (columnMenu && columnMenu.dataset.col === String(c)) { closeColumnMenu(); return; }
            openColumnMenu(c, fb);
            if (columnMenu) columnMenu.dataset.col = String(c);
            return;
        }
        if (e.target.closest('.th-resize')) return;
        const th = e.target.closest('th[data-c]');
        if (th) {
            const c = +th.dataset.c;
            grid.sortDir = grid.sortCol === c ? -grid.sortDir : 1;
            grid.sortCol = c;
            applyView();
            return;
        }
        const td = e.target.closest('td');
        if (td && !td.classList.contains('rn')) {
            const prev = $('gridWrap').querySelector('td.sel');
            if (prev) prev.classList.remove('sel');
            td.classList.add('sel');
            grid.sel = { r: +td.parentElement.dataset.r, c: td.cellIndex - 1 };
        }
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'c' && e.ctrlKey && grid.sel && document.activeElement !== ta && !window.getSelection().toString()) {
            copyText(grid.rows[grid.sel.r][grid.sel.c] ?? '', 'Value copied');
        }
    });
    $('resultFilter').addEventListener('input', () => { clearTimeout(filterTimer); filterTimer = setTimeout(applyView, 150); });

    function copyText(text, note) {
        const done = () => toast(note || 'Copied');
        const fallback = () => {
            const t = document.createElement('textarea');
            t.value = text;
            t.style.cssText = 'position:fixed;left:-9999px';
            document.body.appendChild(t);
            t.select();
            document.execCommand('copy');
            t.remove();
            done();
        };
        try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
    }

    $('btnCopyResults').addEventListener('click', () => {
        const clean = v => v == null ? '' : String(v).replace(/[\t\r\n]+/g, ' ');
        const lines = [grid.columns.map(clean).join('\t')].concat(grid.view.map(i => grid.rows[i].map(clean).join('\t')));
        copyText(lines.join('\r\n'), grid.view.length.toLocaleString() + ' rows copied');
    });

    const exportName = ext => 'sql-studio-' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-') + '.' + ext;
    const SAVE_NOTE = 'Saving… if no Save As appears, look behind the Fishbowl window';

    $('btnExportCsv').addEventListener('click', () => {
        const q = v => v == null ? '' : /[",\r\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
        const lines = [grid.columns.map(q).join(',')].concat(grid.view.map(i => grid.rows[i].map(q).join(',')));
        const blob = new Blob([String.fromCharCode(0xFEFF) + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = exportName('csv');
        // Attached before the click, released later: JxBrowser drops a detached
        // or early-revoked download. Its Save As can open behind the client.
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
        toast(SAVE_NOTE);
    });

    /**
     * Excel, through fb-lib's own writer (FBExport, lifted from scripts/fb-lib.js
     * at build time), so this file and every report's match: real numbers and
     * dates, header row frozen, AutoFilter on. A column is a number when every
     * value is one and none has a leading zero (a part number such as 00123
     * must stay text); a date when every value is a date at midnight. A time
     * of day would be lost in a date cell, so those stay text.
     */
    $('btnExportXlsx').addEventListener('click', async () => {
        if (!window.FBExport || typeof window.FBExport.xlsx !== 'function') { toast('Excel export isn\'t in this build of SQL Studio.'); return; }
        const types = grid.columns.map((name, c) => {
            const vals = grid.view.map(i => grid.rows[i][c]).filter(v => v != null && v !== '');
            if (!vals.length) return 'text';
            if (vals.every(v => /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v) && v.length < 16)) return 'qty';
            if (vals.every(v => { const m = DATE_RX.exec(v); return m && (m[1] == null || (m[1] === '00' && m[2] === '00' && m[3] === '00')); })) return 'date';
            return 'text';
        });
        const cols = grid.columns.map((name, c) => ({ key: 'c' + c, label: name, type: types[c], w: grid.widths[c] }));
        const rows = grid.view.map(i => {
            const o = {};
            grid.rows[i].forEach((v, c) => { o['c' + c] = v; });
            return o;
        });
        try {
            await window.FBExport.xlsx({ filename: exportName('xlsx'),
                sheet: { name: 'Query', cols, rows, totals: false, freeze: true, autoFilter: true } });
            // The writer cuts a value at Excel's cell limit; say so rather than lose it quietly.
            let cut = 0;
            grid.view.forEach(i => grid.rows[i].forEach(v => { if (v != null && v.length > 32767) cut++; }));
            if (cut) {
                const note = cut.toLocaleString() + (cut === 1 ? ' value was' : ' values were') + ' longer than Excel allows in a cell (32,767 characters) and '
                    + (cut === 1 ? 'was' : 'were') + ' cut short, ending in "…". Export CSV keeps them whole.';
                log('error', note);
                toast(note);
            } else {
                toast(SAVE_NOTE);
            }
        } catch (e) {
            log('error', 'The Excel export failed: ' + errText(e));
            toast('The Excel export failed.');
        }
    });

    // =====================================================================
    // History and saved queries
    // =====================================================================
    function remember(sql, ok, rows, ms) {
        const h = store.data.history;
        const i = h.findIndex(x => x.sql.replace(/\s+/g, ' ').trim() === sql.replace(/\s+/g, ' ').trim());
        if (i >= 0) h.splice(i, 1);
        h.unshift({ sql: sql.slice(0, 20000), at: Date.now(), ok, rows, ms });
        h.length = Math.min(h.length, MAX_HISTORY);
        store.save();
        recall.index = -1;
        updateRecall();
        if (currentSideTab() === 'queries') renderQueries();
    }

    // -- the Data module's saved queries ----------------------------------------------
    // Listed by a plain SELECT, so they show even in the BI Reports viewer.
    // Opening, saving and deleting go through the plugin's bridge
    // (window.sqlStudioHost, DataQueryBridge), which makes the Data module's own
    // server calls: a query saved here is one the Data module lists. Without
    // the bridge they are read-only.
    let nativeQueries = null;
    const doc = { query: null };   // the Data module query open in the editor
    let hostRights = { edit: false, delete: false, nameMax: 0, descMax: 0 };
    const studioHost = () => window.sqlStudioHost || null;

    /** A bridge call: its JSON reply, parsed; a refusal becomes { ok: false, error }. */
    function hostCall(method, ...args) {
        const h = studioHost();
        if (!h) return { ok: false, error: 'Saving to the Data module works in the SQL Studio module only.' };
        try { return JSON.parse(h[method](...args)); } catch (e) { return { ok: false, error: errText(e) }; }
    }

    function readRights() {
        if (!studioHost()) return;
        try { hostRights = JSON.parse(studioHost().rights()); } catch (e) { /* keep read-only */ }
    }

    // The bridge arrives after the page has loaded (see SqlStudioPlugin.attachBridge).
    window.addEventListener('sqlstudiohost', () => { readRights(); updateDoc(); if (nativeQueries) renderQueries(); });

    const canSaveNative = () => !!studioHost() && hostRights.edit;
    const isDirty = () => !!doc.query && ta.value.trim() !== String(doc.query.sql || '').trim();

    /** The open query's name in the toolbar, marked when the editor differs from what is saved. */
    function updateDoc() {
        const chip = $('docChip');
        if (!doc.query) { chip.hidden = true; return; }
        chip.hidden = false;
        chip.classList.toggle('dirty', isDirty());
        chip.innerHTML = '<span class="dc-kind">Data query</span> <b>' + esc(doc.query.name) + '</b>'
            + (isDirty() ? ' <span class="dc-mod" title="Changed since it was saved">●</span>' : '')
            + '<button class="dc-close" title="Stop editing this saved query (the SQL stays in the editor)">×</button>';
        chip.title = (doc.query.description ? doc.query.description + '. ' : '') + 'Last saved ' + (doc.query.dateLastModified || 'unknown');
    }
    $('docChip').addEventListener('click', e => {
        if (!e.target.closest('.dc-close')) return;
        doc.query = null;
        updateDoc();
        if (nativeQueries) renderQueries();
    });

    async function loadNativeQueries() {
        if (!has('runQueryAsync')) { nativeQueries = []; renderQueries(); return; }
        try {
            nativeQueries = (await window.runQueryAsync('SELECT id, name, description, dataQuery, dateLastModified FROM dataexport ORDER BY name'))
                .map(r => ({ id: +r.id, name: r.name, description: r.description || '', sql: r.dataquery || '',
                             dateLastModified: String(r.datelastmodified || '').slice(0, 19) }));
        } catch (e) {
            nativeQueries = [];
            log('error', 'The Data module\'s saved queries could not be read: ' + errText(e));
        }
        renderQueries();
    }

    function renderQueries() {
        const tree = $('queryTree');
        const one = (q, src, i, meta, acts) => '<div class="node' + (src === 'native' && doc.query && doc.query.id === q.id ? ' open' : '')
            + '" style="--depth:1" data-src="' + src + '" data-i="' + i + '" title="' + esc(q.sql.slice(0, 600)) + '">'
            + '<span class="name">' + esc(q.name || q.sql.replace(/\s+/g, ' ').slice(0, 80)) + '</span>'
            + (meta ? '<span class="meta">' + esc(meta) + '</span>' : '')
            + '<span class="acts">' + (acts || '') + '</span></div>';
        const del = '<button data-act="delete" title="Delete this saved query">Delete</button>';
        // Each section folds; which are folded is kept per user.
        const folded = new Set(store.data.foldedQueryGroups || []);
        const head = (key, label, count, extra) => '<div class="group-head" data-group="' + key + '"><span class="twisty">'
            + (folded.has(key) ? '▸' : '▾') + '</span>' + label + ' <span class="n">' + count + '</span>' + (extra || '') + '</div>';
        let h = '';
        h += head('native', 'Data module queries', nativeQueries ? nativeQueries.length : '…',
            studioHost() ? '' : ' <span class="n" title="Open SQL Studio from its module to save or delete them">read-only</span>');
        if (nativeQueries && !folded.has('native')) {
            h += nativeQueries.length ? nativeQueries.map((q, i) => one(q, 'native', i, q.description,
                studioHost() && hostRights.delete ? del : '')).join('') : '<div class="note">None saved in the Data module yet.</div>';
        }
        const mine = store.data.saved;
        h += head('mine', 'My queries', mine.length);
        if (!folded.has('mine')) {
            h += mine.length ? mine.map((q, i) => one(q, 'mine', i, '', del)).join('') : '<div class="note">Kept for you only: Save as… and pick My queries.</div>';
        }
        h += head('history', 'Recent', store.data.history.length);
        if (!folded.has('history')) {
            h += store.data.history.map((q, i) => one(q, 'history', i, (q.ok ? '' : 'failed · ') + new Date(q.at).toLocaleString())).join('');
        }
        tree.innerHTML = h;
    }

    /** Before the editor's SQL is replaced: offer to save changes to the open query, as the Data module does. */
    async function settleDirty() {
        if (!isDirty() || !canSaveNative()) return true;
        const v = await dialog({ title: 'Save changes?', html: '<p>"' + esc(doc.query.name) + '" has changed since it was saved. Save the changes to the Data module?</p>',
            buttons: [{ text: 'Cancel', value: null }, { text: 'Don\'t save', value: 'discard' }, { text: 'Save', value: 'save', primary: true }] });
        if (v === 'save') return await saveOpen();
        return v === 'discard';
    }

    $('queryTree').addEventListener('click', async e => {
        const group = e.target.closest('.group-head[data-group]');
        if (group) {
            const folded = new Set(store.data.foldedQueryGroups || []);
            if (!folded.delete(group.dataset.group)) folded.add(group.dataset.group);
            store.data.foldedQueryGroups = [...folded];
            store.save();
            renderQueries();
            return;
        }
        const node = e.target.closest('[data-src]');
        if (!node) return;
        const src = node.dataset.src, i = +node.dataset.i;
        const list = src === 'mine' ? store.data.saved : src === 'native' ? nativeQueries : store.data.history;
        const q = list[i];
        if (e.target.closest('button[data-act=delete]')) {
            if (src === 'native') return deleteNative(q);
            if (await ask('Delete saved query', 'Forget "' + q.name + '"?', 'Delete')) { store.data.saved.splice(i, 1); store.save(); renderQueries(); }
            return;
        }
        if (!await settleDirty()) return;
        let open = q;
        if (src === 'native' && studioHost()) {
            // The record as the server holds it now, not as listed a while ago.
            const r = hostCall('get', String(q.id));
            if (!r.ok) { fail(r.error); loadNativeQueries(); return; }
            open = r.query;
        }
        if (src !== 'native' && ta.value.trim() && ta.value.trim() !== q.sql.trim() && !doc.query
            && !await ask('Open query', 'Replace the SQL in the editor with ' + (q.name ? '"' + q.name + '"' : 'this query') + '? Ctrl+Z brings yours back.', 'Replace', 'Keep mine')) return;
        doc.query = src === 'native' ? open : null;
        setText(open.sql);
        updateDoc();
        renderQueries();
        if (src === 'native') setRunInfo('Opened "' + open.name + '" from the Data module.');
    });

    /** Save: in place for an open Data module query, else Save as. */
    async function saveOpen() {
        if (!doc.query || !canSaveNative()) return saveAs();
        const r = hostCall('save', String(doc.query.id), doc.query.name, doc.query.description || '', ta.value);
        if (!r.ok) { fail('Not saved: ' + r.error); return false; }
        doc.query = r.query;
        updateDoc();
        toast('Saved "' + r.query.name + '" to the Data module');
        loadNativeQueries();
        return true;
    }

    /** Save as: a name, a description, and where: the Data module (shared) or My queries (only you). */
    async function saveAs() {
        const sql = ta.value.trim();
        if (!sql) { toast('The editor is empty.'); return false; }
        const native = canSaveNative();
        const why = !studioHost() ? 'Open SQL Studio from its module to save to the Data module.' : 'Saving to the Data module needs the Data-Edit right.';
        const html = '<label>Name</label><input type="text" id="saveName" value="' + esc(doc.query ? doc.query.name : '') + '"'
            + (hostRights.nameMax ? ' maxlength="' + hostRights.nameMax + '"' : '') + '>'
            + '<label>Description <span style="color:var(--muted)">(Data module only)</span></label><input type="text" id="saveDesc" value="'
            + esc(doc.query ? doc.query.description || '' : '') + '"' + (hostRights.descMax ? ' maxlength="' + hostRights.descMax + '"' : '') + '>'
            + '<label style="display:flex;gap:6px;align-items:center;margin-top:12px"><input type="radio" name="saveWhere" value="native"' + (native ? ' checked' : ' disabled')
            + '> The Data module: shared, listed in Fishbowl\'s Data module too</label>'
            + (native ? '' : '<p style="color:var(--muted);margin:2px 0 0 22px">' + esc(why) + '</p>')
            + '<label style="display:flex;gap:6px;align-items:center"><input type="radio" name="saveWhere" value="mine"' + (native ? '' : ' checked') + '> My queries: only you</label>';
        const ok = await dialog({ title: 'Save query as', html, focus: '#saveName',
            buttons: [{ text: 'Cancel', value: false }, { text: 'Save', value: true, primary: true }],
            validate: () => $('saveName').value.trim() ? null : 'Give it a name.' });
        if (!ok) return false;
        const name = $('saveName').value.trim(), desc = $('saveDesc').value.trim();
        const where = (document.querySelector('input[name=saveWhere]:checked') || {}).value;
        if (where === 'native') {
            if (!nativeQueries) await loadNativeQueries();
            const same = (nativeQueries || []).find(q => lc(q.name) === lc(name));
            if (same && !(doc.query && doc.query.id === same.id)
                && !await ask('Replace saved query', 'The Data module already has a query called "' + same.name + '". Replace it with this one?', 'Replace')) return false;
            const r = hostCall('save', same ? String(same.id) : '', name, desc, ta.value);
            if (!r.ok) { fail('Not saved: ' + r.error); return false; }
            doc.query = r.query;
            updateDoc();
            toast('Saved "' + name + '" to the Data module');
            loadNativeQueries();
            return true;
        }
        const at = store.data.saved.findIndex(q => lc(q.name) === lc(name));
        if (at >= 0) store.data.saved.splice(at, 1);
        store.data.saved.unshift({ name, sql: ta.value });
        store.save();
        doc.query = null;
        updateDoc();
        renderQueries();
        toast('Saved as ' + name + ', for you only');
        return true;
    }

    async function deleteNative(q) {
        if (!await ask('Delete saved query', 'Delete "' + q.name + '" from the Data module? It goes for everyone who uses the Data module, and can\'t be undone.', 'Delete')) return;
        const r = hostCall('remove', String(q.id));
        if (!r.ok) { fail('Not deleted: ' + r.error); return; }
        if (doc.query && doc.query.id === q.id) { doc.query = null; updateDoc(); }
        toast('Deleted "' + q.name + '"');
        loadNativeQueries();
    }

    $('btnSaveQuery').addEventListener('click', saveAs);
    $('btnSave').addEventListener('click', saveOpen);
    document.addEventListener('keydown', e => {
        if ((e.key === 's' || e.key === 'S') && e.ctrlKey && !e.shiftKey && !e.altKey && $('modalBack').hidden) {
            e.preventDefault();
            saveOpen();
        }
    });

    // =====================================================================
    // Diagram: docked in its tab, or popped out into a window of its own
    // =====================================================================
    const diagram = { state: null, view: null, win: null, panel: null, redrawTimer: null };

    function diagramHooks() {
        return {
            areaOf: t => Schema.areaOf(t),
            areaName: a => Schema.areaName(a),
            onFocus: t => showInDiagram(t),
            onLinks: t => toggleLinks(t),
            onSelection: () => updateQueryPreview(),
            onZoom: p => { if (diagram.panel) diagram.panel.querySelector('.dg-zoom').textContent = p + '%'; }
        };
    }

    /** The diagram's controls and drawing area, built in whichever document it is shown in. */
    function buildDiagramPanel(doc, popped) {
        const d = store.data.diagram;
        const panel = doc.createElement('div');
        panel.className = 'diagram-panel';
        panel.innerHTML =
            '<div class="dg-bar">'
            + '<input type="text" class="dg-table" list="dgTables" placeholder="Table" spellcheck="false" value="' + esc(d.table) + '">'
            + '<datalist id="dgTables"></datalist>'
            + '<select class="dg-depth" title="How far out from the table to draw"><option value="1">1 step</option><option value="2">2 steps</option></select>'
            + '<label title="Status, type and other lookup tables are left out; their links stay, in grey"><input type="checkbox" class="dg-lookups"> Hide lookups</label>'
            + '<label title="Draw the tables the query in the editor uses, picked in its order"><input type="checkbox" class="dg-follow"> Follow query</label>'
            + '<button class="tool dg-fit-all" title="Everything in view">Fit all</button>'
            + '<button class="tool dg-fit-picked" title="The picked tables in view">Fit picked</button>'
            + '<button class="tool dg-tidy" title="Lay it out again: boxes moved by hand go back">Tidy</button>'
            + '<span class="dg-zoom"></span>'
            + '<div class="spacer"></div>'
            + '<button class="primary dg-write" disabled title="Put a query joining the picked tables in the editor">Write query</button>'
            + '<button class="tool dg-pop">' + (popped ? 'Dock back' : '⧉ Pop out') + '</button>'
            + '</div>'
            + '<div class="dg-body"><div class="dg-canvas" style="flex:1;display:flex;min-width:0"></div>'
            + '<div class="dg-query"' + (popped ? '' : ' hidden') + '><div class="dg-query-head"><b>QUERY</b><div class="spacer"></div>'
            + '<button class="tool dg-copy">Copy</button><button class="primary dg-use">Use in editor</button></div>'
            + '<pre class="dg-sql"></pre><div class="note">Built as you Ctrl+click tables and columns. Nothing runs until it is in the editor and run.</div></div></div>'
            + '<div class="dg-info"></div>';
        const q = s => panel.querySelector(s);
        q('.dg-depth').value = String(d.depth);
        q('.dg-lookups').checked = d.hideLookups;
        q('.dg-follow').checked = d.follow;
        if (schema) q('datalist').innerHTML = schema.tableNames().map(t => '<option value="' + esc(t) + '">').join('');
        q('.dg-table').addEventListener('change', e => showInDiagram(e.target.value));
        q('.dg-table').addEventListener('keydown', e => { if (e.key === 'Enter') showInDiagram(e.target.value); });
        q('.dg-depth').addEventListener('change', e => { d.depth = +e.target.value; store.save(); redrawDiagram(); });
        q('.dg-lookups').addEventListener('change', e => { d.hideLookups = e.target.checked; store.save(); redrawDiagram(); });
        q('.dg-follow').addEventListener('change', e => { d.follow = e.target.checked; store.save(); redrawDiagram(); });
        q('.dg-fit-all').addEventListener('click', () => diagram.view && diagram.view.fitAll());
        q('.dg-fit-picked').addEventListener('click', () => diagram.view && diagram.view.fitPicked());
        q('.dg-tidy').addEventListener('click', () => diagram.view && diagram.view.tidy());
        q('.dg-write').addEventListener('click', writeQueryFromDiagram);
        q('.dg-use').addEventListener('click', writeQueryFromDiagram);
        q('.dg-copy').addEventListener('click', () => { const s = writtenQuery(); if (s) copyText(s, 'Query copied'); });
        q('.dg-pop').addEventListener('click', () => (popped ? dockDiagram() : popOutDiagram()));
        return panel;
    }

    function mountDiagram(doc, host, popped) {
        if (!diagram.state) diagram.state = Diagram.newState();
        if (diagram.view) diagram.view.destroy();
        host.innerHTML = '';
        diagram.panel = buildDiagramPanel(doc, popped);
        host.appendChild(diagram.panel);
        diagram.view = new Diagram.View(diagram.panel.querySelector('.dg-canvas'), diagram.state, diagramHooks());
        redrawDiagram();
    }

    function ensureDiagram() {
        if (!diagram.view && !diagram.win) mountDiagram(document, $('diagramDocked'), false);
    }

    function showInDiagram(table) {
        table = String(table || '').trim();
        if (!table) return;
        const d = store.data.diagram;
        // A table asked for by name: the diagram is about it now, not the query.
        // What was picked stays picked, to build on.
        if (!same(table, d.table)) diagram.state && diagram.state.expanded.clear();
        d.table = schema && schema.name ? (schema.name(table) || table) : table;
        d.follow = false;
        store.save();
        if (!diagram.win) showLower('diagram');
        ensureDiagram();
        if (diagram.panel) {
            diagram.panel.querySelector('.dg-table').value = d.table;
            diagram.panel.querySelector('.dg-follow').checked = false;
        }
        redrawDiagram();
    }

    function toggleLinks(table) {
        const ex = diagram.state.expanded;
        const had = [...ex].find(t => same(t, table));
        if (had) ex.delete(had); else ex.add(table);
        const d = store.data.diagram;
        if (d.follow) {
            // Following the query draws only its tables: become a diagram about its first one instead.
            d.follow = false;
            d.table = diagram.state.selected[0] || table;
            if (diagram.panel) { diagram.panel.querySelector('.dg-follow').checked = false; diagram.panel.querySelector('.dg-table').value = d.table; }
        }
        store.save();
        redrawDiagram();
    }

    function same(a, b) { return lc(a) === lc(b); }

    function scheduleRedraw() {
        clearTimeout(diagram.redrawTimer);
        diagram.redrawTimer = setTimeout(redrawDiagram, 400);
    }

    function redrawDiagram() {
        if (!diagram.view) return;
        const st = diagram.state;
        const d = store.data.diagram;
        if (diagram.panel && schema) {
            const dl = diagram.panel.querySelector('datalist');
            if (!dl.childElementCount) dl.innerHTML = schema.tableNames().map(t => '<option value="' + esc(t) + '">').join('');
        }
        let graph = { nodes: [], edges: [], trimmed: 0, lookupsHidden: 0 };
        if (!schema || !schema.foreignKeys.length) {
            st.emptyText = !schema ? 'The diagram is drawn once the schema has been read.'
                : 'The schema was read without its keys, so there are no links to draw. Refresh schema to read them again.';
        } else if (d.follow) {
            const tables = [];
            tablesInQuery(ta.value).forEach(t => { const n = schema.name ? schema.name(t.table) : t.table; if (n && schema.hasTable(n) && !tables.some(x => same(x, n))) tables.push(n); });
            st.emptyText = 'The query in the editor doesn\'t name any tables yet.';
            graph = Schema.graphOf(schema, tables, d.hideLookups);
            diagram.view.show(graph);
            const drawn = tables.filter(t => graph.nodes.some(n => same(n.table, t)));
            diagram.view.pick(drawn, queryFields(ta.value, drawn));
            describe(graph);
            updateQueryPreview();
            return;
        } else if (!d.table) {
            st.emptyText = 'Pick a table to see what it connects to.';
        } else if (!schema.hasTable(d.table)) {
            st.emptyText = 'There is no table called ' + d.table + '.';
        } else {
            // The tables already picked stay, with what links them in, so
            // re-centring to walk further out keeps the query being built.
            graph = Schema.graphAround(schema, d.table, d.depth === 2 ? 2 : 1, d.hideLookups, st.selected.slice(), [...st.expanded]);
        }
        diagram.view.show(graph);
        describe(graph);
        updateQueryPreview();
    }

    /**
     * The fields the query's SELECT list names, as [{ table, column }]: a.col
     * by its alias, a bare col by whichever drawn table has it (the first, if
     * more than one does). Following the query, these are the picked fields.
     */
    function queryFields(sql, drawn) {
        let items = [];
        try { items = SqlText.selectColumns(sql); } catch (e) { return []; }
        const tables = tablesInQuery(sql);
        const out = [];
        items.forEach(it => {
            if (!it.column) return;
            let table = null;
            if (it.qualifier) {
                const t = tables.find(x => same(x.alias, it.qualifier)) || tables.find(x => same(x.table, it.qualifier));
                table = t && t.table;
            } else {
                table = drawn.find(t => schema.columns(t).some(c => same(c, it.column)));
            }
            const name = table && schema.name ? schema.name(table) : table;
            const col = name && schema.columns(name).find(c => same(c, it.column));
            if (col && drawn.some(t => same(t, name)) && !out.some(o => same(o.table, name) && same(o.column, col))) out.push({ table: name, column: col });
        });
        return out;
    }

    function describe(g) {
        if (!diagram.panel) return;
        const info = diagram.panel.querySelector('.dg-info');
        if (!g.nodes.length) { info.textContent = ''; return; }
        const parts = [g.nodes.length + (g.nodes.length === 1 ? ' table' : ' tables'),
            g.edges.filter(e => !same(e.table, e.refTable)).length + ' links'];
        if (g.trimmed > 0) parts.push(g.trimmed + ' more not shown');
        if (g.lookupsHidden > 0 || g.nodes.some(n => n.lookups.length)) parts.push('grey links go to hidden lookup tables: Ctrl+click one for the lookup\'s name instead of its id');
        parts.push(store.data.diagram.follow ? 'following the query: its tables, picked in its order' : 'what it points at is to the right, what points at it to the left');
        parts.push('drag to move, scroll to zoom, double-click a table to centre on it, right-click for more');
        parts.push('Ctrl+click a table, or a column in it, to write a query');
        info.textContent = parts.join('  ·  ');
    }

    function writtenQuery() {
        const st = diagram.state;
        if (!schema || !st || !st.selected.length) return null;
        try {
            return Schema.writeJoin(schema, st.selected, st.pickedColumns, Diagram.pickedLookupNames(st), st.graph.nodes.map(n => n.table));
        } catch (e) {
            log('error', 'Writing the query failed: ' + errText(e));
            return null;
        }
    }

    function updateQueryPreview() {
        if (!diagram.panel) return;
        const st = diagram.state;
        const btn = diagram.panel.querySelector('.dg-write');
        const cols = st.pickedColumns.length;
        btn.disabled = !st.selected.length;
        btn.textContent = !st.selected.length ? 'Write query'
            : 'Write query (' + st.selected.length + (cols ? ', ' + cols + ' col' + (cols === 1 ? '' : 's') : '') + ')';
        const pre = diagram.panel.querySelector('.dg-sql');
        const sql = writtenQuery();
        pre.innerHTML = sql ? SqlText.highlightHtml(sql) : '<span style="color:var(--muted)">Ctrl+click tables to pick them.</span>';
    }

    /** Puts the picked tables' query in the editor. One already there is replaced only when that is confirmed. */
    async function writeQueryFromDiagram() {
        const sql = writtenQuery();
        if (!sql) return;
        if (diagram.win) window.focus();
        if (ta.value.trim() && !await ask('Write query', 'Replace the query in the editor with one joining '
            + diagram.state.selected.join(', ') + '? Ctrl+Z brings yours back.', 'Replace', 'Keep mine')) return;
        setText(sql);
        setRunInfo('Query written from ' + diagram.state.selected.length + ' table' + (diagram.state.selected.length === 1 ? '' : 's') + '. It hasn\'t been run.');
    }

    function popOutDiagram() {
        const w = window.open('', 'sqlstudio_diagram', 'width=1280,height=820,resizable=yes');
        if (!w) { toast('The diagram couldn\'t open in its own window.'); return; }
        let css = '';
        try {
            [...document.styleSheets].forEach(s => { try { css += [...s.cssRules].map(r => r.cssText).join('\n'); } catch (e) { /* unreadable sheet */ } });
        } catch (e) { /* keep what was read */ }
        w.document.open();
        w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Schema diagram · SQL Studio</title></head><body class="popout"></body></html>');
        w.document.close();
        const style = w.document.createElement('style');
        style.textContent = css;
        w.document.head.appendChild(style);
        diagram.win = w;
        mountDiagram(w.document, w.document.body, true);
        $('diagramDocked').hidden = true;
        $('diagramAway').hidden = false;
        // Closing the window docks the diagram again.
        const watch = setInterval(() => { if (w.closed) { clearInterval(watch); if (diagram.win === w) dockDiagram(); } }, 600);
    }

    function dockDiagram() {
        const w = diagram.win;
        diagram.win = null;
        if (diagram.view) { diagram.view.destroy(); diagram.view = null; }
        if (w && !w.closed) w.close();
        $('diagramDocked').hidden = false;
        $('diagramAway').hidden = true;
        mountDiagram(document, $('diagramDocked'), false);
        showLower('diagram');
    }
    $('btnDockBack').addEventListener('click', dockDiagram);
    $('btnShowPopout').addEventListener('click', () => { if (diagram.win) diagram.win.focus(); });
    window.addEventListener('pagehide', () => { if (diagram.win && !diagram.win.closed) diagram.win.close(); });

    // =====================================================================
    // Tabs and splitters
    // =====================================================================
    function wireTabs(navId, onShow) {
        const nav = $(navId);
        nav.addEventListener('click', e => {
            const b = e.target.closest('.tab');
            if (b) onShow(b.dataset.tab);
        });
    }
    function showTab(navId, scope, name) {
        $(navId).querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
        scope.querySelectorAll(':scope > [data-panel]').forEach(p => { p.hidden = p.dataset.panel !== name; });
    }
    const currentLowerTab = () => ($('lowerTabs').querySelector('.tab.active') || {}).dataset.tab;
    const currentSideTab = () => ($('sideTabs').querySelector('.tab.active') || {}).dataset.tab;

    function showLower(name) {
        showTab('lowerTabs', $('lower'), name);
        if (name === 'diagram') ensureDiagram();
        if (name === 'messages') { unseen = 0; $('msgCount').hidden = true; }
    }
    wireTabs('lowerTabs', showLower);
    wireTabs('sideTabs', name => {
        showTab('sideTabs', $('side'), name);
        if (name === 'queries') { renderQueries(); if (!nativeQueries) loadNativeQueries(); }
    });

    function splitter(el, apply) {
        el.addEventListener('pointerdown', e => {
            e.preventDefault();
            el.setPointerCapture(e.pointerId);
            const move = ev => apply(ev);
            const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); store.save(); };
            el.addEventListener('pointermove', move);
            el.addEventListener('pointerup', up);
        });
    }
    splitter($('splitSide'), ev => {
        const w = Math.max(180, Math.min(window.innerWidth * 0.6, ev.clientX));
        $('side').style.width = w + 'px';
        store.data.sideWidth = w;
    });
    splitter($('splitWork'), ev => {
        const top = $('work').getBoundingClientRect().top;
        const h = Math.max(120, Math.min(window.innerHeight - top - 140, ev.clientY - top));
        $('editorPane').style.height = h + 'px';
        store.data.editorHeight = h;
    });

    $('selLimit').addEventListener('change', e => { store.data.limit = e.target.value; store.save(); });
    $('chkWrites').addEventListener('change', e => $('writeToggle').classList.toggle('on', e.target.checked));

    // =====================================================================
    // Start
    // =====================================================================
    function init() {
        store.load();
        $('userBadge').innerHTML = HOST.user ? 'Signed in as <b>' + esc(HOST.user) + '</b>' + (HOST.admin ? ' · admin' : '') : '';
        $('writeToggle').hidden = !HOST.admin;
        $('selLimit').value = store.data.limit;
        $('chkRaw').checked = !!store.data.rawData;
        if (store.data.sideWidth) $('side').style.width = store.data.sideWidth + 'px';
        if (store.data.editorHeight) $('editorPane').style.height = store.data.editorHeight + 'px';
        ta.value = store.data.sql || '';
        paint();
        relint();
        updateRecall();
        readRights();
        renderSchemaTree();
        loadSchema();
        ta.focus();
    }
    init();
})();
