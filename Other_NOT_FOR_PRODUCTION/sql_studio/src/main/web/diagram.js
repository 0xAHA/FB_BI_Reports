/*
 * The schema diagram: a box per table, a line per foreign key, drawn as SVG.
 *
 * A port of fb-api-tool's SchemaDiagram. Drag the background to pan, the wheel
 * to zoom about the pointer, drag a box to move it. Double-click a box to make
 * the diagram about that table; Ctrl+click picks boxes, and columns in them,
 * for writing a query that joins them. "+ n more" opens a box to every column.
 *
 * What the user has done to the diagram (picked, opened, moved) lives in a
 * state object, not in the view, so the same diagram can be drawn docked under
 * the editor or in a popped-out window: popping out makes a second view over
 * the same state in the other window's document, and docking back drops it.
 */
(function (root) {
    'use strict';

    const SVG = 'http://www.w3.org/2000/svg';
    const BOX_WIDTH = 230;
    const TITLE_HEIGHT = 26;
    const ROW_HEIGHT = 18;
    const GAP_X = 90;
    const GAP_Y = 22;
    // Between the columns one layer is spread over: closer than between
    // layers, so a layer still reads as one.
    const GAP_SPLIT_X = 24;
    // The smallest a diagram is drawn without being asked: titles stay readable.
    const READABLE = 0.55;

    // The tint each part of Fishbowl's tables has, so a sales table reads as
    // one at a glance. The table the diagram is about is brand blue instead.
    const AREA_TINT = {
        sales: '#2e9e5b', purchasing: '#c27c0e', inventory: '#7a5cc7', manufacturing: '#c2410c',
        shipping: '#0f8b8d', accounting: '#b83280', setup: '#64748b', other: '#8a94a6'
    };
    const FOCUS_TINT = '#2d9cdb';

    function newState() {
        return {
            graph: { nodes: [], edges: [], trimmed: 0, lookupsHidden: 0 },
            selected: [],          // picked tables, in order: the first is the FROM
            pickedColumns: [],     // [{ table, column }] in order: the SELECT list
            open: new Set(),       // boxes showing every column (lower-case names)
            moved: new Map(),      // lower-case name -> { dx, dy } dragged by hand
            expanded: new Set(),   // tables whose own links are drawn ("Show what it links to")
            emptyText: 'Pick a table to see what it connects to.'
        };
    }

    const lc = s => String(s || '').toLowerCase();
    const same = (a, b) => lc(a) === lc(b);

    /**
     * A view of a diagram state inside `host` (an element of any document).
     * hooks: areaOf(table), onFocus(table), onLinks(table), onSelection(), onZoom(percent)
     */
    function View(host, state, hooks) {
        this.host = host;
        this.doc = host.ownerDocument;
        this.win = this.doc.defaultView;
        this.state = state;
        this.hooks = hooks || {};
        this.boxes = new Map();       // lower-case name -> { node, x, y, w, h, rows }
        this.scale = 1;
        this.ox = 0;
        this.oy = 0;
        this.viewTouched = false;
        this.hover = null;
        this.svg = this.el('svg', { class: 'dg-svg' });
        this.world = this.el('g');
        this.svg.appendChild(this.defs());
        this.svg.appendChild(this.world);
        this.empty = this.doc.createElement('div');
        this.empty.className = 'dg-empty';
        this.legend = this.doc.createElement('div');
        this.legend.className = 'dg-legend';
        host.classList.add('dg-host');
        host.appendChild(this.svg);
        host.appendChild(this.empty);
        host.appendChild(this.legend);
        this.wire();
        this.layOut();
        this.draw();
        // A first real size is answered at once; later ones refit only if the
        // view hasn't been panned or zoomed by hand since the last fit.
        this.resizeObserver = new this.win.ResizeObserver(() => {
            if (!this.viewTouched) this.fitReadable();
        });
        this.resizeObserver.observe(host);
    }

    View.prototype.el = function (name, attrs) {
        const e = this.doc.createElementNS(SVG, name);
        if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
        return e;
    };

    View.prototype.defs = function () {
        const defs = this.el('defs');
        const mk = (id, colour) => {
            const m = this.el('marker', { id, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
            m.appendChild(this.el('path', { d: 'M0,1 L9,5 L0,9 z', fill: colour }));
            defs.appendChild(m);
        };
        mk('dg-arrow', '#9aa5b5');
        mk('dg-arrow-lit', FOCUS_TINT);
        return defs;
    };

    View.prototype.destroy = function () {
        this.resizeObserver.disconnect();
        this.host.classList.remove('dg-host');
        [this.svg, this.empty, this.legend].forEach(e => e.remove());
        this.closeMenu();
    };

    /** Shows a new graph, laid out afresh and fitted to the space. */
    View.prototype.show = function (graph) {
        this.state.graph = graph || { nodes: [], edges: [] };
        const drawn = new Set(this.state.graph.nodes.map(n => lc(n.table)));
        for (const k of [...this.state.moved.keys()]) if (!drawn.has(k)) this.state.moved.delete(k);
        this.viewTouched = false;
        this.layOut();
        this.draw();
        this.fitReadable();
    };

    /**
     * Picks these tables, in this order, replacing whatever was picked; with
     * columns ([{ table, column }]), those fields too, else the fields already
     * picked in these tables stay.
     */
    View.prototype.pick = function (tables, columns) {
        this.state.selected = tables.slice();
        this.state.pickedColumns = (columns || this.state.pickedColumns).filter(c => tables.some(t => same(t, c.table)));
        this.layOut();
        this.draw();
    };

    // -- LAYOUT ------------------------------------------------------------

    /**
     * The rows of a box, top to bottom: the picked fields first, in the order
     * they were picked, then keys, links and lookups, then the other columns,
     * or a "+ n more" line when the box is folded. A picked field is never
     * one of the n more: it is part of the query being written, and has to
     * be seen to be unpicked.
     */
    View.prototype.rows = function (n) {
        const all = [];
        n.keys.forEach(k => all.push({ kind: 'key', column: k, tag: 'Key' }));
        n.links.forEach(l => all.push({ kind: 'link', column: l.column, tag: '→ ' + l.refTable, ref: l.refTable }));
        n.lookups.forEach(l => all.push({ kind: 'lookup', column: l.column, tag: '→ ' + l.refTable, ref: l.refTable }));
        const others = n.others.map(o => ({ kind: 'other', column: o, tag: '' }));
        const picked = this.state.pickedColumns.filter(c => same(c.table, n.table));
        const out = [];
        picked.forEach(c => {
            const r = all.find(x => same(x.column, c.column)) || others.find(x => same(x.column, c.column));
            if (r && !out.includes(r)) out.push(r);
        });
        all.forEach(r => { if (!out.includes(r)) out.push(r); });
        const rest = others.filter(r => !out.includes(r));
        if (rest.length) {
            if (this.state.open.has(lc(n.table))) {
                rest.forEach(r => out.push(r));
                out.push({ kind: 'fewer', column: '', tag: '' });
            } else {
                out.push({ kind: 'more', column: '', tag: '', count: rest.length });
            }
        } else if (this.state.open.has(lc(n.table)) && others.length) {
            out.push({ kind: 'fewer', column: '', tag: '' });
        }
        return out;
    };

    /**
     * The builder's columns (parents right, children left), each sorted by part
     * of Fishbowl then row, and packed to the shape of the space: a column much
     * taller than the space is wide enough for is spread over several.
     */
    View.prototype.layOut = function () {
        this.boxes.clear();
        const nodes = this.state.graph.nodes;
        if (!nodes.length) return;
        const areaRank = t => {
            const a = this.hooks.areaOf ? this.hooks.areaOf(t) : 'other';
            const i = Object.keys(AREA_TINT).indexOf(a);
            return i < 0 ? 99 : i;
        };
        const sized = nodes.map(n => {
            const rows = this.rows(n);
            return { node: n, rows, h: TITLE_HEIGHT + ROW_HEIGHT * rows.length + 6 };
        });
        const byColumn = new Map();
        sized.forEach(s => {
            if (!byColumn.has(s.node.column)) byColumn.set(s.node.column, []);
            byColumn.get(s.node.column).push(s);
        });
        const columns = [...byColumn.keys()].sort((a, b) => a - b).map(k =>
            byColumn.get(k).sort((a, b) => areaRank(a.node.table) - areaRank(b.node.table) || a.node.row - b.node.row));

        const rect = this.host.getBoundingClientRect();
        const aspect = rect.width > 10 && rect.height > 10 ? rect.width / rect.height : 1.6;
        const total = sized.reduce((s, b) => s + b.h + GAP_Y, 0);
        const tallest = Math.max(...sized.map(b => b.h));
        // The height that makes the whole diagram about the shape of the space.
        const target = Math.max(tallest, Math.sqrt(total * (BOX_WIDTH + GAP_X) / aspect));

        let x = 0;
        columns.forEach(col => {
            const height = col.reduce((s, b) => s + b.h + GAP_Y, 0);
            const split = Math.max(1, Math.ceil(height / target));
            const perPart = Math.ceil(col.length / split);
            for (let p = 0; p < split; p++) {
                const part = col.slice(p * perPart, (p + 1) * perPart);
                const partHeight = part.reduce((s, b) => s + b.h + GAP_Y, 0) - GAP_Y;
                let y = -partHeight / 2;
                part.forEach(b => {
                    const by = this.state.moved.get(lc(b.node.table)) || { dx: 0, dy: 0 };
                    this.boxes.set(lc(b.node.table), { node: b.node, rows: b.rows, x: x + by.dx, y: y + by.dy, w: BOX_WIDTH, h: b.h });
                    y += b.h + GAP_Y;
                });
                x += BOX_WIDTH + (p < split - 1 ? GAP_SPLIT_X : GAP_X);
            }
        });
    };

    /** Lays it out afresh: boxes dragged by hand go back. */
    View.prototype.tidy = function () {
        this.state.moved.clear();
        this.layOut();
        this.draw();
        this.fitReadable();
    };

    // -- FITTING -------------------------------------------------------------

    View.prototype.bounds = function (only) {
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        this.boxes.forEach((b, k) => {
            if (only && !only.has(k)) return;
            x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
            x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
        });
        return x1 === Infinity ? null : { x1, y1, x2, y2 };
    };

    View.prototype.fitTo = function (r, minScale) {
        const rect = this.host.getBoundingClientRect();
        if (!r || rect.width < 10 || rect.height < 10) return;
        const margin = 40;
        let s = Math.min((rect.width - margin * 2) / (r.x2 - r.x1), (rect.height - margin * 2) / (r.y2 - r.y1));
        s = Math.min(s, 1.25);
        if (minScale) s = Math.max(s, minScale);
        this.scale = s;
        let cx = (r.x1 + r.x2) / 2, cy = (r.y1 + r.y2) / 2;
        // Readable wins over everything in view: centre on the table it is about.
        const fits = (r.x2 - r.x1) * s <= rect.width && (r.y2 - r.y1) * s <= rect.height;
        if (!fits) {
            const focus = this.state.graph.nodes.find(n => n.isFocus);
            const fb = focus && this.boxes.get(lc(focus.table));
            if (fb) { cx = fb.x + fb.w / 2; cy = fb.y + fb.h / 2; }
        }
        this.ox = rect.width / 2 - cx * s;
        this.oy = rect.height / 2 - cy * s;
        this.applyView();
    };

    /** The whole diagram in view, however small that makes it (asked for with a button). */
    View.prototype.fitAll = function () { this.viewTouched = false; this.fitTo(this.bounds(), 0); };
    /** In view at a size that can be read, centred on the table it is about if it doesn't all fit. */
    View.prototype.fitReadable = function () { this.fitTo(this.bounds(), READABLE); };
    /** The picked tables filling the view, or the table it is about when none are. */
    View.prototype.fitPicked = function () {
        const picked = new Set(this.state.selected.map(lc));
        if (!picked.size) {
            const f = this.state.graph.nodes.find(n => n.isFocus);
            if (f) picked.add(lc(f.table));
        }
        this.viewTouched = false;
        this.fitTo(this.bounds(picked.size ? picked : null), 0);
    };

    View.prototype.zoomPercent = function () { return Math.round(this.scale * 100); };

    View.prototype.applyView = function () {
        this.world.setAttribute('transform', 'translate(' + this.ox + ',' + this.oy + ') scale(' + this.scale + ')');
        if (this.hooks.onZoom) this.hooks.onZoom(this.zoomPercent());
    };

    // -- DRAWING -------------------------------------------------------------

    View.prototype.draw = function () {
        while (this.world.firstChild) this.world.removeChild(this.world.firstChild);
        const nodes = this.state.graph.nodes;
        this.empty.textContent = nodes.length ? '' : this.state.emptyText;
        this.empty.style.display = nodes.length ? 'none' : '';
        this.drawLegend();
        if (!nodes.length) return;

        const lines = this.el('g', { class: 'dg-lines' });
        const lit = this.el('g', { class: 'dg-lines-lit' });
        this.world.appendChild(lines);
        this.state.graph.edges.forEach(e => {
            if (same(e.table, e.refTable)) return;   // a table pointing at itself
            const touches = this.hover && (same(e.table, this.hover) || same(e.refTable, this.hover));
            const path = this.edgePath(e);
            if (!path) return;
            const p = this.el('path', { d: path, class: touches ? 'dg-edge lit' : 'dg-edge',
                'marker-end': touches ? 'url(#dg-arrow-lit)' : 'url(#dg-arrow)' });
            (touches ? lit : lines).appendChild(p);
        });
        const boxes = this.el('g', { class: 'dg-boxes' });
        this.world.appendChild(boxes);
        this.boxes.forEach(b => boxes.appendChild(this.drawBox(b)));
        // Lit lines last, so they sit over the rest.
        this.world.appendChild(lit);
    };

    View.prototype.drawLegend = function () {
        const areas = new Set(this.state.graph.nodes.map(n => this.hooks.areaOf ? this.hooks.areaOf(n.table) : 'other'));
        this.legend.innerHTML = '';
        if (areas.size < 2) return;
        Object.keys(AREA_TINT).forEach(a => {
            if (!areas.has(a)) return;
            const item = this.doc.createElement('span');
            item.innerHTML = '<i style="background:' + AREA_TINT[a] + '"></i>' + (this.hooks.areaName ? this.hooks.areaName(a) : a);
            this.legend.appendChild(item);
        });
    };

    /** Where a column's row is in a box, vertically. */
    View.prototype.rowY = function (b, column, kinds) {
        const i = b.rows.findIndex(r => kinds.includes(r.kind) && same(r.column, column));
        return b.y + TITLE_HEIGHT + (i < 0 ? 0 : i) * ROW_HEIGHT + ROW_HEIGHT / 2 + 2;
    };

    View.prototype.edgePath = function (e) {
        const from = this.boxes.get(lc(e.table));
        const to = this.boxes.get(lc(e.refTable));
        if (!from || !to) return null;
        const y1 = this.rowY(from, e.column, ['link', 'lookup', 'key', 'other']);
        const y2 = this.rowY(to, e.refColumn, ['key']);
        const rightward = to.x >= from.x + from.w / 2;
        const x1 = rightward ? from.x + from.w : from.x;
        const x2 = rightward ? to.x : to.x + to.w;
        const bend = Math.max(40, Math.abs(x2 - x1) / 2);
        const c1 = rightward ? x1 + bend : x1 - bend;
        const c2 = rightward ? x2 - bend : x2 + bend;
        return 'M' + x1 + ',' + y1 + ' C' + c1 + ',' + y1 + ' ' + c2 + ',' + y2 + ' ' + x2 + ',' + y2;
    };

    View.prototype.drawBox = function (b) {
        const n = b.node;
        const key = lc(n.table);
        const order = this.state.selected.findIndex(t => same(t, n.table));
        const tint = n.isFocus ? FOCUS_TINT : AREA_TINT[this.hooks.areaOf ? this.hooks.areaOf(n.table) : 'other'] || AREA_TINT.other;
        const g = this.el('g', { class: 'dg-box' + (order >= 0 ? ' picked' : '') + (same(this.hover, n.table) ? ' hover' : ''),
            transform: 'translate(' + b.x + ',' + b.y + ')' });
        g.dataset.table = n.table;
        g.appendChild(this.el('rect', { class: 'dg-frame', width: b.w, height: b.h, rx: 6 }));
        const title = this.el('path', { d: 'M0,6 a6,6 0 0 1 6,-6 h' + (b.w - 12) + ' a6,6 0 0 1 6,6 v' + (TITLE_HEIGHT - 6) + ' h-' + b.w + ' z', fill: tint });
        g.appendChild(title);
        const name = this.el('text', { x: 10, y: 17, class: 'dg-title' });
        name.textContent = n.table;
        g.appendChild(name);
        // Picked: where it comes in the query. The first is the FROM.
        if (order >= 0) {
            g.appendChild(this.el('circle', { cx: b.w - 14, cy: 13, r: 9, class: 'dg-badge' }));
            const t = this.el('text', { x: b.w - 14, y: 17, class: 'dg-badge-text' });
            t.textContent = String(order + 1);
            g.appendChild(t);
        }
        b.rows.forEach((r, i) => {
            const y = TITLE_HEIGHT + i * ROW_HEIGHT;
            const picked = (r.kind === 'key' || r.kind === 'link' || r.kind === 'lookup' || r.kind === 'other')
                && this.state.pickedColumns.some(c => same(c.table, n.table) && same(c.column, r.column));
            const row = this.el('g', { class: 'dg-row ' + r.kind + (picked ? ' picked' : ''), transform: 'translate(0,' + y + ')' });
            row.dataset.row = String(i);
            row.appendChild(this.el('rect', { x: 2, y: 1, width: b.w - 4, height: ROW_HEIGHT, class: 'dg-row-bg' }));
            const label = this.el('text', { x: 10, y: 14, class: 'dg-col' });
            if (r.kind === 'more') label.textContent = '+ ' + r.count + ' more';
            else if (r.kind === 'fewer') label.textContent = 'show fewer';
            else label.textContent = (r.kind === 'key' ? '⚿ ' : '') + r.column;
            row.appendChild(label);
            // Right-aligned, and dropped rather than overlapping a long column name.
            if (r.tag && r.kind !== 'key' && r.column.length + r.tag.length < 34) {
                const tag = this.el('text', { x: b.w - 8, y: 14, class: 'dg-tag' });
                tag.textContent = r.kind === 'lookup' && picked ? '→ name' : r.tag;
                row.appendChild(tag);
            }
            g.appendChild(row);
        });
        return g;
    };

    // -- INPUT ---------------------------------------------------------------

    View.prototype.toModel = function (ev) {
        const rect = this.svg.getBoundingClientRect();
        return { x: (ev.clientX - rect.left - this.ox) / this.scale, y: (ev.clientY - rect.top - this.oy) / this.scale,
                 sx: ev.clientX - rect.left, sy: ev.clientY - rect.top };
    };

    View.prototype.hit = function (ev) {
        const p = this.toModel(ev);
        let found = null;
        this.boxes.forEach(b => {
            if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) found = b;
        });
        if (!found) return { p };
        const i = Math.floor((p.y - found.y - TITLE_HEIGHT) / ROW_HEIGHT);
        return { p, box: found, row: i >= 0 && i < found.rows.length ? found.rows[i] : null };
    };

    View.prototype.wire = function () {
        let drag = null;
        this.svg.addEventListener('pointerdown', ev => {
            this.closeMenu();
            if (ev.button !== 0) return;
            const h = this.hit(ev);
            drag = { kind: h.box ? 'box' : 'pan', box: h.box, row: h.row, x: ev.clientX, y: ev.clientY, moved: false, ctrl: ev.ctrlKey || ev.metaKey };
            this.svg.setPointerCapture(ev.pointerId);
        });
        this.svg.addEventListener('pointermove', ev => {
            if (!drag) {
                const h = this.hit(ev);
                const over = h.box ? h.box.node.table : null;
                if (!same(over, this.hover)) {
                    this.hover = over;
                    this.svg.style.cursor = over ? 'pointer' : 'grab';
                    this.draw();
                }
                return;
            }
            const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
            if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
            drag.moved = true;
            drag.x = ev.clientX; drag.y = ev.clientY;
            if (drag.kind === 'pan') {
                this.ox += dx; this.oy += dy;
                this.viewTouched = true;
                this.applyView();
            } else {
                const key = lc(drag.box.node.table);
                drag.box.x += dx / this.scale; drag.box.y += dy / this.scale;
                const was = this.state.moved.get(key) || { dx: 0, dy: 0 };
                this.state.moved.set(key, { dx: was.dx + dx / this.scale, dy: was.dy + dy / this.scale });
                this.draw();
            }
        });
        this.svg.addEventListener('pointerup', () => {
            const d = drag;
            drag = null;
            if (d && !d.moved && d.box) this.click(d.box, d.row, d.ctrl);
        });
        this.svg.addEventListener('dblclick', ev => {
            const h = this.hit(ev);
            if (h.box && !(h.row && (h.row.kind === 'more' || h.row.kind === 'fewer')) && this.hooks.onFocus) this.hooks.onFocus(h.box.node.table);
        });
        this.svg.addEventListener('wheel', ev => {
            ev.preventDefault();
            // Zoom about the pointer, so what is under it stays under it.
            const p = this.toModel(ev);
            const s = Math.min(3, Math.max(0.08, this.scale * Math.pow(1.0015, -ev.deltaY)));
            this.ox = p.sx - p.x * s;
            this.oy = p.sy - p.y * s;
            this.scale = s;
            this.viewTouched = true;
            this.applyView();
        }, { passive: false });
        this.svg.addEventListener('contextmenu', ev => {
            ev.preventDefault();
            const h = this.hit(ev);
            if (h.box) this.menu(h.box.node, ev);
        });
        this.svg.addEventListener('pointerleave', () => {
            if (this.hover && !drag) { this.hover = null; this.draw(); }
        });
    };

    View.prototype.click = function (box, row, ctrl) {
        const t = box.node.table;
        // "+ n more" and "show fewer" open and close the box, on a plain click.
        if (row && (row.kind === 'more' || row.kind === 'fewer')) {
            const k = lc(t);
            if (!this.state.open.delete(k)) this.state.open.add(k);
            this.layOut();
            this.draw();
            return;
        }
        if (!ctrl) return;
        const st = this.state;
        if (row && row.column) {
            // A column: into the SELECT, or out of it. Picking a column picks
            // its table, since the query needs the table to have it.
            const at = st.pickedColumns.findIndex(c => same(c.table, t) && same(c.column, row.column));
            if (at >= 0) st.pickedColumns.splice(at, 1);
            else {
                st.pickedColumns.push({ table: t, column: row.column });
                if (!st.selected.some(s => same(s, t))) st.selected.push(t);
            }
        } else if (st.selected.some(s => same(s, t))) {
            // The table itself, un-picked: its columns go with it.
            st.selected = st.selected.filter(s => !same(s, t));
            st.pickedColumns = st.pickedColumns.filter(c => !same(c.table, t));
        } else {
            st.selected.push(t);
        }
        // A picked field moves to the top of its box, and may change its height.
        this.layOut();
        this.draw();
        if (this.hooks.onSelection) this.hooks.onSelection();
    };

    /** The picked columns that are links to a hidden lookup, and so stand for the lookup's name. */
    function pickedLookupNames(state) {
        return state.pickedColumns.filter(c => {
            const n = state.graph.nodes.find(x => same(x.table, c.table));
            return n && n.lookups.some(l => same(l.column, c.column));
        });
    }

    View.prototype.menu = function (node, ev) {
        this.closeMenu();
        const m = this.doc.createElement('div');
        m.className = 'dg-menu';
        const shown = [...this.state.expanded].some(t => same(t, node.table));
        const items = [
            { text: (shown ? 'Hide what ' : 'Show what ') + node.table + ' links to', run: () => this.hooks.onLinks && this.hooks.onLinks(node.table) },
            { text: 'Centre the diagram on ' + node.table, run: () => this.hooks.onFocus && this.hooks.onFocus(node.table), off: node.isFocus }
        ];
        items.forEach(it => {
            const b = this.doc.createElement('button');
            b.textContent = it.text;
            b.disabled = !!it.off;
            b.addEventListener('click', () => { this.closeMenu(); it.run(); });
            m.appendChild(b);
        });
        const rect = this.host.getBoundingClientRect();
        m.style.left = (ev.clientX - rect.left) + 'px';
        m.style.top = (ev.clientY - rect.top) + 'px';
        this.host.appendChild(m);
        this.menuEl = m;
    };

    View.prototype.closeMenu = function () {
        if (this.menuEl) { this.menuEl.remove(); this.menuEl = null; }
    };

    const Diagram = { newState, View, pickedLookupNames, AREA_TINT, FOCUS_TINT };
    if (typeof module === 'object' && module.exports) module.exports = Diagram; else root.Diagram = Diagram;
})(this);
