// FBLabel.word: Word label templates (.doc / .docx) to sheet setups.
//
//   node --test tools/label-tests/word.test.js
//
// Runs scripts/fb-label.js in a vm (Node 18+: DecompressionStream, Blob,
// Response). The Avery files are in samples/ (gitignored: not ours to share);
// a test whose file is missing is skipped.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const SAMPLES = path.join(__dirname, 'samples');
function lib() {
  const win = { DecompressionStream, Blob, Response, TextDecoder };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'scripts', 'fb-label.js'), 'utf8'), win);
  return win.FBLabel;
}
const L = lib();
const MM = 72 / 25.4;
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, what + ': ' + a + ' vs ' + b);

// Avery J8162: A4, 2 × 8 labels of 99.1 × 33.9 mm, 2.5 mm between the columns.
function j8162(r, file) {
  const s = r.stock, g = L.geometry(s);
  assert.equal(s.name, 'Avery J8162', file + ' name');
  assert.equal(s.w + 'x' + s.h, L.PAPERS.A4.join('x'), file + ' A4');   // arrays from the vm realm: compare as text
  assert.equal(s.cols, 2); assert.equal(s.rows, 8);
  near(g.lw / MM, 99.06, 0.1, file + ' label width mm');
  near(g.lh / MM, 33.87, 0.1, file + ' label height mm');
  near(s.gx / MM, 2.54, 0.05, file + ' gap across mm');
  assert.equal(s.gy, 0, file + ' no gap down');
  assert.ok(g.ok, file + ' labels fit');
  assert.equal(r.warnings.length, 0, file + ' no warnings');
}
for (const f of ['Avery_J8162_WordTemplate.doc', 'Avery_J8162_WordTemplate.docx']) {
  const p = path.join(SAMPLES, f);
  test('J8162 from ' + path.extname(f), { skip: !fs.existsSync(p) && 'no ' + f + ' in samples/' }, async () => {
    j8162(await L.word.read(fs.readFileSync(p), f), f);
  });
}
test('.doc and .docx of one template give the same setup', {
  skip: !['doc', 'docx'].every(e => fs.existsSync(path.join(SAMPLES, 'Avery_J8162_WordTemplate.' + e))) && 'samples missing'
}, async () => {
  const [a, b] = await Promise.all(['doc', 'docx'].map(e =>
    L.word.read(fs.readFileSync(path.join(SAMPLES, 'Avery_J8162_WordTemplate.' + e)), 'x.' + e)));
  const strip = s => Object.assign({}, s, { note: '' });
  assert.equal(JSON.stringify(strip(a.stock)), JSON.stringify(strip(b.stock)));
});
test('spacer rows become the gap down; leading spacer moves the top', () => {
  const r = L.word.toStock({ page: { w: 12240, h: 15840, top: 720, bottom: 720, left: 360, right: 360 }, source: 'docx', jc: '',
    left: 0, cols: [3600, 180, 3600, 180, 3600], rows: [144, 1440, 180, 1440, 180, 1440], cellMargin: 72 }, 'Some_Label_Template.docx');
  const s = r.stock;
  assert.equal(s.name, 'Some Label');
  assert.equal(s.cols, 3); assert.equal(s.rows, 3);
  assert.equal(s.gx, 9); assert.equal(s.gy, 9);
  assert.equal(s.mt, 36 + 7.2); assert.equal(s.ml, 18);
  assert.equal(s.pad, 3.6);
});
test('not a Word file: a plain message', async () => {
  await assert.rejects(L.word.read(new Uint8Array(600).fill(7), 'x.doc'), /isn't a Word file/);
  await assert.rejects(L.word.read(new Uint8Array(10), 'x.doc'), /empty or too short/);
});
