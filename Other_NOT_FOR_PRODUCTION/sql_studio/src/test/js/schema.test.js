/*
 * Tests for schema.js: node schema.test.js, from this folder.
 *
 * Ported from fb-api-tool's selftest (sections 9r, 9r0, 9r3, 9t and 9v), with
 * the same fixture snapshots, so the two stay answerable to one another; the
 * checks after those cover what only this port has (load, JSON, the page's
 * text-replacement rules).
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '..', '..', 'main', 'web', 'schema.js');
const Schema = require(SOURCE);

let passed = 0;
let failed = 0;

function section(name) { console.log('\n' + name); }

// A check passes unless it throws or returns false.
async function check(name, fn) {
    try {
        const r = await fn();
        if (r === false) throw new Error('returned false');
        passed++;
        console.log('  pass  ' + name);
    } catch (e) {
        failed++;
        console.log('  FAIL  ' + name + '\n        ' + String(e && e.message || e).split('\n').join('\n        '));
    }
}

function snapshot(tables, keyRows) {
    const s = new Schema.Snapshot();
    s.server = 'x';
    for (const name of Object.keys(tables)) s.setTable(name, tables[name]);
    if (keyRows) s.applyKeys(keyRows);
    return s;
}

const words = items => items.map(i => i.text);
const show = items => items.map(i => Schema.kindLabel(i.kind) + ' ' + i.text + (i.kind === 'column' ? ' [' + i.detail + ']' : '')).join(', ');
const at = g => g.nodes.map(n => n.table + '@' + n.column).join(', ');

async function main() {
    section('9r. SQL schema completion');
    const snap = snapshot({
        soitem: ['id', 'soId', 'qtyOrdered', 'productNum'],
        so: ['id', 'num', 'statusId'],
        part: ['id', 'num', 'description']
    });

    const aliases = Schema.aliases('SELECT * FROM soitem si JOIN so ON so.id = si.soId');
    await check('an alias binds to its table', () => assert.strictEqual(aliases.get('si'), 'soitem'));
    await check('a table name qualifies itself', () => assert.strictEqual(aliases.get('so'), 'so'));
    // "FROM part WHERE" must not bind WHERE as an alias for part.
    await check('a keyword is not taken as an alias',
        () => assert.ok(!Schema.aliases('SELECT * FROM part WHERE id = 1').has('where')));

    // Every way a statement can name its tables has to put them in scope, or
    // the column list after SELECT offers nothing for that alias.
    const map = sql => Array.from(Schema.aliases(sql).entries())
        .sort((a, b) => a[0] < b[0] ? -1 : 1).map(([k, v]) => k + '=' + v).join(',');
    await check('FROM-first: SELECT is not taken as an alias',
        () => assert.strictEqual(map('FROM part SELECT num'), 'part=part'));
    await check('FROM-first with aliases and a join',
        () => assert.strictEqual(map('FROM part p JOIN so s ON s.id = p.id SELECT p.num'), 'p=part,part=part,s=so,so=so'));
    await check('AS and LEFT OUTER JOIN',
        () => assert.strictEqual(map('SELECT 1 FROM part AS p LEFT OUTER JOIN soitem AS si ON si.id = p.id'),
            'p=part,part=part,si=soitem,soitem=soitem'));
    await check('a comma-separated FROM list',
        () => assert.strictEqual(map('SELECT a, b FROM part p, so s WHERE s.id = p.id'), 'p=part,part=part,s=so,so=so'));
    await check('a comma in the SELECT list is not a table',
        () => assert.ok(!Schema.aliases('SELECT num, description FROM part').has('description')));
    await check('backticks and a database prefix',
        () => assert.strictEqual(map('SELECT 1 FROM `demodb`.`part` `p`'), 'p=part,part=part'));
    await check('UPDATE names its table and alias',
        () => assert.strictEqual(map("UPDATE part p SET p.num = 'x'"), 'p=part,part=part'));
    await check("a subquery's tables are in scope too",
        () => assert.strictEqual(map('SELECT * FROM (SELECT id FROM soitem si) x JOIN so s ON s.id = x.id'),
            's=so,si=soitem,so=so,soitem=soitem'));

    const fromFirst = Schema.suggest(snap, 'FROM soitem si JOIN so s ON s.id = si.soId\nSELECT s.', 's', '',
        { before: 'SELECT s.' });
    await check('FROM-first: an alias from a join completes to its columns',
        () => assert.deepStrictEqual(words(fromFirst), ['id', 'num', 'statusId'], show(fromFirst)));
    const fromFirstBare = Schema.suggest(snap, 'FROM part\nSELECT de', '', 'de', { before: 'SELECT de' });
    await check('FROM-first: an unqualified column comes from the FROM',
        () => assert.strictEqual(fromFirstBare[0] && fromFirstBare[0].text, 'description', show(fromFirstBare)));

    section('9r0. Keys and joins');
    const keyed = snapshot({
        so: ['id', 'num', 'statusId', 'customerId'],
        soitem: ['id', 'soId', 'productId', 'statusId'],
        sostatus: ['id', 'name'],
        soitemstatus: ['id', 'name'],
        customer: ['id', 'name', 'number', 'creditLimit', 'note'],
        product: ['id', 'num']
    }, [
        { tbl: 'so', col: 'id', k: 'PRIMARY' },
        { tbl: 'soitem', col: 'id', k: 'PRIMARY' },
        { tbl: 'so', col: 'statusId', rt: 'sostatus', rc: 'id', k: 'FK1' },
        { tbl: 'so', col: 'customerId', rt: 'customer', rc: 'id', k: 'FK2' },
        { tbl: 'soitem', col: 'soId', rt: 'so', rc: 'id', k: 'FK3' },
        { tbl: 'soitem', col: 'productId', rt: 'product', rc: 'id', k: 'FK4' },
        { tbl: 'soitem', col: 'statusId', rt: 'soitemstatus', rc: 'id', k: 'FK5' }
    ]);
    await check('primary keys are read', () => keyed.isKey('so', 'id') && !keyed.isKey('so', 'num'));
    await check('foreign keys are read',
        () => keyed.foreignKeys.length === 5 && keyed.refersTo('soitem', 'soId').refTable === 'so');
    await check('and who points at a table',
        () => assert.deepStrictEqual(keyed.referencedBy('so').map(f => f.table), ['soitem']));

    const joins = (s, before) => Schema.joinConditions(s, before, before).map(c => c.text).join(' | ');
    await check('JOIN ... ON offers the condition, child to parent',
        () => assert.strictEqual(joins(keyed, 'SELECT * FROM so s JOIN soitem si ON '), 'si.soId = s.id'));
    await check('and parent to child',
        () => assert.strictEqual(joins(keyed, 'SELECT * FROM soitem si JOIN so s ON '), 's.id = si.soId'));
    await check('without aliases, the table names qualify',
        () => assert.strictEqual(joins(keyed, 'SELECT * FROM soitem JOIN so ON '), 'so.id = soitem.soId'));
    await check('FROM-first, across lines',
        () => assert.strictEqual(joins(keyed, 'FROM so s\nJOIN soitem si ON '), 'si.soId = s.id'));
    await check("nothing when the caret isn't at a condition",
        () => assert.strictEqual(joins(keyed, 'SELECT * FROM so s JOIN soitem si ON si.soId = s.id WHERE '), ''));
    await check('the editor knows when to open the list',
        () => Schema.atJoinCondition('FROM so s JOIN soitem si ON ') && !Schema.atJoinCondition('FROM so s JOIN soitem si '));

    const afterJoin = Schema.suggest(keyed, 'SELECT * FROM soitem si JOIN ', '', '', { before: 'SELECT * FROM soitem si JOIN ' });
    await check('after JOIN, the related tables come first, saying how', () => {
        assert.deepStrictEqual(afterJoin.slice(0, 3).map(c => c.text).sort(), ['product', 'so', 'soitemstatus'], show(afterJoin));
        assert.ok(afterJoin[0].detail.startsWith('joins'), show(afterJoin));
    });

    const around = Schema.graphAround(keyed, 'so', 1, false);
    await check('a diagram of so puts it in the middle', () => {
        const n = Schema.node(around, 'so');
        return n !== null && n.column === 0 && n.isFocus;
    });
    await check('what it points at to the right, what points at it to the left', () => assert.ok(
        Schema.node(around, 'customer').column === 1 && Schema.node(around, 'sostatus').column === 1
        && Schema.node(around, 'soitem').column === -1, at(around)));
    await check('one step out stops at the neighbours', () => Schema.node(around, 'product') === null);
    await check("two steps reach the neighbours' neighbours",
        () => Schema.node(Schema.graphAround(keyed, 'so', 2, false), 'product').column === -1 + 1);
    const hidden = Schema.graphAround(keyed, 'so', 1, true);
    await check('hiding lookups leaves out the small label tables', () => assert.ok(
        Schema.node(hidden, 'sostatus') === null && Schema.node(hidden, 'customer') !== null && hidden.lookupsHidden === 1,
        at(hidden)));
    await check('a box lists its key and the links to tables in the diagram', () => {
        const si = Schema.node(around, 'soitem');
        assert.deepStrictEqual(si.keys, ['id']);
        assert.ok(si.links.some(l => l.column === 'soId' && l.refTable === 'so'));
    });

    // so <- soitem <- pickitem -> pick: pick is three steps from so, with no
    // key of its own to it, the way Fishbowl's real schema has it.
    keyed.setTable('pick', ['id', 'num', 'statusId']);
    keyed.setTable('pickitem', ['id', 'pickId', 'soItemId', 'partId']);
    keyed.addForeignKey('pickitem', 'pickId', 'pick', 'id');
    keyed.addForeignKey('pickitem', 'soItemId', 'soitem', 'id');
    keyed.setTable('part', ['id', 'num', 'description', 'typeId', 'uomId']);
    keyed.addForeignKey('pickitem', 'partId', 'part', 'id');
    const walked = Schema.graphAround(keyed, 'pickitem', 1, false, ['so']);
    await check('picked tables stay when the diagram re-centres, linked in', () => assert.ok(
        Schema.node(walked, 'so') && Schema.node(walked, 'soitem') && Schema.node(walked, 'pick'), at(walked)));
    const pickQuery = Schema.writeJoin(keyed, ['so', 'pickitem', 'pick']);
    await check('and so, pickitem and pick make one query', () => assert.strictEqual(pickQuery,
        'SELECT s.num AS soNum, pi.partId, p.num AS pickNum\nFROM so s\nJOIN soitem si ON si.soId = s.id\n' +
        'JOIN pickitem pi ON pi.soItemId = si.id\nJOIN pick p ON p.id = pi.pickId'));
    keyed.removeForeignKeys(f => f.table === 'pickitem');
    keyed.removeTable('pick');
    keyed.removeTable('pickitem');
    keyed.removeTable('part');

    const ofQuery = Schema.graphOf(keyed, ['soitem', 'so', 'customer'], false);
    await check("a query's diagram is laid out from its first table", () => assert.ok(
        Schema.node(ofQuery, 'soitem').column === 0 && Schema.node(ofQuery, 'so').column === 1
        && Schema.node(ofQuery, 'customer').column === 2, at(ofQuery)));

    const direct = Schema.writeJoin(keyed, ['so', 'soitem']);
    await check('Write query joins two tables along their key',
        () => assert.strictEqual(direct, 'SELECT s.num, si.productId\nFROM so s\nJOIN soitem si ON si.soId = s.id'));
    await check("a table with no number or name of its own is known by what it's about",
        () => assert.strictEqual(Schema.identifying(keyed, 'soitem'), 'productId'));
    const withCols = Schema.writeJoin(keyed, ['so', 'soitem'],
        [{ table: 'soitem', column: 'statusId' }, { table: 'so', column: 'customerId' }, { table: 'so', column: 'num' }]);
    await check('picked columns are the SELECT, table by table in the order picked',
        () => assert.strictEqual(withCols, 'SELECT s.customerId, s.num, si.statusId\nFROM so s\nJOIN soitem si ON si.soId = s.id'));
    const clash = Schema.writeJoin(keyed, ['so', 'product'],
        [{ table: 'so', column: 'num' }, { table: 'so', column: 'id' }, { table: 'product', column: 'num' }]);
    await check('columns sharing a name are told apart by their table', () => assert.strictEqual(clash,
        'SELECT s.num AS soNum, s.id, p.num AS productNum\nFROM so s\n' +
        'JOIN soitem si ON si.soId = s.id\nJOIN product p ON p.id = si.productId'));
    const hiddenLookups = Schema.graphAround(keyed, 'so', 1, true);
    await check("a hidden lookup's link stays in the box", () => {
        const so = Schema.node(hiddenLookups, 'so');
        assert.strictEqual(Schema.node(hiddenLookups, 'sostatus'), null);
        assert.ok(so.lookups.some(l => l.column === 'statusId' && l.refTable === 'sostatus'), JSON.stringify(so.lookups));
        assert.ok(!so.others.includes('statusId'));
    });
    const lookupName = Schema.writeJoin(keyed, ['so'], [{ table: 'so', column: 'num' }, { table: 'so', column: 'statusId' }],
        [{ table: 'so', column: 'statusId' }]);
    await check("and picking it brings the lookup's name, left joined", () => assert.strictEqual(lookupName,
        'SELECT s.num, ss.name AS statusName\nFROM so s\nLEFT JOIN sostatus ss ON ss.id = s.statusId'));
    const bothStatuses = Schema.writeJoin(keyed, ['so', 'soitem'],
        [{ table: 'so', column: 'statusId' }, { table: 'soitem', column: 'statusId' }],
        [{ table: 'so', column: 'statusId' }, { table: 'soitem', column: 'statusId' }]);
    await check('two statuses are two joins, told apart by their table', () => assert.strictEqual(bothStatuses,
        'SELECT ss.name AS soStatusName, sis.name AS soitemStatusName\nFROM so s\n' +
        'JOIN soitem si ON si.soId = s.id\nLEFT JOIN sostatus ss ON ss.id = s.statusId\n' +
        'LEFT JOIN soitemstatus sis ON sis.id = si.statusId'));

    // part and so share a tax rate two steps apart; the order lines that sell
    // the part are three. The shared parent must lose.
    const turning = snapshot({
        part: ['id', 'num', 'taxId'],
        taxrate: ['id', 'name', 'code', 'rate', 'typeId'],
        so: ['id', 'num', 'taxRateId'],
        product: ['id', 'num', 'partId'],
        soitem: ['id', 'soId', 'productId', 'uomId'],
        uom: ['id', 'name', 'code', 'description', 'integral']
    }, [
        { tbl: 'part', col: 'taxId', rt: 'taxrate', rc: 'id', k: 'F1' },
        { tbl: 'so', col: 'taxRateId', rt: 'taxrate', rc: 'id', k: 'F2' },
        { tbl: 'product', col: 'partId', rt: 'part', rc: 'id', k: 'F3' },
        { tbl: 'soitem', col: 'productId', rt: 'product', rc: 'id', k: 'F4' },
        { tbl: 'soitem', col: 'soId', rt: 'so', rc: 'id', k: 'F5' },
        { tbl: 'part', col: 'uomId', rt: 'uom', rc: 'id', k: 'F6' },
        { tbl: 'soitem', col: 'uomId', rt: 'uom', rc: 'id', k: 'F7' }
    ]);
    const partToSo = Schema.writeJoin(turning, ['part', 'so']);
    await check('joins go through the rows that link two tables, not a parent they share', () => assert.strictEqual(partToSo,
        'SELECT p.num AS partNum, s.num AS soNum\nFROM part p\nJOIN product p2 ON p2.partId = p.id\n' +
        'JOIN soitem si ON si.productId = p2.id\nJOIN so s ON s.id = si.soId'));
    const afterUom = Schema.writeJoin(turning, ['part', 'uom', 'so']) || '';
    await check("and a table joined as a parent doesn't lead back down to another child",
        () => assert.ok(afterUom.includes('JOIN product') && !afterUom.includes('si.uomId'), afterUom));
    turning.removeForeignKeys(f => f.table === 'soitem');
    const viaParent = Schema.writeJoin(turning, ['part', 'so']) || '';
    await check('but through the shared parent when nothing else links them', () => assert.ok(
        viaParent.includes('JOIN taxrate t ON t.id = p.taxId') && viaParent.includes('JOIN so s ON s.taxRateId = t.id'), viaParent));

    // part, vendor and vendorparts, picked in that order. vendor is two steps
    // from part through vendorparts or through vendorcostrule, and the cost
    // rule's key comes first, so joining in pick order went through a table
    // nobody picked or could see.
    const vendors = snapshot({
        part: ['id', 'num', 'description'],
        vendor: ['id', 'name'],
        vendorparts: ['id', 'partId', 'vendorId', 'vendorPartNumber'],
        vendorcostrule: ['id', 'partId', 'vendorId', 'cost']
    }, [
        { tbl: 'vendorcostrule', col: 'partId', rt: 'part', rc: 'id', k: 'F1' },
        { tbl: 'vendorcostrule', col: 'vendorId', rt: 'vendor', rc: 'id', k: 'F2' },
        { tbl: 'vendorparts', col: 'partId', rt: 'part', rc: 'id', k: 'F3' },
        { tbl: 'vendorparts', col: 'vendorId', rt: 'vendor', rc: 'id', k: 'F4' }
    ]);
    const viaPicked = Schema.writeJoin(vendors, ['part', 'vendor', 'vendorparts'],
        [['part', 'num'], ['vendor', 'name'], ['vendorparts', 'vendorPartNumber']]) || '';
    await check('a picked table links the others, whatever order they were picked in', () => assert.strictEqual(viaPicked,
        'SELECT p.num, v.name, v2.vendorPartNumber\nFROM part p\nJOIN vendorparts v2 ON v2.partId = p.id\n' +
        'JOIN vendor v ON v.id = v2.vendorId'));
    const viaShown = Schema.writeJoin(vendors, ['part', 'vendor'], [], [], ['part', 'vendor', 'vendorparts']) || '';
    await check('between equal paths, the one through a table on the diagram',
        () => assert.ok(viaShown.includes('JOIN vendorparts') && !viaShown.includes('vendorcostrule'), viaShown));
    const viaHidden = Schema.writeJoin(vendors, ['part', 'vendor'], [], [], ['part', 'vendor']) || '';
    await check("and a table joined that isn't on the diagram is named",
        () => assert.ok(viaHidden.includes("isn't on the diagram: it's joined to link part and vendor"), viaHidden));

    // part's diagram has vendorparts beside it but not vendor, a step further:
    // "Show what vendorparts links to" brings vendor in, with the diagram
    // still about part.
    const aroundPart = Schema.graphAround(vendors, 'part', 1, false);
    const opened = Schema.graphAround(vendors, 'part', 1, false, [], ['vendorparts']);
    await check("showing a table's links draws what it links to, around the same table", () => assert.ok(
        Schema.node(aroundPart, 'vendor') === null && Schema.node(opened, 'vendor') !== null
        && opened.nodes.find(n => n.isFocus).table === 'part', at(opened)));

    const where = ['so', 'soitemstatus', 'customer', 'product', 'po', 'postatus', 'vendorparts', 'receipt', 'part',
        'tag', 'location', 'xo', 'mo', 'bomitem', 'wo', 'pick', 'shipcarton', 'carrier', 'postso',
        'taxrate', 'payment', 'sysuser', 'customfield', 'address', 'somethingelse'];
    const title = k => Schema.areaName(k) === 'Setup and users' ? 'Setup' : Schema.areaName(k);
    const areas = where.map(t => t + ':' + title(Schema.areaOf(t))).join(' ');
    await check('each table goes in its part of Fishbowl', () => assert.strictEqual(areas,
        'so:Sales soitemstatus:Sales customer:Sales product:Sales po:Purchasing postatus:Purchasing ' +
        'vendorparts:Purchasing receipt:Purchasing part:Inventory tag:Inventory location:Inventory ' +
        'xo:Inventory mo:Manufacturing bomitem:Manufacturing wo:Manufacturing pick:Shipping ' +
        'shipcarton:Shipping carrier:Shipping postso:Accounting taxrate:Accounting payment:Accounting ' +
        'sysuser:Setup customfield:Setup address:Setup somethingelse:Other'));

    const through = Schema.writeJoin(keyed, ['customer', 'soitem']);
    await check('and goes through a table not picked when that is the only way', () => assert.strictEqual(through,
        'SELECT c.name, si.productId\nFROM customer c\nJOIN so s ON s.customerId = c.id\nJOIN soitem si ON si.soId = s.id'));
    keyed.setTable('island', ['id', 'name']);
    const alone = Schema.writeJoin(keyed, ['so', 'island']) || '';
    await check('a table no keys reach is said so, not joined',
        () => assert.ok(alone.includes('-- island: no keys link it') && !alone.includes('JOIN island'), alone));
    keyed.removeTable('island');

    section('9r3. What gets offered');
    const qualified = Schema.suggest(snap, 'SELECT * FROM soitem si', 'si', 'q');
    await check("a qualifier offers that table's columns only",
        () => assert.deepStrictEqual(words(qualified), ['qtyOrdered'], show(qualified)));
    await check('and each says which table it is on',
        () => qualified[0].kind === 'column' && qualified[0].detail === 'soitem');
    await check('an unknown qualifier offers nothing',
        () => Schema.suggest(snap, 'SELECT 1', 'nosuch', '').length === 0);

    // Straight after FROM only a table can be legal.
    const afterFrom = Schema.suggest(snap, 'SELECT * FROM so', '', 'so', { before: 'SELECT * FROM so' });
    await check('after FROM, only tables are offered',
        () => assert.ok(afterFrom.length > 0 && afterFrom.every(i => i.kind === 'table'), show(afterFrom)));
    await check('and each says how wide it is',
        () => assert.strictEqual(afterFrom.find(i => i.text === 'so').detail, '3 cols'));

    // The one that matters: columns come from the tables the statement names.
    const scoped = Schema.suggest(snap, 'SELECT  FROM soitem si', '', 'qty', { before: 'SELECT qty' });
    await check('columns are scoped to the tables in the statement',
        () => assert.ok(words(scoped).includes('qtyOrdered'), show(scoped)));
    await check('a scoped column names its table',
        () => assert.strictEqual(scoped.find(i => i.text === 'qtyOrdered').detail, 'soitem'));

    const unrelated = Schema.suggest(snap, 'SELECT  FROM so', '', 'qty', { before: 'SELECT qty' });
    await check('a column from a table not in the statement is not offered',
        () => assert.ok(!words(unrelated).includes('qtyOrdered'), show(unrelated)));

    // Position decides the order, never what is excluded: a keyword is legal
    // almost everywhere, so hiding one would be worse than ranking it second.
    const inWhere = Schema.suggest(snap, 'SELECT * FROM so WHERE n', '', 'n', { before: 'SELECT * FROM so WHERE n' });
    await check('in a WHERE clause a column comes first',
        () => assert.ok(inWhere.length > 0 && inWhere[0].kind === 'column', show(inWhere)));
    await check('but keywords are still there', () => assert.ok(
        inWhere.some(i => i.kind === 'keyword') || !Schema.KEYWORDS.some(k => k.toLowerCase().startsWith('n')), show(inWhere)));

    const atStart = Schema.suggest(snap, 'sel', '', 'sel', { before: 'sel' });
    await check('at the start of a statement a keyword comes first',
        () => assert.ok(atStart.length > 0 && atStart[0].kind === 'keyword', show(atStart)));
    await check('keywords are offered in upper case', () => assert.strictEqual(atStart[0].text, 'SELECT'));

    // A column on more than one table names them rather than picking one.
    const shared = Schema.suggest(snap, 'SELECT  FROM so JOIN part ON 1=1', '', 'id', { before: 'SELECT id' });
    await check('a column on several tables lists them', () => {
        const d = shared.find(i => i.text === 'id').detail;
        assert.ok(d.includes('part') && d.includes('so'), show(shared));
    });

    await check('an aliased table counts as in scope', () => assert.deepStrictEqual(
        Schema.inScope(snap, 'SELECT * FROM soitem si JOIN part p ON p.id = si.id').sort(), ['part', 'soitem']));

    // Before any FROM there is nothing to scope to, so a short prefix would
    // match thousands of columns and bury the keywords.
    const early = Schema.suggest(snap, 'SELECT st', '', 'st', { before: 'SELECT st' });
    await check('with no table named a short prefix stays keyword-led',
        () => assert.ok(!words(early).includes('statusId'), show(early)));
    const longer = Schema.suggest(snap, 'SELECT sta', '', 'sta', { before: 'SELECT sta' });
    await check('a longer prefix does reach the columns',
        () => assert.ok(words(longer).includes('statusId'), show(longer)));

    await check('with no schema it still offers keywords',
        () => words(Schema.suggest(null, 'SELECT 1', '', 'sel')).includes('SELECT'));

    const parsedSchema = Schema.fromRows([{ t: 'part', c: 'id' }, { t: 'part', c: 'num' }]);
    await check('a data-query result becomes a snapshot',
        () => assert.deepStrictEqual(parsedSchema.columns('part'), ['id', 'num']));
    await check('column order is kept', () => parsedSchema.columnCount === 2);

    section('9t. Schema browser');
    const browse = snapshot({
        soitem: ['id', 'soId', 'qtyOrdered', 'qtyCommitted'],
        so: ['id', 'num', 'statusId'],
        part: ['id', 'num', 'description']
    });
    const tablesOf = g => (g.find(x => x.name === 'Tables') || { items: [] }).items;
    const named = g => g.map(x => x.name + '(' + x.items.length + ')').join(', ');

    const all = Schema.browse(browse, '');
    await check('with no filter every table is listed', () => assert.strictEqual(tablesOf(all).length, 3, named(all)));
    await check('and they are in order',
        () => assert.deepStrictEqual(tablesOf(all).map(t => t.name), ['part', 'so', 'soitem']));
    await check('a table carries its columns', () => tablesOf(all).find(t => t.name === 'so').columns.length === 3);
    await check('a column knows its table', () => tablesOf(all).find(t => t.name === 'so').columns[0].table === 'so');
    await check('and inserts qualified', () => tablesOf(all).find(t => t.name === 'so').columns[0].insert === 'so.id');

    const byTable = Schema.browse(browse, 'soit');
    await check('a table matches by name',
        () => assert.ok(tablesOf(byTable).length === 1 && tablesOf(byTable)[0].name === 'soitem', named(byTable)));
    await check('a table matched by name keeps all its columns', () => tablesOf(byTable)[0].columns.length === 4);

    // Finding which table holds a column is most of what this is opened for.
    const byColumn = Schema.browse(browse, 'qtyCommitted');
    await check('a table matches through its columns',
        () => assert.ok(tablesOf(byColumn).length === 1 && tablesOf(byColumn)[0].name === 'soitem', named(byColumn)));
    await check('and shows only the columns that matched',
        () => tablesOf(byColumn)[0].columns.length === 1 && tablesOf(byColumn)[0].columns[0].name === 'qtyCommitted');
    await check('expanded, so the match is visible without a click', () => tablesOf(byColumn)[0].expanded);
    await check('whereas a name match stays collapsed', () => !tablesOf(byTable)[0].expanded);

    await check('a term can match several tables', () => tablesOf(Schema.browse(browse, 'num')).length === 2);
    await check('matching ignores case', () => tablesOf(Schema.browse(browse, 'SOITEM')).length === 1);
    await check('no match gives nothing', () => Schema.browse(browse, 'zzz').length === 0);
    await check('no schema gives nothing rather than throwing', () => Schema.browse(null, 'so').length === 0);
    await check('the summary says what is loaded',
        () => assert.ok(Schema.describe(browse, all).includes('3 of 3 tables'), Schema.describe(browse, all)));
    await check('and says when nothing is', () => Schema.describe(null, []).includes('Not loaded'));

    section('9v. Views in the schema');
    // information_schema.COLUMNS covers views as well as base tables, so they
    // were always in the list, just indistinguishable.
    const mixed = Schema.fromRows([
        { tbl: 'part', col: 'id', kind: 'BASE TABLE' },
        { tbl: 'part', col: 'num', kind: 'BASE TABLE' },
        { tbl: 'qohview', col: 'partId', kind: 'VIEW' },
        { tbl: 'qohview', col: 'qty', kind: 'VIEW' }
    ]);
    await check('both kinds are read', () => mixed.tableNames().length === 2);
    await check('a view is marked as one', () => mixed.isView('qohview') && !mixed.isView('part'));
    await check('the counts separate', () => mixed.viewCount === 1 && mixed.columnCount === 4);

    mixed.applyHeavyViews([{ n: 'qohview' }]);
    await check('a materialising view is flagged', () => mixed.isHeavy('qohview'));
    await check('and a plain table is not', () => !mixed.isHeavy('part'));

    // JSON saved before views were understood loads fine and is quietly
    // wrong, so it is versioned out rather than trusted.
    const legacy = Schema.fromRows([{ t: 'part', c: 'id' }]);
    await check('the old column names still parse', () => legacy.hasTable('part') && legacy.viewCount === 0);
    await check('a fresh snapshot is stamped with the current version', () => legacy.version === Schema.CACHE_VERSION);

    const groups = Schema.browse(mixed, '');
    await check('the browser separates them', () => assert.ok(
        groups.length === 2 && groups[0].name === 'Tables' && groups[1].name === 'Views', named(groups)));
    await check('a table is marked as a table', () => !groups[0].items[0].isView);
    await check('a view is marked as a view', () => groups[1].items[0].isView);
    await check('and carries the warning', () => assert.ok(
        groups[1].items[0].isHeavy && Schema.tableHint(mixed, groups[1].items[0].name).includes('GROUP BY')));
    await check('a group is dropped when empty', () => Schema.browse(legacy, '').length === 1);
    await check('the summary counts each kind', () => {
        const d = Schema.describe(mixed, groups);
        assert.ok(d.includes('1 of 1 tables') && d.includes('1 of 1 views'), d);
    });

    // Completion has to tell them apart too.
    const viewHit = Schema.suggest(mixed, 'SELECT 1 FROM qoh', '', 'qoh', { before: 'SELECT 1 FROM qoh' });
    await check('a view is offered as a view, not a table',
        () => assert.ok(viewHit.length === 1 && viewHit[0].kind === 'view', show(viewHit)));
    await check('and its cost is on the row', () => assert.ok(viewHit[0].detail.includes('materialises'), viewHit[0].detail));

    section('JS port: loading, saving and the page');
    await check('every query starts with SELECT, the only kind the server takes',
        () => Object.values(Schema.QUERIES).every(q => /^SELECT\s/.test(q)));
    await check('the queries alias every column in lower case, as the runtime returns them', () => {
        for (const q of Object.values(Schema.QUERIES)) {
            for (const m of q.matchAll(/\bAS\s+([A-Za-z_]+)/g)) assert.strictEqual(m[1], m[1].toLowerCase(), q);
        }
    });

    const fakeRun = fail => async sql => {
        if (sql === Schema.QUERIES.columns) {
            return [{ tbl: 'so', col: 'id', kind: 'BASE TABLE' }, { tbl: 'soitem', col: 'id', kind: 'BASE TABLE' },
                { tbl: 'soitem', col: 'soId', kind: 'BASE TABLE' }, { tbl: 'qtyview', col: 'qty', kind: 'VIEW' }];
        }
        if (fail.includes(sql)) throw new Error('denied');
        if (sql === Schema.QUERIES.heavyViews) return [{ n: 'qtyview' }];
        return [{ tbl: 'so', col: 'id', rt: null, rc: null, k: 'PRIMARY' },
            { tbl: 'soitem', col: 'soId', rt: 'so', rc: 'id', k: 'FK1' }];
    };
    const loaded = await Schema.load(fakeRun([]));
    await check('load reads all three', () => loaded instanceof Schema.Snapshot && loaded.isHeavy('qtyview')
        && loaded.isKey('so', 'id') && loaded.refersTo('soitem', 'soId').refTable === 'so' && loaded.problems.length === 0);
    const noKeys = await Schema.load(fakeRun([Schema.QUERIES.keys]));
    await check('without the keys it still loads, and says what is missing', () => assert.ok(
        noKeys.hasTable('soitem') && noKeys.isHeavy('qtyview') && noKeys.foreignKeys.length === 0
        && noKeys.problems.length === 1 && noKeys.problems[0].includes('denied'), JSON.stringify(noKeys.problems)));
    const noHeavy = await Schema.load(fakeRun([Schema.QUERIES.heavyViews]));
    await check('and without the heavy views', () => !noHeavy.isHeavy('qtyview') && noHeavy.foreignKeys.length === 1
        && noHeavy.problems.length === 1);
    await check('without the columns there is nothing, so it rejects', async () => {
        await assert.rejects(Schema.load(async () => { throw new Error('no access'); }), /no access/);
    });
    await check('a string or a { results } wrapper reads as rows', async () => {
        const s = await Schema.load(async sql => sql === Schema.QUERIES.columns
            ? JSON.stringify([{ tbl: 'part', col: 'id' }]) : { results: [] });
        return s.hasTable('part');
    });

    await check('lookups ignore case, names keep their spelling', () => {
        const s = snapshot({ SoItem: ['ID', 'soId'] }, [{ tbl: 'SoItem', col: 'ID', k: 'PRIMARY' }]);
        return s.hasTable('soitem') && s.name('SOITEM') === 'SoItem' && s.isKey('soitem', 'id')
            && s.column('soitem', 'SOID') === 'soId' && s.name('nosuch') === null && s.columns('nosuch').length === 0;
    });
    await check('tableNames is sorted, tables and views together',
        () => assert.deepStrictEqual(mixed.tableNames(), ['part', 'qohview']));

    await check('a snapshot survives JSON', () => {
        const back = Schema.Snapshot.fromJSON(JSON.parse(JSON.stringify(loaded)));
        assert.deepStrictEqual(back.toJSON(), loaded.toJSON());
        assert.ok(back.isView('qtyview') && back.isHeavy('qtyview') && back.isKey('so', 'id'));
        assert.strictEqual(back.refersTo('soitem', 'soId').refTable, 'so');
    });
    await check('JSON from another version is refused', () => {
        const old = loaded.toJSON();
        old.version = 2;
        return Schema.Snapshot.fromJSON(old) === null && Schema.Snapshot.fromJSON('not json') === null;
    });

    await check('the key index follows edits to foreignKeys', () => {
        const s = snapshot({ a: ['id', 'bId'], b: ['id', 'name', 'x', 'y', 'z'] });
        assert.strictEqual(s.refersTo('a', 'bId'), null);
        s.foreignKeys.push({ table: 'a', column: 'bId', refTable: 'b', refColumn: 'id' });
        assert.strictEqual(s.refersTo('a', 'bId').refTable, 'b');
        s.foreignKeys = [];
        assert.strictEqual(s.refersTo('a', 'bId'), null);
    });

    await check('a path is steps of { from, to, key, up }', () => {
        const steps = Schema.findPath(turning, 'part', 'so');
        assert.ok(steps && steps.length > 0);
        for (const s of steps) assert.deepStrictEqual(Object.keys(s).sort(), ['from', 'key', 'to', 'up']);
        assert.strictEqual(steps[0].from, 'part');
        assert.strictEqual(steps[steps.length - 1].to, 'so');
        assert.strictEqual(Schema.findPath(turning, 'part', 'nosuch'), null);
    });

    await check('lookupName and identifying answer null for what is not there', () =>
        Schema.lookupName(keyed, 'so', 'num') === null && Schema.identifying(keyed, 'nosuch') === null
        && Schema.writeJoin(keyed, ['nosuch']) === null);
    await check('lookupName names the lookup, its name column and its key', () => assert.deepStrictEqual(
        Schema.lookupName(keyed, 'so', 'statusId'), { table: 'sostatus', name: 'name', key: 'id' }));

    await check('the diagram has the shape the page draws', () => {
        const g = Schema.graphAround(keyed, 'so', 1, false);
        assert.deepStrictEqual(Object.keys(g).sort(), ['edges', 'lookupsHidden', 'nodes', 'trimmed']);
        assert.deepStrictEqual(Object.keys(g.nodes[0]).sort(),
            ['column', 'isFocus', 'keys', 'links', 'lookups', 'others', 'row', 'table']);
        assert.deepStrictEqual(Object.keys(g.edges[0]).sort(), ['column', 'refColumn', 'refTable', 'table']);
    });
    await check('a big table is trimmed at the limit, and counted', () => {
        const tables = { hub: ['id'] };
        const keys = [];
        for (let i = 0; i < Schema.MAX_NODES + 5; i++) {
            tables['t' + i] = ['id', 'hubId'];
            keys.push({ tbl: 't' + i, col: 'hubId', rt: 'hub', rc: 'id', k: 'F' + i });
        }
        const g = Schema.graphAround(snapshot(tables, keys), 'hub', 1, false);
        return g.nodes.length === Schema.MAX_NODES && g.trimmed === 6;
    });

    await check('every area has a name, and the key lists them in order', () =>
        Schema.AREAS.length === 8 && Schema.AREAS[Schema.AREAS.length - 1] === 'other'
        && Schema.AREAS.every(a => Schema.areaName(a).length > 0) && Schema.areaName('setup') === 'Setup and users');

    await check('the browser hints say what a column is', () => {
        assert.strictEqual(Schema.columnHint(keyed, 'soitem', 'soId'),
            'Holds an id from so.id. Join with ON soitem.soId = so.id.');
        assert.strictEqual(Schema.columnHint(keyed, 'so', 'id'), 'The primary key of so.');
        assert.strictEqual(Schema.columnHint(keyed, 'so', 'num'), 'so.num');
        assert.strictEqual(Schema.referenceHint(keyed.referencedBy('so')[0]), 'soitem.soId holds an id from so.id.');
    });

    await check('tablesInOrder gives each table and what qualifies it', () => assert.deepStrictEqual(
        Schema.tablesInOrder('SELECT 1 FROM so s, part p JOIN soitem ON 1=1'),
        [{ table: 'so', qualifier: 's' }, { table: 'part', qualifier: 'p' }, { table: 'soitem', qualifier: 'soitem' }]));

    // The page this is inlined into does global text replacement on the
    // source, and strips control characters when it is saved.
    const source = fs.readFileSync(SOURCE, 'utf8');
    await check('the source never holds a brace and a percent sign together', () => !source.includes('{' + '%'));
    await check('nor a dollar sign before a capital letter', () => assert.ok(!/\$[A-Z]/.test(source),
        (source.match(/.*\$[A-Z].*/) || [''])[0]));
    await check('nor a control character', () => {
        for (let i = 0; i < source.length; i++) {
            const c = source.charCodeAt(i);
            if (c < 32 && c !== 10 && c !== 13 && c !== 9) throw new Error('character ' + c + ' at ' + i);
        }
    });

    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(e => {
    console.error(e);
    process.exitCode = 1;
});
