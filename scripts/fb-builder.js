/*
 * fb-builder: the Report Builder's screen.
 *
 * Drag friendly fields (fb-model) into Columns, Group by, Filters and Sort; the
 * live preview is the real report (FBReport.View, preview mode). The result is
 * a report spec, the same JSON a builder report page carries.
 *
 *   FBBuilder.mount(host, { catalog })
 *
 * Until the plugin can publish: Open reads a builder report (or a draft),
 * drafts are kept in the user's settings, and "Copy definition" gives the JSON
 * to paste into a builder app's definition block.
 *
 * Inline-script rules: this file never contains a closing script tag, an HTML
 * comment opener, a Fishbowl directive or setting token, or a meta tag name.
 */
(function (global) {
    'use strict';

    const BUILD = '2026.10.14-530c2c7';   // @fb-build
    const R = () => global.FBReport;
    const L = () => global.FBLib || {};
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const NUMERIC = { number: 1, int: 1, money: 1, qty: 1, percent: 1 };
    const ICON = { text: 'Abc', int: '#', number: '#', qty: '#', money: '$', percent: '%', date: '▦', bool: '✓' };
    const FOLDERS = ['Dates', 'Order', 'Customer', 'Line', 'Product', 'Measures', 'Formulas', 'Company formulas', 'Other'];
    const BUCKETS = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year'], ['fy', 'Financial year']];
    const OPS = {
        text: [['contains', 'contains'], ['eq', 'is'], ['neq', 'is not'], ['startsWith', 'starts with'], ['notContains', 'doesn\'t contain'], ['blank', 'is blank'], ['notBlank', 'isn\'t blank']],
        list: [['in', 'is one of'], ['notIn', 'is not one of']],
        number: [['gte', 'at least'], ['lte', 'at most'], ['eq', 'equals'], ['neq', 'isn\'t'], ['gt', 'more than'], ['lt', 'less than'], ['between', 'between'], ['blank', 'is blank'], ['notBlank', 'isn\'t blank']],
        date: [['between', 'in'], ['before', 'before'], ['after', 'after'], ['blank', 'is blank'], ['notBlank', 'isn\'t blank']]
    };
    // The formula language's functions, for autocomplete and the argument hint.
    // [name, arguments, what it does, true when it adds up lines (formulas over totals only)]
    const FUNCS = [
        ['IF', ['condition', 'value if yes', 'value if no'], 'Picks one of two values.'],
        ['DIVIDE', ['top', 'bottom', 'if the bottom is 0'], 'Divides, with a fallback when the bottom is 0 or blank.'],
        ['ROUND', ['number', 'decimals (0 to 6)'], 'Rounds a number.'],
        ['ABS', ['number'], 'The number without its sign.'],
        ['MIN', ['value', 'value', '…'], 'The smallest of the values.'],
        ['MAX', ['value', 'value', '…'], 'The largest of the values.'],
        ['COALESCE', ['value', 'value', '…'], 'The first value that isn\'t blank.'],
        ['ISBLANK', ['value'], 'Yes when the value is blank.'],
        ['UPPER', ['text'], 'Text in capitals.'],
        ['LOWER', ['text'], 'Text in small letters.'],
        ['TRIM', ['text'], 'Text without spaces at the ends.'],
        ['LEFT', ['text', 'count'], 'The first characters of the text.'],
        ['RIGHT', ['text', 'count'], 'The last characters of the text.'],
        ['LEN', ['text'], 'How many characters the text has.'],
        ['YEAR', ['date'], 'The date\'s year.'],
        ['QUARTER', ['date'], 'The date\'s quarter (1 to 4).'],
        ['MONTH', ['date'], 'The date\'s month (1 to 12).'],
        ['DAY', ['date'], 'The date\'s day of the month.'],
        ['DAYS_BETWEEN', ['start date', 'end date'], 'The days from one date to another.'],
        ['ADD_DAYS', ['date', 'days'], 'The date that many days later.'],
        ['TODAY', [], 'Today\'s date.'],
        ['SUM', ['value per line'], 'Adds up the lines.', true],
        ['AVG', ['value per line'], 'The average of the lines.', true],
        ['COUNT', [], 'How many lines.', true],
        ['COUNTDISTINCT', ['field'], 'How many different values.', true],
        ['MINOF', ['value per line'], 'The smallest over the lines.', true],
        ['MAXOF', ['value per line'], 'The largest over the lines.', true]
    ];
    const WORDS = [['AND', 'both conditions'], ['OR', 'either condition'], ['NOT', 'the opposite'], ['TRUE', 'yes'], ['FALSE', 'no'], ['BLANK', 'no value']];
    const MAX_UNDO = 100;
    const SPEC_OPEN = '<scr' + 'ipt type="application/json" id="fb-report-spec">';
    const SPEC_CLOSE = '</' + 'script>';

    const CSS = [
        '.fbb{display:grid;grid-template-columns:280px minmax(0,1fr);grid-template-rows:auto auto minmax(0,1fr);height:100vh;background:var(--bg-1,#f7f7f7)}',
        '.fbb-top{grid-column:1/3;display:flex;align-items:center;gap:8px;padding:8px 14px;background:#fff;border-bottom:1px solid var(--border,#e3e3e3);flex-wrap:wrap}',
        '.fbb-top .fbb-title{font-size:15px;font-weight:700;border:1px solid transparent;border-radius:6px;padding:4px 6px;min-width:240px}',
        '.fbb-top .fbb-title:hover,.fbb-top .fbb-title:focus{border-color:var(--border-strong,#c6d0d4);outline:none}',
        '.fbb-top select{font:inherit;font-size:12px;color:#506872;border:1px solid #e3e3e3;border-radius:8px;padding:0 8px;background:#fff}',
        '.fbb-top .hdr-btn,.fbb-top select{height:28px;box-sizing:border-box}',
        '.fbb-top .fbb-sp{flex:1}.fbb-top .fbb-src{font-size:11.5px;color:var(--c-secondary,#506872)}',
        '.fbb-fields{grid-row:2/4;display:flex;flex-direction:column;min-height:0;background:#fff;border-right:1px solid var(--border,#e3e3e3)}',
        '.fbb-fields .fbb-search{margin:10px;height:30px;border:1px solid var(--border-strong,#c6d0d4);border-radius:6px;padding:0 8px}',
        '.fbb-tree{flex:1;overflow:auto;padding:0 6px 10px}.fbb-folder{margin-top:6px}',
        '.fbb-folder-h{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--c-secondary,#506872);padding:6px 6px 4px;cursor:pointer;user-select:none}',
        '.fbb-folder-h:before{content:"▾ ";font-size:10px}.fbb-folder.shut .fbb-folder-h:before{content:"▸ "}.fbb-folder.shut .fbb-item{display:none}',
        '.fbb-item{display:flex;align-items:center;gap:7px;padding:4px 8px;border-radius:6px;cursor:grab;font-size:12.5px;user-select:none}',
        '.fbb-item:hover,.fbb-item:focus{background:var(--tint-blue,#eef6fb);outline:none}.fbb-item.locked{cursor:not-allowed;color:#9aa7ad}',
        '.fbb-ic{flex:0 0 26px;text-align:center;font-size:10.5px;font-weight:700;border-radius:4px;padding:1px 0;background:var(--bg-2,#ebeeed);color:#415157}',
        '.fbb-item.measure .fbb-ic{background:#e3f1fa;color:#1e7bb4}.fbb-item .fbb-lock{margin-left:auto;font-size:11px}',
        '.fbb-addcalc{margin:6px 10px 10px}',
        '.fbb-wells{grid-column:2;padding:10px 14px 6px;display:flex;flex-direction:column;gap:6px;background:var(--bg-1,#f7f7f7)}',
        '.fbb-well{display:flex;align-items:flex-start;gap:10px}.fbb-well-h{flex:0 0 84px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--c-secondary,#506872);padding-top:8px}',
        '.fbb-drop{flex:1;min-height:34px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:4px 6px;border:1px dashed var(--border-strong,#c6d0d4);border-radius:8px;background:#fff}',
        '.fbb-drop.over{border-color:var(--fb-blue,#2d9cdb);background:var(--tint-blue,#eef6fb)}.fbb-drop .fbb-hint{font-size:12px;color:#9aa7ad;padding:0 4px}',
        '.fbb-chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 4px 0 9px;border-radius:13px;border:1px solid var(--border-strong,#c6d0d4);background:#fff;font-size:12px;cursor:grab;user-select:none}',
        '.fbb-chip:hover,.fbb-chip:focus{border-color:var(--fb-blue,#2d9cdb);outline:none}.fbb-chip.measure{background:#f2f9fd}.fbb-chip .fbb-x{border:0;background:none;color:#8a99a0;cursor:pointer;font-size:14px;line-height:1;padding:0 4px}',
        '.fbb-chip .fbb-x:hover{color:#b4232f}.fbb-chip .fbb-sub{color:var(--c-secondary,#506872);font-size:11px}.fbb-chip.err{border-color:#d9a4b2;background:#fbeff2}',
        '.fbb-opts{display:flex;gap:16px;align-items:center;font-size:12px;color:#415157;padding:2px 0 0 94px}',
        '.fbb-msgs{font-size:12px;padding:0 0 0 94px}.fbb-msgs div{padding:2px 0}.fbb-msgs .e{color:#8a1e30}.fbb-msgs .w{color:#204a63}',
        '.fbb-preview{grid-column:2;display:flex;flex-direction:column;min-height:0;margin:4px 14px 14px;border:1px solid var(--border,#e3e3e3);border-radius:8px;overflow:hidden;background:#fff}',
        '.fbb-preview>.fbb-ph{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--c-secondary,#506872);padding:6px 12px;border-bottom:1px solid var(--border,#e3e3e3);background:var(--bg-1,#f7f7f7)}',
        '.fbb-preview>.fbb-pv{flex:1;display:flex;flex-direction:column;min-height:0;position:relative}',
        '.fbb-pv>header{position:relative}.fbb-pv .rpt-app{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}',
        '.fbb-pop{position:fixed;z-index:400;background:#fff;border:1px solid var(--border-strong,#c6d0d4);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.14);padding:12px;min-width:240px;max-width:340px;font-size:12.5px}',
        '.fbb-pop label{display:block;font-size:11px;font-weight:700;color:var(--c-secondary,#506872);margin:8px 0 3px}.fbb-pop label:first-child{margin-top:0}',
        '.fbb-pop input[type=text],.fbb-pop input[type=date],.fbb-pop input[type=number],.fbb-pop select{width:100%;box-sizing:border-box;height:28px;border:1px solid var(--border-strong,#c6d0d4);border-radius:5px;padding:0 6px}',
        '.fbb-pop .fbb-check{display:flex;gap:6px;align-items:center;font-weight:400;font-size:12.5px;color:#101010;margin-top:8px}',
        '.fbb-pop .fbb-list{max-height:180px;overflow:auto;border:1px solid var(--border,#e3e3e3);border-radius:5px;padding:4px}',
        '.fbb-pop .fbb-list .fbb-check{margin:2px 0}.fbb-pop .fbb-row{display:flex;gap:6px}.fbb-pop .fbb-actions{display:flex;justify-content:space-between;margin-top:12px}',
        '.fbb-modal-bg{position:fixed;inset:0;z-index:500;background:rgba(11,49,64,.35);display:flex;align-items:center;justify-content:center}',
        '.fbb-modal{background:#fff;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.25);width:min(760px,92vw);max-height:88vh;display:flex;flex-direction:column}',
        '.fbb-modal h2{margin:0;padding:14px 18px;font-size:15px;border-bottom:1px solid var(--border,#e3e3e3)}.fbb-modal .fbb-mb{padding:14px 18px;overflow:auto}',
        '.fbb-modal .fbb-mf{display:flex;justify-content:flex-end;gap:8px;padding:10px 18px;border-top:1px solid var(--border,#e3e3e3)}',
        '.fbb-modal textarea{width:100%;box-sizing:border-box;font-family:var(--mono,Consolas,monospace);font-size:12.5px;border:1px solid var(--border-strong,#c6d0d4);border-radius:6px;padding:8px}',
        '.fbb-modal input[type=text]{width:100%;box-sizing:border-box;height:30px;border:1px solid var(--border-strong,#c6d0d4);border-radius:6px;padding:0 8px}',
        '.fbb-modal label{display:block;font-size:11px;font-weight:700;color:var(--c-secondary,#506872);margin:10px 0 4px}',
        '.fbb-chips{display:flex;flex-wrap:wrap;gap:5px;max-height:140px;overflow:auto;margin-top:6px}.fbb-chips button{border:1px solid var(--border-strong,#c6d0d4);background:#fff;border-radius:12px;padding:2px 9px;font-size:11.5px;cursor:pointer}',
        '.fbb-chips button:hover{border-color:var(--fb-blue,#2d9cdb);background:var(--tint-blue,#eef6fb)}.fbb-ok{color:#1b6b3a;font-size:12px}.fbb-bad{color:#8a1e30;font-size:12px}',
        '.fbb-ac-wrap{position:relative}.fbb-ac{position:absolute;left:0;right:0;top:100%;z-index:10;max-height:220px;overflow:auto;background:#fff;border:1px solid var(--border-strong,#c6d0d4);border-radius:6px;box-shadow:0 6px 18px rgba(0,0,0,.14)}',
        '.fbb-ac[hidden]{display:none}.fbb-ac div{display:flex;gap:8px;align-items:baseline;padding:5px 9px;cursor:pointer;font-size:12.5px}',
        '.fbb-ac div.on,.fbb-ac div:hover{background:var(--tint-blue,#eef6fb)}.fbb-ac b{font-weight:600}.fbb-ac small{color:#7a8a91;margin-left:auto;white-space:nowrap}',
        '.fbb-sig{font-size:12px;color:#415157;margin-top:5px;min-height:16px}.fbb-sig code{font-family:var(--mono,Consolas,monospace);background:var(--bg-2,#ebeeed);padding:0 4px;border-radius:3px}',
        '.fbb-pick{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}.fbb-pick button{text-align:left;border:1px solid var(--border,#e3e3e3);border-radius:8px;background:#fff;padding:10px 12px;cursor:pointer}',
        '.fbb-pick button:hover{border-color:var(--fb-blue,#2d9cdb);background:var(--tint-blue,#eef6fb)}.fbb-pick b{display:block;font-size:13px;margin-bottom:3px}.fbb-pick span{font-size:11.5px;color:#506872}',
        '.fbb-open-list{max-height:52vh;overflow:auto}.fbb-open-list button{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid var(--bg-2,#ebeeed);background:#fff;padding:8px 6px;cursor:pointer;font-size:12.5px}',
        '.fbb-open-list button:hover{background:var(--tint-blue,#eef6fb)}.fbb-open-list small{color:#7a8a91;margin-left:8px}'
    ].join('');

    function mount(host, opts) {
        opts = opts || {};
        const cat = opts.catalog || (global.FBModel && global.FBModel.catalog);
        const fbr = global.FB_REPORT || {};
        const DRAFTS_KEY = (fbr.key || 'cdx.bi.reportBuilder') + '.drafts.v1';
        const B = { spec: null, undo: [], redo: [], fields: [], byId: {}, rights: {}, draftId: null, source: null, company: null,
            previewTimer: null, saveTimer: null, pop: null, shut: new Set() };
        const admin = R().View.isAdmin();
        Object.keys(cat.gates || {}).forEach(g => { B.rights[g] = admin || R().View.hasRight(cat.gates[g].right); });

        if (!document.getElementById('fbb-css')) {
            const st = document.createElement('style');
            st.id = 'fbb-css';
            st.textContent = CSS;
            document.head.appendChild(st);
        }
        host.innerHTML = '<div class="fbb">'
            + '<div class="fbb-top"><input class="fbb-title" id="fbbTitle" type="text" title="The report\'s title" aria-label="Report title">'
            + '<select id="fbbSubject" title="What the report is about">' + Object.keys(cat.subjects).map(id => '<option value="' + esc(id) + '">' + esc(cat.subjects[id].label) + '</option>').join('') + '</select>'
            + '<button class="hdr-btn" id="fbbUndo" type="button" title="Undo (Ctrl+Z)">↶ Undo</button><button class="hdr-btn" id="fbbRedo" type="button" title="Redo (Ctrl+Y)">↷ Redo</button>'
            + '<span class="hdr-divider"></span><button class="hdr-btn" id="fbbNew" type="button">New…</button><button class="hdr-btn" id="fbbOpen" type="button">Open…</button>'
            + '<button class="hdr-btn" id="fbbCopy" type="button" title="The definition, to paste into a builder report\'s definition block">Copy definition</button>'
            + '<span class="hdr-divider"></span><button class="hdr-btn hdr-btn-primary" id="fbbPublish" type="button" title="Save this as an app: its name, folder, Apps menus and who can open it">Publish…</button>'
            + '<span class="fbb-sp"></span><span class="fbb-src" id="fbbSrc"></span></div>'
            + '<div class="fbb-fields"><input class="fbb-search" id="fbbSearch" type="text" placeholder="Search fields…" aria-label="Search fields">'
            + '<div class="fbb-tree" id="fbbTree" role="tree"></div><button class="hdr-btn fbb-addcalc" id="fbbCalc" type="button">+ Formula…</button></div>'
            + '<div class="fbb-wells" id="fbbWells"></div>'
            + '<div class="fbb-preview"><div class="fbb-ph">Preview · first 200 rows · totals cover every row</div><div class="fbb-pv" id="fbbPv"></div></div>'
            + '</div>';
        const $ = id => host.querySelector('#' + id);

        // ================================================================ spec helpers
        const step = type => B.spec.steps.find(s => s.type === type);
        const grp = () => step('group');
        const tbl = () => step('table');
        const flt = () => step('filter');
        const field = id => B.byId[id] || null;
        const isMeasure = id => { const f = field(id); return !!(f && f.measure); };
        const isDate = id => { const f = field(id); return !!(f && f.type === 'date'); };
        let seq = 0;
        const uid = p => p + Date.now().toString(36).slice(-4) + (seq++).toString(36);

        function newSpec(subject) {
            const s = cat.subjects[subject];
            const spec = { kind: 'fb-report-spec', v: R().SPEC_VERSION, catalog: { id: cat.id, version: cat.version }, subject,
                title: 'New ' + s.label.toLowerCase() + ' report', description: '', calcs: [], params: [],
                steps: [{ id: 'src', type: 'source', subject }, { id: 'flt', type: 'filter', in: 'src', all: [] },
                    { id: 'grp', type: 'group', in: 'flt', detail: false, levels: [] }, { id: 'tbl', type: 'table', in: 'grp', columns: [], sort: [] }],
                page: { size: 'Letter', orientation: 'portrait' }, ui: { flow: { positions: {} } } };
            if (s.defaultDate) {
                spec.params.push({ id: 'p.date', label: (cat.fields[s.defaultDate.field] || {}).label || 'Date', field: s.defaultDate.field,
                    op: 'between', value: { preset: s.defaultDate.preset || 'current_fy' }, ask: true });
                spec.steps[1].all.push({ param: 'p.date' });
            }
            return spec;
        }
        function loadFields() {
            const list = R().catalog.fieldsFor(cat, B.spec.subject).slice();
            (B.spec.calcs || []).forEach(c => list.push({ id: c.id, label: c.label || c.id, folder: 'Formulas', type: c.type || (c.kind === 'row' ? 'number' : 'number'),
                desc: 'Your formula: ' + toLabels(c.expr), measure: c.kind !== 'row', calc: c }));
            B.fields = list;
            B.byId = {};
            list.forEach(f => { B.byId[f.id] = f; });
        }
        const locked = f => !!(f.gate && !B.rights[f.gate]);
        const lockNote = f => 'Needs the ' + ((cat.gates[f.gate] || {}).right || f.gate) + ' right';

        // ================================================================ undo / redo / autosave
        function commit(fn, opts2) {
            B.undo.push(JSON.stringify(B.spec));
            if (B.undo.length > MAX_UNDO) B.undo.shift();
            B.redo = [];
            fn(B.spec);
            changed(opts2);
        }
        function changed(opts2) {
            if (!opts2 || !opts2.keepFields) loadFields();
            renderAll();
            schedulePreview();
            scheduleSave();
        }
        function undo() {
            if (!B.undo.length) return;
            B.redo.push(JSON.stringify(B.spec));
            B.spec = JSON.parse(B.undo.pop());
            changed();
        }
        function redo() {
            if (!B.redo.length) return;
            B.undo.push(JSON.stringify(B.spec));
            B.spec = JSON.parse(B.redo.pop());
            changed();
        }

        // ================================================================ edits
        function columnIndex(ref, bucket) {
            return tbl().columns.findIndex(c => c.ref === ref && (c.bucket || null) === (bucket || null));
        }
        function addLevel(id, at) {
            const f = field(id);
            if (!f) return;
            if (f.measure) { say(f.label + ' is a figure to total: it goes in Columns.'); return; }
            const levels = grp().levels;
            if (levels.some(l => l.field === id)) { say(f.label + ' is already a group.'); return; }
            // A group is a heading row: it doesn't need a column of its own.
            commit(() => {
                const lv = { field: id };
                if (f.type === 'date') lv.bucket = 'month';
                levels.splice(at == null ? levels.length : at, 0, lv);
            });
        }
        function addColumn(id, at) {
            const f = field(id);
            if (!f) return;
            // In a summary a date column is shown by month (change it on the chip); in line detail as the date.
            const bucket = f.type === 'date' && !grp().detail ? 'month' : null;
            if (columnIndex(id, bucket) >= 0) { say(f.label + ' is already a column.'); return; }
            commit(() => {
                const cols = tbl().columns;
                const col = { id: uid('c'), ref: id };
                if (bucket) col.bucket = bucket;
                cols.splice(at == null ? cols.length : at, 0, col);
            });
        }
        function addFilter(id) {
            const f = field(id);
            if (!f) return;
            if (f.measure) { say('Filters work on values per line. ' + f.label + ' is a figure to total.'); return; }
            commit(s => {
                const p = { id: uid('p'), label: f.label, field: id, ask: true };
                const kind = filterKind(f);
                if (kind === 'date') { p.op = 'between'; p.value = { preset: 'current_fy' }; }
                else if (kind === 'list') { p.op = 'in'; p.value = []; }
                else if (kind === 'number') { p.op = 'gte'; p.value = ''; }
                else { p.op = 'contains'; p.value = ''; }
                s.params.push(p);
                flt().all.push({ param: p.id });
            });
        }
        function addSort(colId, dir) {
            commit(() => { tbl().sort = [{ col: colId, dir: dir || 'desc' }]; });
        }
        function removeLevel(i) {
            commit(() => { grp().levels.splice(i, 1); });
        }
        function removeColumn(i) {
            commit(() => {
                tbl().columns.splice(i, 1);
                pruneSort();
            });
        }
        function removeFilter(i) {
            commit(s => {
                const cond = flt().all.splice(i, 1)[0];
                if (cond && cond.param) s.params = s.params.filter(p => p.id !== cond.param);
            });
        }
        function pruneSort() {
            const ids = new Set(tbl().columns.map(c => c.id));
            tbl().sort = (tbl().sort || []).filter(x => ids.has(x.col));
        }
        function move(list, from, to) {
            if (from === to || from < 0 || from >= list.length) return;
            const [x] = list.splice(from, 1);
            list.splice(Math.max(0, Math.min(to > from ? to - 1 : to, list.length)), 0, x);
        }
        function setSubject(subject) {
            if (subject === B.spec.subject) return;
            const old = B.spec;
            commit(s => {
                const fresh = newSpec(subject);
                const keep = new Set(R().catalog.fieldsFor(cat, subject).map(f => f.id));
                (old.calcs || []).forEach(c => keep.add(c.id));
                const dropped = [];
                fresh.title = old.title;
                fresh.description = old.description;
                fresh.calcs = old.calcs || [];
                const og = old.steps.find(x => x.type === 'group'), ot = old.steps.find(x => x.type === 'table');
                fresh.steps[2].detail = og.detail;
                fresh.steps[2].levels = og.levels.filter(l => keep.has(l.field) || (dropped.push(labelOf(l.field)), false));
                fresh.steps[3].columns = ot.columns.filter(c => keep.has(c.ref) || (dropped.push(labelOf(c.ref)), false));
                fresh.steps[3].sort = (ot.sort || []).filter(x => fresh.steps[3].columns.some(c => c.id === x.col));
                // Filters: keep those still possible (the subject's own date filter replaces an old date filter).
                const oldParams = (old.params || []).filter(p => keep.has(p.field) && !(p.id === 'p.date'));
                oldParams.forEach(p => { fresh.params.push(p); fresh.steps[1].all.push({ param: p.id }); });
                (old.params || []).forEach(p => { if (!keep.has(p.field)) dropped.push(labelOf(p.field) + ' filter'); });
                Object.assign(s, fresh);
                Object.keys(s).forEach(k => { if (!(k in fresh)) delete s[k]; });
                if (dropped.length) say('Left out, because ' + cat.subjects[subject].label + ' doesn\'t have them: ' + [...new Set(dropped)].join(', ') + '.');
            });
        }
        function labelOf(id) {
            const f = field(id) || (cat.fields[id] ? { label: cat.fields[id].label } : null);
            const c = (B.spec.calcs || []).find(x => x.id === id);
            return c ? c.label || id : f ? f.label : id;
        }
        function filterKind(f) {
            const cf = cat.fields[f.id];
            if (f.type === 'date') return 'date';
            if (cf && (cf.lookup || cf.key || cf.fanout)) return 'list';
            if (NUMERIC[f.type]) return 'number';
            return 'text';
        }

        // ================================================================ formulas: labels <-> ids
        function toLabels(expr) {
            return String(expr || '').replace(/\[([A-Za-z0-9_.]+)\]/g, (m, id) => (B.byId[id] || cat.fields[id]) ? '[' + labelOf(id) + ']' : m);
        }
        function toIds(text) {
            const byLabel = {};
            B.fields.forEach(f => { const k = f.label.toLowerCase(); if (!byLabel[k]) byLabel[k] = f.id; });
            return String(text || '').replace(/\[([^\]]+)\]/g, (m, name) => {
                const id = byLabel[name.trim().toLowerCase()];
                return id ? '[' + id + ']' : (B.byId[name.trim()] ? '[' + name.trim() + ']' : m);
            });
        }

        // ================================================================ rendering
        function renderAll() {
            $('fbbTitle').value = B.spec.title || '';
            $('fbbSubject').value = B.spec.subject;
            $('fbbUndo').disabled = !B.undo.length;
            $('fbbRedo').disabled = !B.redo.length;
            $('fbbSrc').textContent = B.source ? 'Editing "' + B.source.name + '"' : B.draftId ? 'Draft' : '';
            renderTree();
            renderWells();
        }
        function renderTree() {
            const q = $('fbbSearch').value.trim().toLowerCase();
            const byFolder = {};
            B.fields.forEach(f => {
                if (q && (f.label + ' ' + (f.desc || '')).toLowerCase().indexOf(q) < 0) return;
                (byFolder[f.folder] = byFolder[f.folder] || []).push(f);
            });
            const order = FOLDERS.filter(x => byFolder[x]).concat(Object.keys(byFolder).filter(x => FOLDERS.indexOf(x) < 0));
            $('fbbTree').innerHTML = order.map(folder => '<div class="fbb-folder' + (B.shut.has(folder) && !q ? ' shut' : '') + '" data-folder="' + esc(folder) + '">'
                + '<div class="fbb-folder-h">' + esc(folder) + '</div>'
                + byFolder[folder].map(f => '<div class="fbb-item' + (f.measure ? ' measure' : '') + (locked(f) ? ' locked' : '') + '" role="treeitem" tabindex="0" draggable="' + (!locked(f)) + '"'
                    + ' data-field="' + esc(f.id) + '" title="' + esc((locked(f) ? lockNote(f) + '. ' : '') + (f.desc || f.label)) + '">'
                    + '<span class="fbb-ic">' + (f.measure ? 'Σ' : (ICON[f.type] || 'Abc')) + '</span><span>' + esc(f.label) + '</span>'
                    + (locked(f) ? '<span class="fbb-lock">🔒</span>' : '') + '</div>').join('') + '</div>').join('')
                || '<div style="padding:10px;color:#7a8a91;font-size:12px">No field matches.</div>';
        }
        function chipHtml(well, i, label, sub, measure, err) {
            return '<span class="fbb-chip' + (measure ? ' measure' : '') + (err ? ' err' : '') + '" tabindex="0" draggable="true" data-well="' + well + '" data-i="' + i + '"'
                + (err ? ' title="' + esc(err) + '"' : '') + '>' + esc(label) + (sub ? ' <span class="fbb-sub">' + esc(sub) + '</span>' : '')
                + '<button class="fbb-x" type="button" data-x="' + well + ':' + i + '" aria-label="Remove">×</button></span>';
        }
        function renderWells() {
            const plan = compileNow();
            const bad = new Set((plan.errors || []).map(e => e.ref).filter(Boolean).concat((plan.warnings || []).filter(w => w.code === 'gated' || w.code === 'missingField').map(w => w.ref)));
            const errOf = ref => (plan.errors || []).concat(plan.warnings || []).filter(e => e.ref === ref).map(e => e.message).join(' ');
            const g = grp(), t = tbl();
            const levels = g.levels.map((l, i) => chipHtml('group', i, labelOf(l.field), l.bucket ? 'by ' + (BUCKETS.find(b => b[0] === l.bucket) || [0, l.bucket])[1].toLowerCase() : '', false, bad.has(l.field) ? errOf(l.field) : ''));
            const bucketName = b => ((BUCKETS.find(x => x[0] === b) || [0, b])[1]).toLowerCase();
            const cols = t.columns.map((c, i) => chipHtml('columns', i, c.label || labelOf(c.ref), c.bucket ? 'by ' + bucketName(c.bucket) : '', isMeasure(c.ref), bad.has(c.ref) ? errOf(c.ref) : ''));
            const filters = flt().all.map((cond, i) => {
                const p = B.spec.params.find(x => x.id === cond.param);
                return p ? chipHtml('filters', i, p.label || labelOf(p.field), describeFilter(p) + (p.ask ? ' · asked' : ''), false, bad.has(p.field) ? errOf(p.field) : '') : '';
            });
            const sorts = (t.sort || []).map((s2, i) => {
                const c = t.columns.find(x => x.id === s2.col);
                return c ? chipHtml('sort', i, c.label || labelOf(c.ref), s2.dir === 'desc' ? 'high → low' : 'low → high', false, '') : '';
            });
            const well = (id, title, chips, hint) => '<div class="fbb-well"><div class="fbb-well-h">' + title + '</div><div class="fbb-drop" data-drop="' + id + '">'
                + (chips.length ? chips.join('') : '<span class="fbb-hint">' + hint + '</span>') + '</div></div>';
            const msgs = (plan.errors || []).map(e => '<div class="e">✕ ' + esc(e.message) + '</div>')
                .concat((plan.warnings || []).map(w => '<div class="w">ℹ ' + esc(w.message) + '</div>'));
            $('fbbWells').innerHTML = well('group', 'Group by', levels, 'Drag fields here for group headings, with subtotals (customer, month…)')
                + well('columns', 'Columns', cols, 'Drag the fields and figures each row shows. In a summary, one row per combination of the fields.')
                + well('filters', 'Filters', filters, 'Drag a field here to filter by it')
                + well('sort', 'Sort', sorts, 'Drag a column here to sort by it')
                + '<div class="fbb-opts"><label><input type="checkbox" id="fbbDetail"' + (g.detail ? ' checked' : '') + '> Show line detail under the groups</label></div>'
                + (msgs.length ? '<div class="fbb-msgs">' + msgs.join('') + '</div>' : '');
            $('fbbDetail').onchange = e => setDetail(e.target.checked);
        }
        function describeFilter(p) {
            const f = field(p.field) || {};
            const v = p.value;
            const kind = filterKind(f.id ? f : { id: p.field, type: 'text' });
            const opLabel = ((OPS[kind] || []).find(o => o[0] === p.op) || [0, p.op])[1];
            if (p.op === 'blank' || p.op === 'notBlank') return opLabel;
            if (kind === 'date') {
                if (v && v.preset) return ((R().Dates.PRESETS.find(x => x[0] === v.preset) || [0, v.preset])[1]).toLowerCase();
                if (p.op === 'between') return (v && v.from || '…') + ' – ' + (v && v.to || '…');
                return opLabel + ' ' + (v || '…');
            }
            if (Array.isArray(v)) return v.length ? opLabel + ' ' + v.length + ' chosen' : 'any';
            if (v && typeof v === 'object') return opLabel + ' ' + (v.from || '…') + ' and ' + (v.to || '…');
            return v === '' || v == null ? 'any' : opLabel + ' ' + v;
        }
        function setDetail(on) {
            commit(() => {
                grp().detail = on;
                // A summary can't show an exact date per row: show such columns by day.
                if (!on) tbl().columns.forEach(c => { if (isDate(c.ref) && !c.bucket) c.bucket = 'day'; });
            });
        }
        function compileNow() {
            try {
                return R().Sql.compile(B.spec, cat, { lgIds: [1], rights: B.rights, today: R().Dates.fmt(new Date()), fyStart: 7 });
            } catch (e) {
                return { errors: [{ message: e.message }], warnings: [] };
            }
        }

        // ================================================================ preview
        function schedulePreview() {
            clearTimeout(B.previewTimer);
            B.previewTimer = setTimeout(renderPreview, 450);
        }
        function renderPreview() {
            const pv = $('fbbPv');
            if (!tbl().columns.length) {
                pv.innerHTML = '<div style="padding:40px;text-align:center;color:#7a8a91">Drag fields from the left into Columns to start.</div>';
                return;
            }
            R().View.mount(pv, JSON.parse(JSON.stringify(B.spec)), { catalog: cat, preview: true, cap: 200, company: B.company });
        }

        // ================================================================ drafts
        function readDrafts() {
            try {
                const raw = typeof loadSettings === 'function' ? loadSettings(DRAFTS_KEY) : '';
                const d = raw ? JSON.parse(raw) : null;
                return d && Array.isArray(d.list) ? d.list : [];
            } catch (_) { return []; }
        }
        function writeDrafts(list) {
            try { if (typeof saveSettings === 'function') saveSettings(DRAFTS_KEY, JSON.stringify({ v: 1, list: list.slice(0, 20) })); } catch (_) { /* no settings */ }
        }
        function scheduleSave() {
            clearTimeout(B.saveTimer);
            B.saveTimer = setTimeout(() => {
                if (!B.draftId) B.draftId = uid('d');
                const list = readDrafts().filter(d => d.id !== B.draftId);
                list.unshift({ id: B.draftId, title: B.spec.title, savedAt: new Date().toISOString(), source: B.source, spec: B.spec });
                writeDrafts(list);
                $('fbbSrc').textContent = (B.source ? 'Editing "' + B.source.name + '" · ' : '') + 'Draft saved ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }, 1500);
        }

        // ================================================================ popovers
        function closePop() {
            if (B.pop) { B.pop.remove(); B.pop = null; }
        }
        function pop(anchor, html, wire) {
            closePop();
            const el = document.createElement('div');
            el.className = 'fbb-pop';
            el.innerHTML = html;
            document.body.appendChild(el);
            const r = anchor.getBoundingClientRect();
            const w = el.offsetWidth, h = el.offsetHeight;
            el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
            el.style.top = (r.bottom + 6 + h > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
            B.pop = el;
            wire(el);
            const first = el.querySelector('input,select');
            if (first) first.focus();
        }
        document.addEventListener('mousedown', e => { if (B.pop && !B.pop.contains(e.target) && !e.target.closest('.fbb-chip')) closePop(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closePop(); });

        function editColumn(i, anchor) {
            const c = tbl().columns[i];
            const f = field(c.ref) || { label: c.ref, type: 'text' };
            const numeric = NUMERIC[f.type] || f.measure;
            const fmt = c.format || {};
            pop(anchor, '<label>Heading</label><input type="text" id="pLbl" value="' + esc(c.label || '') + '" placeholder="' + esc(f.label) + '">'
                + (numeric ? '<label>Format</label><div class="fbb-row"><select id="pFmt"><option value="">Standard</option><option value="money">Money</option>'
                    + '<option value="number">Number</option><option value="percent">Percent</option><option value="int">Whole number</option></select>'
                    + '<select id="pDp" style="width:90px" title="Decimals"><option value="">Decimals</option>' + [0, 1, 2, 3, 4].map(n => '<option value="' + n + '">' + n + '</option>').join('') + '</select></div>' : '')
                + (f.measure ? '<label class="fbb-check"><input type="checkbox" id="pTot"' + (c.total !== false ? ' checked' : '') + '> Show on group and total rows</label>' : '')
                + (f.type === 'date' ? '<label>Show as</label><select id="pBk">' + (grp().detail ? '<option value="">The date</option>' : '') + BUCKETS.map(b => '<option value="' + b[0] + '">' + b[1] + '</option>').join('') + '</select>' : '')
                + '<div class="fbb-actions"><button class="hdr-btn" type="button" id="pDel">Remove</button><button class="ds-btn ds-btn-primary" type="button" id="pOk">Done</button></div>',
            el => {
                if (el.querySelector('#pFmt')) { el.querySelector('#pFmt').value = fmt.type || ''; el.querySelector('#pDp').value = Number.isInteger(fmt.dp) ? String(fmt.dp) : ''; }
                if (el.querySelector('#pBk')) el.querySelector('#pBk').value = c.bucket || '';
                el.querySelector('#pDel').onclick = () => { closePop(); removeColumn(i); };
                el.querySelector('#pOk').onclick = () => {
                    const lbl = el.querySelector('#pLbl').value.trim();
                    const ft = el.querySelector('#pFmt') ? el.querySelector('#pFmt').value : '';
                    const dp = el.querySelector('#pDp') ? el.querySelector('#pDp').value : '';
                    const tot = el.querySelector('#pTot') ? el.querySelector('#pTot').checked : true;
                    const bk = el.querySelector('#pBk') ? el.querySelector('#pBk').value : c.bucket;
                    closePop();
                    commit(() => {
                        const col = tbl().columns[i];
                        if (lbl) col.label = lbl; else delete col.label;
                        if (ft || dp !== '') col.format = Object.assign({}, ft ? { type: ft } : {}, dp !== '' ? { dp: parseInt(dp, 10) } : {}); else delete col.format;
                        if (f.measure) { if (tot) delete col.total; else col.total = false; }
                        if (f.type === 'date') { if (bk) col.bucket = bk; else delete col.bucket; }
                    });
                };
            });
        }
        function editLevel(i, anchor) {
            const l = grp().levels[i];
            const f = field(l.field) || { label: l.field };
            pop(anchor, '<label>Group by ' + esc(f.label) + '</label>'
                + (f.type === 'date' ? '<select id="pBk">' + BUCKETS.map(b => '<option value="' + b[0] + '">' + b[1] + '</option>').join('') + '</select>' : '<p style="margin:4px 0;color:#506872">One group per ' + esc(f.label.toLowerCase()) + '.</p>')
                + '<div class="fbb-actions"><button class="hdr-btn" type="button" id="pDel">Remove</button><button class="ds-btn ds-btn-primary" type="button" id="pOk">Done</button></div>',
            el => {
                if (el.querySelector('#pBk')) el.querySelector('#pBk').value = l.bucket || 'month';
                el.querySelector('#pDel').onclick = () => { closePop(); removeLevel(i); };
                el.querySelector('#pOk').onclick = () => {
                    const bk = el.querySelector('#pBk') ? el.querySelector('#pBk').value : null;
                    closePop();
                    if (!bk || bk === l.bucket) return;
                    commit(() => { grp().levels[i].bucket = bk; });
                };
            });
        }
        function editSort(i, anchor) {
            const s2 = tbl().sort[i];
            pop(anchor, '<label>Order</label><select id="pDir"><option value="desc">Highest first</option><option value="asc">Lowest first</option></select>'
                + '<div class="fbb-actions"><button class="hdr-btn" type="button" id="pDel">Remove</button><button class="ds-btn ds-btn-primary" type="button" id="pOk">Done</button></div>',
            el => {
                el.querySelector('#pDir').value = s2.dir === 'asc' ? 'asc' : 'desc';
                el.querySelector('#pDel').onclick = () => { closePop(); commit(() => { tbl().sort.splice(i, 1); }); };
                el.querySelector('#pOk').onclick = () => { const d = el.querySelector('#pDir').value; closePop(); commit(() => { tbl().sort[i].dir = d; }); };
            });
        }
        async function editFilter(i, anchor) {
            const cond = flt().all[i];
            const p = B.spec.params.find(x => x.id === cond.param);
            if (!p) return;
            const f = field(p.field) || { id: p.field, label: p.field, type: 'text' };
            const kind = filterKind(f);
            const cf = cat.fields[p.field] || {};
            let items = [];
            if (kind === 'list' && cf.lookup) {
                try { items = (await R().View.runSql('Values for ' + f.label, cf.lookup)).map(r => ({ v: String(r.v), l: String(r.l == null ? r.v : r.l) })); } catch (e) { say('The list for ' + f.label + ' didn\'t load: ' + e.message); }
            }
            const v = p.value;
            const sel = new Set((Array.isArray(v) ? v : []).map(String));
            const valueHtml = () => {
                if (kind === 'date') {
                    return '<div id="pVd"><select id="pPre">' + R().Dates.PRESETS.map(x => '<option value="' + x[0] + '">' + esc(x[1]) + '</option>').join('') + '<option value="custom">Custom range…</option></select>'
                        + '<div class="fbb-row" id="pCus" style="margin-top:6px"><input type="date" id="pFrom"><input type="date" id="pTo"></div>'
                        + '<input type="date" id="pOne" style="margin-top:6px"></div>';
                }
                if (kind === 'list') {
                    return items.length ? '<div class="fbb-list">' + items.map(it => '<label class="fbb-check"><input type="checkbox" value="' + esc(it.v) + '"' + (sel.has(it.v) ? ' checked' : '') + '> ' + esc(it.l) + '</label>').join('') + '</div>'
                        : '<input type="text" id="pTxt" placeholder="Values, separated by commas">';
                }
                if (kind === 'number') return '<div class="fbb-row"><input type="number" id="pN1"><input type="number" id="pN2" placeholder="and"></div>';
                return '<input type="text" id="pTxt">';
            };
            pop(anchor, '<label>Name in the filters panel</label><input type="text" id="pLbl" value="' + esc(p.label || f.label) + '">'
                + '<label>' + esc(f.label) + '</label><select id="pOp">' + (OPS[kind] || OPS.text).map(o => '<option value="' + o[0] + '">' + esc(o[1]) + '</option>').join('') + '</select>'
                + '<div style="margin-top:6px" id="pVal">' + valueHtml() + '</div>'
                + '<label class="fbb-check"><input type="checkbox" id="pAsk"' + (p.ask ? ' checked' : '') + '> Ask when the report runs</label>'
                + '<div class="fbb-actions"><button class="hdr-btn" type="button" id="pDel">Remove</button><button class="ds-btn ds-btn-primary" type="button" id="pOk">Done</button></div>',
            el => {
                const q = s => el.querySelector(s);
                q('#pOp').value = p.op || (OPS[kind] || OPS.text)[0][0];
                const sync = () => {
                    const op = q('#pOp').value;
                    q('#pVal').style.display = op === 'blank' || op === 'notBlank' ? 'none' : '';
                    if (kind === 'date') {
                        const custom = q('#pPre').value === 'custom';
                        q('#pPre').style.display = op === 'between' ? '' : 'none';
                        q('#pCus').style.display = op === 'between' && custom ? '' : 'none';
                        q('#pOne').style.display = op === 'before' || op === 'after' ? '' : 'none';
                    }
                    if (kind === 'number') q('#pN2').style.display = op === 'between' ? '' : 'none';
                };
                if (kind === 'date') {
                    q('#pPre').value = v && v.preset ? v.preset : 'custom';
                    q('#pFrom').value = v && v.from ? v.from : '';
                    q('#pTo').value = v && v.to ? v.to : '';
                    q('#pOne').value = typeof v === 'string' ? v : '';
                    q('#pPre').onchange = sync;
                } else if (kind === 'number') {
                    q('#pN1').value = v && typeof v === 'object' ? (v.from == null ? '' : v.from) : (v == null ? '' : v);
                    q('#pN2').value = v && typeof v === 'object' ? (v.to == null ? '' : v.to) : '';
                } else if (q('#pTxt')) {
                    q('#pTxt').value = Array.isArray(v) ? v.join(', ') : (v == null ? '' : v);
                }
                q('#pOp').onchange = sync;
                sync();
                q('#pDel').onclick = () => { closePop(); removeFilter(i); };
                q('#pOk').onclick = () => {
                    const op = q('#pOp').value;
                    let val;
                    if (kind === 'date') {
                        val = op === 'between' ? (q('#pPre').value === 'custom' ? { from: q('#pFrom').value || null, to: q('#pTo').value || null } : { preset: q('#pPre').value }) : q('#pOne').value;
                    } else if (kind === 'list') {
                        val = items.length ? [...el.querySelectorAll('.fbb-list input:checked')].map(x => cf.key ? Number(x.value) : x.value)
                            : q('#pTxt').value.split(',').map(x => x.trim()).filter(Boolean);
                    } else if (kind === 'number') {
                        val = op === 'between' ? { from: q('#pN1').value, to: q('#pN2').value } : q('#pN1').value;
                    } else {
                        val = q('#pTxt').value;
                    }
                    const lbl = q('#pLbl').value.trim() || f.label;
                    const ask = q('#pAsk').checked;
                    closePop();
                    commit(s => {
                        const pp = s.params.find(x => x.id === p.id);
                        pp.op = op;
                        pp.value = val;
                        pp.label = lbl;
                        pp.ask = ask;
                    });
                };
            });
        }

        // ================================================================ dialogs
        function modal(title, body, buttons) {
            const bg = document.createElement('div');
            bg.className = 'fbb-modal-bg';
            bg.innerHTML = '<div class="fbb-modal" role="dialog" aria-label="' + esc(title) + '"><h2>' + esc(title) + '</h2><div class="fbb-mb">' + body + '</div>'
                + '<div class="fbb-mf">' + buttons.map((b, i) => '<button type="button" class="' + (b.primary ? 'ds-btn ds-btn-primary' : 'hdr-btn') + '" data-b="' + i + '">' + esc(b.label) + '</button>').join('') + '</div></div>';
            document.body.appendChild(bg);
            const close = () => bg.remove();
            buttons.forEach((b, i) => { bg.querySelector('[data-b="' + i + '"]').onclick = () => { if (!b.run || b.run(bg) !== false) close(); }; });
            bg.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
            return bg;
        }
        function pickSubject(then) {
            const m = modal('What do you want to report on?', '<div class="fbb-pick">' + Object.keys(cat.subjects).map(id =>
                '<button type="button" data-s="' + esc(id) + '"><b>' + esc(cat.subjects[id].label) + '</b><span>' + esc(cat.subjects[id].desc) + '</span></button>').join('') + '</div>',
            [{ label: 'Cancel' }]);
            m.querySelectorAll('[data-s]').forEach(b => { b.onclick = () => { m.remove(); then(b.dataset.s); }; });
        }
        function newReport() {
            pickSubject(subject => {
                B.undo.push(JSON.stringify(B.spec));
                B.spec = newSpec(subject);
                B.source = null;
                B.draftId = null;
                changed();
            });
        }
        async function openDialog() {
            let apps = [];
            try {
                apps = await R().View.runSql('Builder reports', "SELECT s.id AS id, s.name AS name, s.description AS d FROM biscript s WHERE s.typeId = 10 AND s.active+0 = 1"
                    + " AND LOCATE(CONCAT('name=\"fb', '-builder\"'), s.data) > 0 ORDER BY s.name");
            } catch (e) { say('The list of builder reports didn\'t load: ' + e.message); }
            const drafts = readDrafts();
            const m = modal('Open', '<label>Builder reports</label><div class="fbb-open-list">' + (apps.length ? apps.map(a => '<button type="button" data-app="' + esc(a.id) + '">' + esc(a.name) + '<small>' + esc(a.d || '') + '</small></button>').join('') : '<p style="color:#7a8a91">None yet.</p>') + '</div>'
                + '<label>Your drafts</label><div class="fbb-open-list">' + (drafts.length ? drafts.map(d => '<button type="button" data-draft="' + esc(d.id) + '">' + esc(d.title || 'Untitled') + '<small>' + esc(new Date(d.savedAt).toLocaleString()) + (d.source ? ' · from ' + esc(d.source.name) : '') + '</small></button>').join('') : '<p style="color:#7a8a91">None yet.</p>') + '</div>',
            [{ label: 'Cancel' }]);
            m.querySelectorAll('[data-app]').forEach(b => { b.onclick = async () => { m.remove(); await openApp(Number(b.dataset.app)); }; });
            m.querySelectorAll('[data-draft]').forEach(b => {
                b.onclick = () => {
                    m.remove();
                    const d = drafts.find(x => x.id === b.dataset.draft);
                    if (!d) return;
                    B.undo.push(JSON.stringify(B.spec));
                    B.spec = R().migrate(d.spec);
                    B.draftId = d.id;
                    B.source = d.source || null;
                    changed();
                };
            });
        }
        async function openApp(id) {
            try {
                const rows = await R().View.runSql('Report', 'SELECT name, data FROM biscript WHERE id = ' + Number(id));
                const data = rows[0] && rows[0].data ? String(rows[0].data) : '';
                const a = data.indexOf(SPEC_OPEN), b = a < 0 ? -1 : data.indexOf(SPEC_CLOSE, a);
                if (a < 0 || b < 0) { say('That report has no definition the builder can read.'); return; }
                const spec = JSON.parse(data.slice(a + SPEC_OPEN.length, b));
                B.undo.push(JSON.stringify(B.spec));
                B.spec = R().migrate(spec);
                B.source = { scriptId: Number(id), name: rows[0].name };
                B.draftId = null;
                changed();
            } catch (e) { say('That report couldn\'t be opened: ' + e.message); }
        }
        function embed(spec) {
            return JSON.stringify(spec, null, 2).replace(/</g, '\\u003c').replace(/\$/g, '\\u0024').replace(/%/g, '\\u0025')
                .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
        }
        // ================================================================ publish
        // The spec goes to the user's own settings (the outbox) and the plugin is asked to
        // publish it; the plugin asks for the name, folder, Apps menus and access, writes
        // the page and saves it. Its fb-builder tag carries the nonce, which tells us the record.
        const OUTBOX_KEY = 'cdx.bi.reportBuilder.outbox.v1';
        let publishPoll = null;
        function publish() {
            const ws = global.FB_WORKSPACE;
            if (typeof openModule !== 'function' || !ws || !ws.module || !ws.publish) {
                say('Publishing works when the Report Builder is open in Apps (beta), with its latest plugin. Copy definition works meanwhile.');
                return;
            }
            const plan = compileNow();
            if ((plan.errors || []).length) { say('Fix the problems listed under the wells first.'); return; }
            const nonce = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
            try {
                saveSettings(OUTBOX_KEY, JSON.stringify({ v: 1, nonce, at: new Date().toISOString(), spec: B.spec,
                    source: B.source ? { scriptId: B.source.scriptId } : null }));
            } catch (e) {
                say('The report couldn\'t be handed over: ' + (e && e.message || e));
                return;
            }
            try { openModule(ws.module, 'build:publish:' + nonce); } catch (e) { say('Publishing couldn\'t start: ' + (e && e.message || e)); return; }
            say('Publishing… finish in the dialog.');
            clearInterval(publishPoll);
            const until = Date.now() + 15 * 60 * 1000;
            publishPoll = setInterval(async () => {
                if (Date.now() > until || !host.isConnected) { clearInterval(publishPoll); return; }
                try {
                    const rows = await R().View.runSql('Published?', "SELECT id, name FROM biscript WHERE typeId = 10 AND LOCATE('p=" + nonce + "', data) > 0 LIMIT 1");
                    if (rows[0]) {
                        clearInterval(publishPoll);
                        B.source = { scriptId: Number(rows[0].id), name: String(rows[0].name) };
                        scheduleSave();
                        renderAll();
                        say('Published as "' + rows[0].name + '". Publishing again updates it.');
                    }
                } catch (_) { /* try again */ }
            }, 2000);
        }

        function copyDefinition() {
            const json = embed(B.spec);
            const m = modal('Copy definition', '<p style="margin:0 0 8px;font-size:12.5px;color:#415157">Until the builder can publish: open the builder report in the App editor, '
                + 'select everything between its definition block\'s opening and closing script tags (the block with id fb-report-spec), paste this over it, and Save.</p>'
                + '<textarea id="fbbJson" rows="16" readonly>' + esc(json) + '</textarea>',
            [{ label: 'Copy', primary: true, run: bg => { copy(bg.querySelector('#fbbJson'), json); return false; } }, { label: 'Close' }]);
            const ta = m.querySelector('#fbbJson');
            ta.focus();
            ta.select();
        }
        function copy(ta, text) {
            ta.focus();
            ta.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
            if (!ok && navigator.clipboard) navigator.clipboard.writeText(text).then(() => say('Copied.'), () => say('Press Ctrl+C to copy.'));
            else say(ok ? 'Copied.' : 'Press Ctrl+C to copy.');
        }
        function formulaDialog(existing) {
            const c = existing || { id: null, label: '', kind: 'aggregate', expr: '' };
            const chips = B.fields.filter(f => !locked(f) && f.id !== c.id).map(f => '<button type="button" data-ins="' + esc(f.label) + '" title="' + esc(f.desc || '') + '">' + (f.measure ? 'Σ ' : '') + esc(f.label) + '</button>').join('');
            const m = modal(existing ? 'Edit formula' : 'New formula',
                '<label>Name</label><input type="text" id="fName" value="' + esc(c.label) + '" placeholder="Gross profit per order">'
                + '<label>Worked out</label><label class="fbb-check"><input type="radio" name="fKind" value="aggregate"' + (c.kind !== 'row' ? ' checked' : '') + '> From each group\'s totals (ratios, averages, profit per order)</label>'
                + '<label class="fbb-check"><input type="radio" name="fKind" value="row"' + (c.kind === 'row' ? ' checked' : '') + '> On every line, then added up (a line\'s value × something)</label>'
                + '<label>Formula</label><div class="fbb-ac-wrap"><textarea id="fExpr" rows="4" spellcheck="false" autocomplete="off" placeholder="IF([Revenue] > 0, [Margin] / [Revenue], 0)">' + esc(toLabels(c.expr)) + '</textarea>'
                + '<div class="fbb-ac" id="fAc" role="listbox" hidden></div></div>'
                + '<div class="fbb-sig" id="fHint">Type <b>[</b> for a field, or the start of a function name.</div>'
                + '<div id="fCheck" style="margin-top:6px"></div>'
                + '<label>Insert a field</label><div class="fbb-chips">' + chips + '</div>'
                + '<p style="font-size:11.5px;color:#506872;margin:10px 0 0">Functions: IF, ROUND, ABS, MIN, MAX, DIVIDE(a, b, if zero), COALESCE, ISBLANK, YEAR, MONTH, DAYS_BETWEEN, ADD_DAYS, TODAY, '
                + 'and over lines: SUM, AVG, COUNT, COUNTDISTINCT, MINOF, MAXOF. Text in \'quotes\'; & joins text.</p>',
            [{ label: 'Cancel' }, { label: existing ? 'Save' : 'Add as a column', primary: true, run: bg => {
                const r = check(bg);
                if (!r.ok) return false;
                commit(s => {
                    const calcs = s.calcs || (s.calcs = []);
                    const id = c.id || 'calc.' + (r.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'formula') + '_' + uid('');
                    const cc = { id, label: r.label, kind: r.kind, expr: r.expr };
                    const at = calcs.findIndex(x => x.id === id);
                    if (at >= 0) calcs[at] = cc; else calcs.push(cc);
                    if (!existing) tbl().columns.push({ id: uid('c'), ref: id });
                });
                return true;
            } }]);
            const ta = m.querySelector('#fExpr');
            autocomplete(m, ta, () => m.querySelector('input[name=fKind]:checked').value, c.id);
            m.querySelectorAll('[data-ins]').forEach(b => {
                b.onclick = () => {
                    const t = '[' + b.dataset.ins + ']';
                    const s0 = ta.selectionStart, s1 = ta.selectionEnd;
                    ta.value = ta.value.slice(0, s0) + t + ta.value.slice(s1);
                    ta.focus();
                    ta.selectionStart = ta.selectionEnd = s0 + t.length;
                    check(m);
                };
            });
            let t = null;
            ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => check(m), 300); });
            m.querySelectorAll('input[name=fKind]').forEach(x => { x.onchange = () => check(m); });
            m.querySelector('#fName').focus();
            if (c.expr) check(m);
            function check(bg) {
                const label = bg.querySelector('#fName').value.trim();
                const kind = bg.querySelector('input[name=fKind]:checked').value;
                const expr = toIds(bg.querySelector('#fExpr').value);
                const out = bg.querySelector('#fCheck');
                if (!expr.trim()) { out.innerHTML = ''; return { ok: false }; }
                if (!label) { out.innerHTML = '<span class="fbb-bad">Give the formula a name.</span>'; return { ok: false }; }
                // Check it the way the report will run it: a spec with this formula as a column.
                const probe = JSON.parse(JSON.stringify(B.spec));
                const id = c.id || 'calc.__probe';
                probe.calcs = (probe.calcs || []).filter(x => x.id !== id).concat([{ id, label, kind, expr }]);
                const pt = probe.steps.find(x => x.type === 'table');
                if (!pt.columns.some(x => x.ref === id)) pt.columns.push({ id: 'probe', ref: id });
                const pg = probe.steps.find(x => x.type === 'group');
                pg.detail = pg.detail || kind === 'row';
                let plan;
                try { plan = R().Sql.compile(probe, cat, { lgIds: [1], rights: B.rights, today: R().Dates.fmt(new Date()), fyStart: 7 }); } catch (e) { plan = { errors: [{ message: e.message }] }; }
                const errs = (plan.errors || []).filter(e => !e.ref || e.ref === id || /formula|\[/.test(e.message));
                const unknown = (expr.match(/\[[^\]]+\]/g) || []).filter(x => !B.byId[x.slice(1, -1)] && x.slice(1, -1) !== id);
                if (unknown.length) { out.innerHTML = '<span class="fbb-bad">' + esc(unknown.join(', ')) + ' isn\'t a field here. Use the buttons below to insert one.</span>'; return { ok: false }; }
                if (errs.length) { out.innerHTML = '<span class="fbb-bad">' + esc(errs[0].message.replace(/^"[^"]*": /, '')) + '</span>'; return { ok: false }; }
                out.innerHTML = '<span class="fbb-ok">✓ Looks right.</span>';
                return { ok: true, label, kind, expr };
            }
        }

        /**
         * The formula box's suggestions: after "[" the fields (by name, anywhere in it),
         * while a word is typed the functions and words that start with it, and inside a
         * function's brackets a hint naming the value the cursor is on.
         */
        function autocomplete(m, ta, kindOf, selfId) {
            const list = m.querySelector('#fAc');
            const hint = m.querySelector('#fHint');
            let items = [], at = 0, ctx = null;
            const close = () => { list.hidden = true; items = []; ctx = null; };
            function context() {
                const pre = ta.value.slice(0, ta.selectionStart);
                // Inside quotes: no suggestions.
                if ((pre.match(/'/g) || []).length % 2 === 1) return null;
                const f = /\[([^\[\]]*)$/.exec(pre);
                if (f) return { kind: 'field', q: f[1], from: pre.length - f[1].length - 1 };
                const w = /(^|[^A-Za-z0-9_\]\[])([A-Za-z_][A-Za-z0-9_]*)$/.exec(pre);
                if (w) return { kind: 'fn', q: w[2], from: pre.length - w[2].length };
                return null;
            }
            function suggest() {
                ctx = context();
                if (!ctx) { close(); signature(); return; }
                const q = ctx.q.toLowerCase();
                const agg = kindOf() !== 'row';
                if (ctx.kind === 'field') {
                    const ok = B.fields.filter(f => !locked(f) && f.id !== selfId && (!q || f.label.toLowerCase().indexOf(q) >= 0));
                    ok.sort((a, b) => (a.label.toLowerCase().indexOf(q) === 0 ? 0 : 1) - (b.label.toLowerCase().indexOf(q) === 0 ? 0 : 1)
                        || (b.measure === agg) - (a.measure === agg) || a.label.localeCompare(b.label));
                    items = ok.slice(0, 40).map(f => ({ text: '[' + f.label + ']', html: (f.measure ? 'Σ ' : '') + '<b>' + esc(f.label) + '</b>',
                        note: f.measure ? (agg ? 'a total' : 'its value per line') : f.type === 'date' ? 'a date' : f.folder }));
                } else {
                    items = FUNCS.filter(fn => fn[0].toLowerCase().indexOf(q) === 0 && (agg || !fn[3]))
                        .map(fn => ({ text: fn[0] + '(' + (fn[1].length ? '' : ')'), html: '<b>' + fn[0] + '</b>(' + esc(fn[1].join(', ')) + ')', note: fn[2] }))
                        .concat(WORDS.filter(wd => wd[0].toLowerCase().indexOf(q) === 0).map(wd => ({ text: wd[0] + ' ', html: '<b>' + wd[0] + '</b>', note: wd[1] })));
                    // A whole word already typed needs no list.
                    if (items.length === 1 && items[0].text.replace(/[( ]+$/, '').toLowerCase() === q && ctx.q.length > 2) items = [];
                }
                if (!items.length) { close(); signature(); return; }
                at = 0;
                list.innerHTML = items.map((it, i) => '<div role="option" data-i="' + i + '"' + (i === at ? ' class="on"' : '') + '><span>' + it.html + '</span><small>' + esc(it.note || '') + '</small></div>').join('');
                list.hidden = false;
                signature();
            }
            function pick(i) {
                const it = items[i];
                if (!it || !ctx) return;
                const v = ta.value, end = ta.selectionStart;
                // Skip a closing bracket already there.
                const after = ctx.kind === 'field' && v[end] === ']' ? end + 1 : end;
                ta.value = v.slice(0, ctx.from) + it.text + v.slice(after);
                const caret = ctx.from + it.text.length;
                ta.focus();
                ta.selectionStart = ta.selectionEnd = caret;
                close();
                signature();
                ta.dispatchEvent(new Event('input'));
            }
            function highlight(i) {
                at = (i + items.length) % items.length;
                list.querySelectorAll('div').forEach((d, k) => d.classList.toggle('on', k === at));
                const on = list.children[at];
                if (on) on.scrollIntoView({ block: 'nearest' });
            }
            // Inside FN( … ): which function, and which of its values the cursor is on.
            function signature() {
                const pre = ta.value.slice(0, ta.selectionStart);
                let depth = 0, commas = 0, inQ = false, inF = false;
                for (let i = pre.length - 1; i >= 0; i--) {
                    const ch = pre[i];
                    if (ch === "'") { inQ = !inQ; continue; }
                    if (inQ) continue;
                    if (ch === ']') { inF = true; continue; }
                    if (ch === '[') { inF = false; continue; }
                    if (inF) continue;
                    if (ch === ')') depth++;
                    else if (ch === '(') {
                        if (depth === 0) {
                            const name = (/([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(pre.slice(0, i)) || [])[1];
                            const fn = name && FUNCS.find(x => x[0] === name.toUpperCase());
                            if (fn) {
                                const args = fn[1].map((a, k) => (k === Math.min(commas, fn[1].length - 1) || (a === '…' && commas >= k)) ? '<b>' + esc(a) + '</b>' : esc(a));
                                hint.innerHTML = '<code>' + fn[0] + '(' + args.join(', ') + ')</code> ' + esc(fn[2])
                                    + (fn[3] && kindOf() === 'row' ? ' <span class="fbb-bad">Only in a formula from each group\'s totals.</span>' : '');
                                return;
                            }
                            break;
                        }
                        depth--;
                    } else if (ch === ',' && depth === 0) commas++;
                }
                hint.innerHTML = kindOf() === 'row'
                    ? 'Type <b>[</b> for a field (its value on each line), or the start of a function name.'
                    : 'Type <b>[</b> for a field: figures (Σ) are each group\'s total. Use SUM, COUNT… to add up a per-line value.';
            }
            ta.addEventListener('input', suggest);
            ta.addEventListener('click', suggest);
            ta.addEventListener('keyup', e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) suggest(); });
            ta.addEventListener('keydown', e => {
                if (list.hidden) return;
                if (e.key === 'ArrowDown') { e.preventDefault(); highlight(at + 1); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(at - 1); }
                else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(at); }
                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
            });
            ta.addEventListener('blur', () => setTimeout(close, 150));
            list.addEventListener('mousedown', e => {
                const d = e.target.closest('[data-i]');
                if (d) { e.preventDefault(); pick(Number(d.dataset.i)); }
            });
            m.querySelectorAll('input[name=fKind]').forEach(x => x.addEventListener('change', () => { signature(); }));
            signature();
        }

        // ================================================================ messages
        function say(text) {
            let el = host.querySelector('.fbb-say');
            if (!el) {
                el = document.createElement('div');
                el.className = 'toast info fbb-say';
                el.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:600;max-width:420px';
                document.body.appendChild(el);
            }
            el.textContent = text;
            el.style.opacity = '1';
            clearTimeout(el._t);
            el._t = setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 5000);
        }

        // ================================================================ drag and drop, clicks, keys
        let dragging = null;
        host.addEventListener('dragstart', e => {
            const item = e.target.closest('.fbb-item');
            const chip = e.target.closest('.fbb-chip');
            if (item && item.getAttribute('draggable') === 'true') dragging = { field: item.dataset.field };
            else if (chip) dragging = { well: chip.dataset.well, i: Number(chip.dataset.i) };
            else return;
            try { e.dataTransfer.setData('text/plain', dragging.field ? 'fbfield:' + dragging.field : 'fbchip:' + dragging.well + ':' + dragging.i); } catch (_) { /* old */ }
            e.dataTransfer.effectAllowed = dragging.field ? 'copy' : 'move';
        });
        host.addEventListener('dragend', () => { dragging = null; host.querySelectorAll('.fbb-drop.over').forEach(x => x.classList.remove('over')); });
        host.addEventListener('dragover', e => {
            const drop = e.target.closest('.fbb-drop');
            if (!drop || !dragging) return;
            e.preventDefault();
            host.querySelectorAll('.fbb-drop.over').forEach(x => { if (x !== drop) x.classList.remove('over'); });
            drop.classList.add('over');
        });
        host.addEventListener('dragleave', e => { const drop = e.target.closest('.fbb-drop'); if (drop && !drop.contains(e.relatedTarget)) drop.classList.remove('over'); });
        host.addEventListener('drop', e => {
            const drop = e.target.closest('.fbb-drop');
            if (!drop || !dragging) return;
            e.preventDefault();
            drop.classList.remove('over');
            const to = drop.dataset.drop;
            const at = dropIndex(drop, e.clientX, e.clientY);
            const d = dragging;
            dragging = null;
            if (d.field) { addTo(to, d.field, at); return; }
            if (d.well === to) {
                const list = to === 'group' ? grp().levels : to === 'columns' ? tbl().columns : to === 'filters' ? flt().all : tbl().sort;
                commit(() => move(list, d.i, at == null ? list.length : at));
                return;
            }
            // A chip dragged to another well: its field goes there too.
            const ref = chipField(d.well, d.i);
            if (to === 'sort') {
                const col = d.well === 'columns' ? tbl().columns[d.i] : null;
                if (col) addSort(col.id, isMeasure(col.ref) ? 'desc' : 'asc'); else say('Sort by a column: drag one from Columns.');
                return;
            }
            if (ref) addTo(to, ref, at);
        });
        function chipField(well, i) {
            if (well === 'group') return grp().levels[i] && grp().levels[i].field;
            if (well === 'columns') return tbl().columns[i] && tbl().columns[i].ref;
            if (well === 'filters') { const p = B.spec.params.find(x => x.id === (flt().all[i] || {}).param); return p && p.field; }
            return null;
        }
        function addTo(well, id, at) {
            if (well === 'group') addLevel(id, at);
            else if (well === 'columns') addColumn(id, at);
            else if (well === 'filters') addFilter(id);
            else if (well === 'sort') {
                const col = tbl().columns.find(c => c.ref === id);
                if (col) addSort(col.id, isMeasure(id) ? 'desc' : 'asc');
                else say('Add ' + labelOf(id) + ' as a column first, then sort by it.');
            }
        }
        function dropIndex(drop, x, y) {
            const chips = [...drop.querySelectorAll('.fbb-chip')];
            for (let k = 0; k < chips.length; k++) {
                const r = chips[k].getBoundingClientRect();
                if (y < r.top) return k;
                if (y <= r.bottom && x < r.left + r.width / 2) return k;
            }
            return null;
        }
        host.addEventListener('click', e => {
            const x = e.target.closest('[data-x]');
            if (x) {
                const [well, i] = x.dataset.x.split(':');
                const n = Number(i);
                if (well === 'group') removeLevel(n);
                else if (well === 'columns') removeColumn(n);
                else if (well === 'filters') removeFilter(n);
                else if (well === 'sort') commit(() => { tbl().sort.splice(n, 1); });
                return;
            }
            const chip = e.target.closest('.fbb-chip');
            if (chip) { openChip(chip); return; }
            const fh = e.target.closest('.fbb-folder-h');
            if (fh) {
                const name = fh.parentNode.dataset.folder;
                if (B.shut.has(name)) B.shut.delete(name); else B.shut.add(name);
                fh.parentNode.classList.toggle('shut');
                return;
            }
            const item = e.target.closest('.fbb-item');
            if (item) addMenu(item);
        });
        host.addEventListener('dblclick', e => {
            const item = e.target.closest('.fbb-item');
            if (item && item.getAttribute('draggable') === 'true') { closePop(); addTo('columns', item.dataset.field); }
        });
        host.addEventListener('contextmenu', e => {
            const item = e.target.closest('.fbb-item');
            if (!item) return;
            e.preventDefault();
            addMenu(item);
        });
        host.addEventListener('keydown', e => {
            const item = e.target.closest && e.target.closest('.fbb-item');
            const chip = e.target.closest && e.target.closest('.fbb-chip');
            if (item && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); addMenu(item); return; }
            if (chip) {
                const well = chip.dataset.well, i = Number(chip.dataset.i);
                const list = well === 'group' ? grp().levels : well === 'columns' ? tbl().columns : well === 'filters' ? flt().all : tbl().sort;
                if (e.key === 'Enter') { e.preventDefault(); openChip(chip); }
                else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); chip.querySelector('[data-x]').click(); }
                else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                    e.preventDefault();
                    const to = e.key === 'ArrowLeft' ? i - 1 : i + 2;
                    if (to >= 0 && to <= list.length) commit(() => move(list, i, to));
                    const again = host.querySelector('.fbb-chip[data-well="' + well + '"][data-i="' + Math.max(0, e.key === 'ArrowLeft' ? i - 1 : i + 1) + '"]');
                    if (again) again.focus();
                }
            }
        });
        document.addEventListener('keydown', e => {
            if (!host.isConnected) return;
            const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '');
            if (typing) return;
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
        });
        function openChip(chip) {
            const well = chip.dataset.well, i = Number(chip.dataset.i);
            if (well === 'columns') {
                const c = tbl().columns[i];
                const calc = (B.spec.calcs || []).find(x => x.id === c.ref);
                editColumn(i, chip);
            } else if (well === 'group') editLevel(i, chip);
            else if (well === 'filters') editFilter(i, chip);
            else if (well === 'sort') editSort(i, chip);
        }
        function addMenu(item) {
            const f = field(item.dataset.field);
            if (!f) return;
            if (locked(f)) { say(f.label + ': ' + lockNote(f) + '.'); return; }
            const calc = (B.spec.calcs || []).find(x => x.id === f.id);
            pop(item, '<label>' + esc(f.label) + '</label><p style="margin:2px 0 8px;color:#506872">' + esc(f.desc || '') + '</p>'
                + '<div style="display:flex;flex-direction:column;gap:6px">'
                + '<button class="hdr-btn" type="button" data-to="columns">Add to Columns</button>'
                + (f.measure ? '' : '<button class="hdr-btn" type="button" data-to="group">Group by it</button><button class="hdr-btn" type="button" data-to="filters">Filter by it</button>')
                + (calc ? '<button class="hdr-btn" type="button" data-edit="1">Edit the formula…</button><button class="hdr-btn" type="button" data-del="1">Delete the formula</button>' : '')
                + '</div>',
            el => {
                el.querySelectorAll('[data-to]').forEach(b => { b.onclick = () => { closePop(); addTo(b.dataset.to, f.id); }; });
                if (calc) {
                    el.querySelector('[data-edit]').onclick = () => { closePop(); formulaDialog(calc); };
                    el.querySelector('[data-del]').onclick = () => {
                        closePop();
                        commit(s => {
                            s.calcs = s.calcs.filter(x => x.id !== calc.id);
                            tbl().columns = tbl().columns.filter(c => c.ref !== calc.id);
                            grp().levels = grp().levels.filter(l => l.field !== calc.id);
                            pruneSort();
                        });
                    };
                }
            });
        }

        // ================================================================ top bar
        $('fbbTitle').addEventListener('change', () => { const v = $('fbbTitle').value.trim(); commit(s => { s.title = v || s.title; }, { keepFields: true }); });
        $('fbbSubject').addEventListener('change', () => setSubject($('fbbSubject').value));
        $('fbbUndo').onclick = undo;
        $('fbbRedo').onclick = redo;
        $('fbbNew').onclick = newReport;
        $('fbbOpen').onclick = openDialog;
        $('fbbCopy').onclick = copyDefinition;
        $('fbbPublish').onclick = publish;
        $('fbbCalc').onclick = () => formulaDialog(null);
        $('fbbSearch').addEventListener('input', renderTree);

        // ================================================================ start
        (async () => {
            try {
                const co = await R().View.runSql('Company', 'SELECT name FROM company WHERE id = 1');
                B.company = (co[0] && co[0].name) || '';
            } catch (_) { B.company = ''; }
            const drafts = readDrafts();
            if (opts.openId) {
                B.spec = newSpec(Object.keys(cat.subjects)[0]);
                loadFields();
                await openApp(opts.openId);
            } else if (drafts.length) {
                B.spec = R().migrate(drafts[0].spec);
                B.draftId = drafts[0].id;
                B.source = drafts[0].source || null;
                changed();
                say('Your last draft is open. New… starts another.');
            } else {
                B.spec = newSpec('sales.posted');
                changed();
                pickSubject(subject => { B.spec = newSpec(subject); changed(); });
            }
        })().catch(e => { host.innerHTML = '<div style="padding:20px;color:#8a1e30">The builder failed to start: ' + esc(e && e.message || e) + '</div>'; });

        return { spec: () => B.spec };
    }

    const FBBuilder = { BUILD, mount };
    global.FBBuilder = FBBuilder;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FBBuilder;
    }
})(typeof window !== 'undefined' ? window : globalThis);
