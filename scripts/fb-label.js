/*
 fb-label.js  —  Label sheets for Fishbowl BI reports (namespace: FBLabel).
 Shared Script "fb-label". Reports load it with its own Script directive after
 fb-lib (and fb-doc when the report uses its picker), and the Open Sans faces
 with the "fb-doc-fonts" Style directive. Deploy fb-styles, fb-lib,
 fb-doc + fb-doc-fonts, fb-label, then the label reports.

 The stock label reports are one jrxml per sheet: "Avery" (3 across on Letter),
 "2x4 Avery", "One Off" (a 2 x 1 in label printer page), "4x6 One Off"... An
 FBLabel report is one report for every sheet. The user picks the sheet from
 a row of pills; the label's fields shrink to fit whatever size it is.

   FBLabel.STANDARD     the built-in sheet setups (Avery 5160 / 5163, L7160 /
                        L7163, single 2 x 1, 4 x 2, 6 x 4 in labels)
   FBLabel.Stocks       sheet setups: standard + company (admin, shared by
                        every label report) + the user's own (all label reports)
   FBLabel.geometry     a setup's label size and positions
   FBLabel.fit          the largest font size that fits text in a box
   FBLabel.barcode      Code 128 (B + C), Code 39, EAN-13, UPC-A, QR Code, Data
                        Matrix: encoded here, drawn as SVG (no images, no web
                        service); checked with the zxing decoder 2026-10-20
   FBLabel.render       items + fields + setup -> sheets (HTML, sized in pt)
   FBLabel.pageOf       the items on one preview page (Start at label: page 1)
   FBLabel.showPage     one page on screen, as large as fits (the report viewer
                        shows a page at a time)
   FBLabel.preview      several sheets on screen, scaled to the panel
   FBLabel.print        the sheets through a print window, one sheet per page
   FBLabel.stockBar     the pills + the sheet setup editor; a Word label template
                        dropped on the page (or picked) opens there as a new setup
   FBLabel.word         reads a Word label template (Avery .doc / .docx) into a
                        sheet setup, in the browser
   FBLabel.fieldEditor  the label's fields: show, size, bold, align, lines,
                        height share, order
   FBLabel.mergeLayout  saved field settings over a report's field defaults

 A sheet setup ("stock"), every length in pt:
   { id, name, note, w, h (paper), cols, rows, mt, mb, ml, mr (margins),
     gx, gy (gaps between columns / rows), pad (inside each label) }
 The label size is what is left: (w - ml - mr - gx * (cols - 1)) / cols.

 A field: { key, label, kind: 'text' | 'barcode', of (barcode: the item value
 it encodes), symbology (barcode: a FBLabel.barcode.TYPES id), show, bold,
 size: 'auto' | pt (the largest size; text still shrinks to fit), fixed (with a
 size: always that size, cut short with an ellipsis), align: 'left' | 'center' | 'right', lines (text), share (the
 field's part of the label's height) }. An item is { <key>: value, ... }.

 Storage: company setups in FBLib.SharedData 'cdx.bi.labelStocks.v1'
 ({ stocks, hidden }, admin only); the user's in loadSettings
 'cdx.bi.labelStocks.mine.v1' ({ stocks }). Both are shared by every label
 report on purpose (literal keys).

 NOTE: Fishbowl substitutes report-setting tokens and Script/Style directives by
 global text replacement. This file must never contain either literal (a dollar
 sign + upper-case code + opening brace, or a brace-percent pair).

 History: 2026-10-20 first version, for the Part Barcodes port; then barcode
 types, Fixed sizes and the one-page preview. 2026-10-21: Word label
 templates (.doc / .docx) to sheet setups.
*/
(function (global) {
  'use strict';
  var FBLabel = global.FBLabel = global.FBLabel || {};
  FBLabel.BUILD = '2026.10.21-fdb9bea';   // @fb-build

  var FONT = '"FB Doc Open Sans", "Open Sans", Arial, sans-serif';
  var COMPANY_KEY = 'cdx.bi.labelStocks.v1';
  var MINE_KEY = 'cdx.bi.labelStocks.mine.v1';
  var LH = 1.15;                         // line height, as a multiple of the font size
  var UNITS = { in: 72, mm: 72 / 25.4, pt: 1 };
  var PAPERS = { Letter: [612, 792], A4: [595.28, 841.89], Legal: [612, 1008] };
  function mm(v) { return v * UNITS.mm; }

  function log(msg, kind) {
    try { if (global.FBLib && FBLib.Common && FBLib.Common.debugLog) FBLib.Common.debugLog('[FBLabel] ' + msg, kind || 'info'); } catch (_) {}
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function n2(v) { return Math.round(v * 100) / 100; }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }

  // ===================================================================
  //  Sheet setups
  // ===================================================================
  var STANDARD = [
    { id: 's:5160', name: 'Letter 3 × 10', note: 'Avery 5160 / 8160: 2⅝ × 1 in labels (the Part Barcodes Avery sheet)',
      w: 612, h: 792, cols: 3, rows: 10, mt: 36, mb: 36, ml: 13.5, mr: 13.5, gx: 9, gy: 0, pad: 4 },
    { id: 's:5163', name: 'Letter 2 × 5', note: 'Avery 5163 / 8163: 4 × 2 in labels (the 2x4 Avery sheet)',
      w: 612, h: 792, cols: 2, rows: 5, mt: 36, mb: 36, ml: 11.25, mr: 11.25, gx: 13.5, gy: 0, pad: 6 },
    { id: 's:l7160', name: 'A4 3 × 7', note: 'Avery L7160: 63.5 × 38.1 mm labels',
      w: 595.28, h: 841.89, cols: 3, rows: 7, mt: mm(15.15), mb: mm(15.15), ml: mm(7.21), mr: mm(7.21), gx: mm(2.54), gy: 0, pad: 4 },
    { id: 's:l7163', name: 'A4 2 × 7', note: 'Avery L7163: 99.1 × 38.1 mm labels',
      w: 595.28, h: 841.89, cols: 2, rows: 7, mt: mm(15.15), mb: mm(15.15), ml: mm(4.65), mr: mm(4.65), gx: mm(2.5), gy: 0, pad: 5 },
    { id: 's:2x1', name: 'Label 2 × 1 in', note: 'One label per page, for a label printer (the One Off label)',
      w: 144, h: 72, cols: 1, rows: 1, mt: 0, mb: 0, ml: 0, mr: 0, gx: 0, gy: 0, pad: 3 },
    { id: 's:4x2', name: 'Label 4 × 2 in', note: 'One label per page, for a label printer (the 2x4 One Off label)',
      w: 288, h: 144, cols: 1, rows: 1, mt: 0, mb: 0, ml: 0, mr: 0, gx: 0, gy: 0, pad: 6 },
    { id: 's:6x4', name: 'Label 6 × 4 in', note: 'A 4 × 6 in label printed landscape, one per page (the 4x6 One Off label)',
      w: 432, h: 288, cols: 1, rows: 1, mt: 0, mb: 0, ml: 0, mr: 0, gx: 0, gy: 0, pad: 10 },
    { id: 's:4x6', name: 'Label 4 × 6 in', note: 'A 4 × 6 in label printed portrait, one per page (the Packing Slip 4x6 label)',
      w: 288, h: 432, cols: 1, rows: 1, mt: 0, mb: 0, ml: 0, mr: 0, gx: 0, gy: 0, pad: 0 }
  ];
  FBLabel.STANDARD = STANDARD;
  FBLabel.PAPERS = PAPERS;

  function normStock(s) {
    s = Object.assign({}, s || {});
    var i = function (v, d, lo, hi) { v = Math.round(num(v, d)); return Math.min(hi, Math.max(lo, v)); };
    var p = function (v) { return Math.max(0, num(v, 0)); };
    s.name = String(s.name || 'Untitled').slice(0, 60);
    s.w = Math.max(36, num(s.w, 612)); s.h = Math.max(36, num(s.h, 792));
    s.cols = i(s.cols, 1, 1, 20); s.rows = i(s.rows, 1, 1, 40);
    ['mt', 'mb', 'ml', 'mr', 'gx', 'gy'].forEach(function (k) { s[k] = p(s[k]); });
    s.pad = Math.min(36, p(s.pad == null ? 4 : s.pad));
    return s;
  }

  /** A setup's label size, positions and whether the labels have room. */
  function geometry(stock) {
    var s = normStock(stock);
    var lw = (s.w - s.ml - s.mr - s.gx * (s.cols - 1)) / s.cols;
    var lh = (s.h - s.mt - s.mb - s.gy * (s.rows - 1)) / s.rows;
    return {
      W: s.w, H: s.h, lw: lw, lh: lh, cols: s.cols, rows: s.rows, per: s.cols * s.rows, pad: s.pad,
      ok: lw >= 18 && lh >= 12,
      x: function (c) { return s.ml + c * (lw + s.gx); },
      y: function (r) { return s.mt + r * (lh + s.gy); }
    };
  }
  // Position i of a sheet: across fills each row left to right; down fills
  // each column top to bottom, as Jasper's multi-column labels do.
  function slot(g, i, fill) {
    return fill === 'down' ? { c: Math.floor(i / g.rows), r: i % g.rows } : { c: i % g.cols, r: Math.floor(i / g.cols) };
  }
  FBLabel.geometry = geometry;
  FBLabel.normStock = normStock;

  function paperOf(s) {
    var names = Object.keys(PAPERS);
    for (var k = 0; k < names.length; k++) {
      var p = PAPERS[names[k]];
      if (Math.abs(s.w - p[0]) < 1 && Math.abs(s.h - p[1]) < 1) return { size: names[k], orientation: 'portrait' };
      if (Math.abs(s.w - p[1]) < 1 && Math.abs(s.h - p[0]) < 1) return { size: names[k], orientation: 'landscape' };
    }
    return { size: 'Custom', orientation: s.w > s.h ? 'landscape' : 'portrait' };
  }
  FBLabel.paperOf = paperOf;

  // ---- storage -------------------------------------------------------
  function isAdmin() {
    try { return !!(global.FBLib && FBLib.SharedData && FBLib.SharedData.isAdmin()); } catch (_) { return false; }
  }
  function readCompany(fresh) {
    var o = null;
    try { o = global.FBLib && FBLib.SharedData ? FBLib.SharedData.readJson(COMPANY_KEY, null, { fresh: !!fresh }) : null; } catch (_) {}
    o = o && typeof o === 'object' ? o : {};
    return { stocks: Array.isArray(o.stocks) ? o.stocks.filter(function (s) { return s && s.id; }) : [],
             hidden: Array.isArray(o.hidden) ? o.hidden.map(String) : [] };
  }
  function writeCompany(o) {
    if (!isAdmin()) return false;
    try { return !!FBLib.SharedData.writeJson(COMPANY_KEY, { stocks: o.stocks, hidden: o.hidden }, { adminOnly: true }); }
    catch (e) { log('Saving the company sheet setups failed: ' + (e && e.message || e), 'error'); return false; }
  }
  function readMine() {
    var raw = null;
    try { raw = typeof loadSettings === 'function' ? loadSettings(MINE_KEY) : null; } catch (_) {}
    var o = {};
    try { o = raw ? JSON.parse(raw) : {}; } catch (_) { o = {}; }
    return { stocks: Array.isArray(o && o.stocks) ? o.stocks.filter(function (s) { return s && s.id; }) : [] };
  }
  function writeMine(o) {
    try { if (typeof saveSettings !== 'function') return false; saveSettings(MINE_KEY, JSON.stringify({ stocks: o.stocks })); return true; }
    catch (e) { log('Saving your sheet setups failed: ' + (e && e.message || e), 'error'); return false; }
  }
  function newId(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

  var Stocks = {
    /** Every setup this user can pick: standard (less any an admin hid), company, then the user's own. */
    list: function (fresh) {
      var co = readCompany(fresh), mine = readMine();
      var out = [];
      STANDARD.forEach(function (s) { if (co.hidden.indexOf(s.id) < 0) out.push(Object.assign(normStock(s), { id: s.id, note: s.note, origin: 'standard' })); });
      co.stocks.forEach(function (s) { out.push(Object.assign(normStock(s), { id: String(s.id), note: s.note || '', origin: 'company' })); });
      mine.stocks.forEach(function (s) { out.push(Object.assign(normStock(s), { id: String(s.id), note: s.note || '', origin: 'mine' })); });
      return out;
    },
    get: function (id) {
      var all = Stocks.list();
      for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
      return null;
    },
    hiddenCount: function () { return readCompany().hidden.length; },
    /** Saves the user's own setup (a new one when stock.id isn't one of theirs); returns its id or null. */
    saveMine: function (stock) {
      var o = readMine(), s = strip(normStock(stock));
      var at = o.stocks.findIndex(function (x) { return x.id === s.id; });
      if (at < 0) { s.id = newId('m:'); o.stocks.push(s); } else o.stocks[at] = s;
      return writeMine(o) ? s.id : null;
    },
    deleteMine: function (id) {
      var o = readMine();
      o.stocks = o.stocks.filter(function (x) { return x.id !== id; });
      return writeMine(o);
    },
    /** Admin: saves a company setup (new unless stock.id is a company one); returns its id or null. */
    publish: function (stock) {
      if (!isAdmin()) return null;
      var o = readCompany(true), s = strip(normStock(stock));
      var at = o.stocks.findIndex(function (x) { return x.id === s.id; });
      if (at < 0) { s.id = newId('c:'); o.stocks.push(s); } else o.stocks[at] = s;
      if (!writeCompany(o)) return null;
      try { FBLib.SharedData.invalidate(COMPANY_KEY); } catch (_) {}
      return s.id;
    },
    /** Admin: removes a company setup, or hides a standard one, for everyone. */
    remove: function (id) {
      if (!isAdmin()) return false;
      var o = readCompany(true);
      if (/^s:/.test(id)) { if (o.hidden.indexOf(id) < 0) o.hidden.push(id); }
      else o.stocks = o.stocks.filter(function (x) { return x.id !== id; });
      var ok = writeCompany(o);
      try { FBLib.SharedData.invalidate(COMPANY_KEY); } catch (_) {}
      return ok;
    },
    /** Admin: shows every standard setup again. */
    unhideAll: function () {
      if (!isAdmin()) return false;
      var o = readCompany(true); o.hidden = [];
      var ok = writeCompany(o);
      try { FBLib.SharedData.invalidate(COMPANY_KEY); } catch (_) {}
      return ok;
    },
    isAdmin: isAdmin
  };
  function strip(s) {
    var o = {};
    ['id', 'name', 'note', 'w', 'h', 'cols', 'rows', 'mt', 'mb', 'ml', 'mr', 'gx', 'gy', 'pad'].forEach(function (k) {
      if (s[k] != null) o[k] = typeof s[k] === 'number' ? Math.round(s[k] * 1000) / 1000 : s[k];
    });
    return o;
  }
  FBLabel.Stocks = Stocks;

  // ===================================================================
  //  Text fitting (canvas measurement: fast, and the same in the print window)
  // ===================================================================
  var _ctx = null;
  function width(text, size, bold) {
    if (!_ctx) _ctx = document.createElement('canvas').getContext('2d');
    _ctx.font = (bold ? '700 ' : '400 ') + size + 'px ' + FONT;
    return _ctx.measureText(text).width;
  }
  // Greedy word wrap; a word wider than the line breaks between characters.
  function wrap(text, size, bold, w) {
    var words = String(text).split(/\s+/).filter(Boolean), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var word = words[i], t = cur ? cur + ' ' + word : word;
      if (width(t, size, bold) <= w) { cur = t; continue; }
      if (cur) lines.push(cur);
      if (width(word, size, bold) <= w) { cur = word; continue; }
      var part = '';
      for (var j = 0; j < word.length; j++) {
        if (part && width(part + word[j], size, bold) > w) { lines.push(part); part = word[j]; }
        else part += word[j];
      }
      cur = part;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  /**
   * The largest font size (0.25 pt steps) at which text fits a box.
   * @param {string} text
   * @param {object} o - { width, height (pt), lines (most lines), max, min (pt), bold, even, fixed }
   *   even: start from the size that gives every line room (height / lines), so a short text
   *   is no bigger than a long one; without it a short text may grow into the room of the other lines.
   *   fixed: always max; what doesn't fit the lines (or the height) is cut with an ellipsis.
   * @returns {{size:number, lines:string[], clipped:boolean}}
   */
  function fit(text, o) {
    text = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!text) return { size: 0, lines: [], clipped: false };
    var maxLines = Math.max(1, o.lines || 1), min = o.min || 4, bold = !!o.bold;
    if (o.fixed && o.max) {
      var room = Math.max(1, Math.min(maxLines, Math.floor((o.height + 0.01) / (o.max * LH))));
      var cut = clipLines(wrap(text, o.max, bold, o.width), room, o.max, bold, o.width);
      return { size: o.max, lines: cut.lines, clipped: cut.clipped };
    }
    var ok = function (s) {
      var ls = wrap(text, s, bold, o.width);
      return ls.length <= maxLines && ls.length * s * LH <= o.height + 0.01 ? ls : null;
    };
    var hi = Math.max(min, Math.min(o.max || 999, o.height / (o.even ? maxLines : 1) / LH));
    var ls = ok(hi);
    if (ls) return { size: Math.floor(hi * 4) / 4, lines: ls, clipped: false };
    if (ok(min)) {
      var lo = min, best = ok(min);
      for (var k = 0; k < 12; k++) {
        var mid = (lo + hi) / 2, r = ok(mid);
        if (r) { lo = mid; best = r; } else hi = mid;
      }
      var size = Math.floor(lo * 4) / 4;
      return { size: size, lines: ok(size) || best, clipped: false };
    }
    // Too long even at the smallest size: as many lines as there is room for, the last cut with an ellipsis.
    var fitLines = Math.max(1, Math.min(maxLines, Math.floor((o.height + 0.01) / (min * LH))));
    var c = clipLines(wrap(text, min, bold, o.width), fitLines, min, bold, o.width);
    return { size: min, lines: c.lines, clipped: true };
  }
  // The first n wrapped lines; when there were more, the last one ends in an ellipsis.
  function clipLines(all, n, size, bold, w) {
    var out = all.slice(0, n);
    if (all.length <= n) return { lines: out, clipped: false };
    var last = out[n - 1];
    while (last && width(last + '…', size, bold) > w) last = last.slice(0, -1);
    out[n - 1] = last + '…';
    return { lines: out, clipped: true };
  }
  FBLabel.fit = fit;
  FBLabel.wrap = wrap;

  // ===================================================================
  //  Barcodes: every symbology is encoded here and drawn as SVG (no
  //  images, no library, no web service).
  //    encode(type, text) -> { dim: 1, bits: '1011…', quiet }   (1 = bar)
  //                        | { dim: 2, grid: [[bool]] (rows), quiet }
  //                        | { error }
  // ===================================================================
  var Barcode = (function () {
    var TYPES = [
      { id: 'code128', label: 'Code 128', dim: 1, note: 'Any text: the standard reports\' barcode' },
      { id: 'code39', label: 'Code 39', dim: 1, note: 'Capitals, digits, space and - . $ / + %' },
      { id: 'ean13', label: 'EAN-13', dim: 1, note: '12 digits, or 13 with the check digit' },
      { id: 'upca', label: 'UPC-A', dim: 1, note: '11 digits, or 12 with the check digit' },
      { id: 'qr', label: 'QR Code', dim: 2, note: 'Any text; square' },
      { id: 'datamatrix', label: 'Data Matrix', dim: 2, note: 'Any text; square, small for short text' }
    ];
    function utf8(s) { var u = unescape(encodeURIComponent(s)), b = []; for (var i = 0; i < u.length; i++) b.push(u.charCodeAt(i)); return b; }
    // Bar / space widths ("2122…", starting with a bar) to a bit string.
    function widths(p) { var s = '', dark = true; for (var i = 0; i < p.length; i++) { s += (dark ? '1' : '0').repeat(+p[i]); dark = !dark; } return s; }

    // ---- Code 128: set B, switching to set C for runs of digits ----
    var C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 ' +
      '122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 ' +
      '322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 ' +
      '112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 ' +
      '312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 ' +
      '142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 ' +
      '421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 ' +
      '211412 211214 211232 2331112').split(' ');
    function code128(s) {
      for (var i = 0; i < s.length; i++) { var ch = s.charCodeAt(i); if (ch < 32 || ch > 126) return { error: 'Code 128 takes printable characters only' }; }
      var digits = function (at) { var n = 0; while (at + n < s.length && s[at + n] >= '0' && s[at + n] <= '9') n++; return n; };
      var codes = [], set, d0 = digits(0);
      if (d0 >= 4 || (d0 === s.length && d0 >= 2 && d0 % 2 === 0)) { set = 'C'; codes.push(105); } else { set = 'B'; codes.push(104); }
      i = 0;
      while (i < s.length) {
        if (set === 'C') {
          if (digits(i) >= 2) { codes.push(+s.substr(i, 2)); i += 2; } else { codes.push(100); set = 'B'; }
          continue;
        }
        var d = digits(i);
        if (d >= 4 && (i + d === s.length || d >= 6)) {
          if (d % 2) { codes.push(s.charCodeAt(i) - 32); i++; }   // an odd run: one digit in set B first
          codes.push(99); set = 'C';
          continue;
        }
        codes.push(s.charCodeAt(i) - 32); i++;
      }
      var sum = codes[0];
      for (var k = 1; k < codes.length; k++) sum += codes[k] * k;
      codes.push(sum % 103, 106);
      return { dim: 1, bits: codes.map(function (v) { return widths(C128[v]); }).join(''), quiet: 10 };
    }

    // ---- Code 39 (1 = wide element; wide is 3 narrow) ----
    var C39 = { '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000', '4': '000110001', '5': '100110000',
      '6': '001110000', '7': '000100101', '8': '100100100', '9': '001100100', 'A': '100001001', 'B': '001001001',
      'C': '101001000', 'D': '000011001', 'E': '100011000', 'F': '001011000', 'G': '000001101', 'H': '100001100',
      'I': '001001100', 'J': '000011100', 'K': '100000011', 'L': '001000011', 'M': '101000010', 'N': '000010011',
      'O': '100010010', 'P': '001010010', 'Q': '000000111', 'R': '100000110', 'S': '001000110', 'T': '000010110',
      'U': '110000001', 'V': '011000001', 'W': '111000000', 'X': '010010001', 'Y': '110010000', 'Z': '011010000',
      '-': '010000101', '.': '110000100', ' ': '011000100', '$': '010101000', '/': '010100010', '+': '010001010',
      '%': '000101010', '*': '010010100' };
    function code39(s) {
      if (!/^[0-9A-Z \-.$\/+%]+$/.test(s)) return { error: 'Code 39 takes capitals, digits, space and - . $ / + % only' };
      var bits = ('*' + s + '*').split('').map(function (ch) {
        return widths(C39[ch].split('').map(function (w) { return w === '1' ? 3 : 1; }).join(''));
      }).join('0');
      return { dim: 1, bits: bits, quiet: 10 };
    }

    // ---- EAN-13 / UPC-A (UPC-A is EAN-13 with a leading 0) ----
    var EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
    var EAN_R = EAN_L.map(function (p) { return p.replace(/./g, function (b) { return b === '1' ? '0' : '1'; }); });
    var EAN_G = EAN_R.map(function (p) { return p.split('').reverse().join(''); });
    var EAN_PAR = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
    function ean13(s, upc) {
      s = s.replace(/\s/g, '');
      if (upc) { if (!/^\d{11,12}$/.test(s)) return { error: 'UPC-A takes 11 or 12 digits' }; s = '0' + s; }
      else if (!/^\d{12,13}$/.test(s)) return { error: 'EAN-13 takes 12 or 13 digits' };
      var sum = 0;
      for (var i = 0; i < 12; i++) sum += +s[i] * (i % 2 ? 3 : 1);
      var check = (10 - sum % 10) % 10;
      if (s.length === 13 && +s[12] !== check) return { error: 'the check digit should be ' + check };
      s = s.slice(0, 12) + check;
      var par = EAN_PAR[+s[0]], bits = '101';
      for (i = 1; i <= 6; i++) bits += (par[i - 1] === 'L' ? EAN_L : EAN_G)[+s[i]];
      bits += '01010';
      for (i = 7; i <= 12; i++) bits += EAN_R[+s[i]];
      return { dim: 1, bits: bits + '101', quiet: 11 };
    }

    // ---- Reed-Solomon over GF(256) ----
    function gfMul(x, y, poly) {
      var z = 0;
      for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * poly); z ^= ((y >>> i) & 1) * x; }
      return z & 0xFF;
    }
    // The generator's coefficients (highest first, without the leading 1), roots a^first .. a^(first+degree-1).
    function rsDivisor(degree, poly, first) {
      var r = [], root = 1, i, j;
      for (i = 0; i < degree - 1; i++) r.push(0);
      r.push(1);
      for (i = 0; i < first; i++) root = gfMul(root, 2, poly);
      for (i = 0; i < degree; i++) {
        for (j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root, poly); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
        root = gfMul(root, 2, poly);
      }
      return r;
    }
    function rsRemainder(data, div, poly) {
      var r = div.map(function () { return 0; });
      data.forEach(function (b) {
        var f = b ^ r.shift(); r.push(0);
        div.forEach(function (c, i) { r[i] ^= gfMul(c, f, poly); });
      });
      return r;
    }

    // ---- QR Code (model 2, versions 1-40; numeric, alphanumeric or byte mode; level M by default) ----
    var QR_ECC = {
      L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
      M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
      Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
      H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
    };
    var QR_BLOCKS = {
      L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
      M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
      Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
      H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
    };
    var QR_FMT = { L: 1, M: 0, Q: 3, H: 2 };
    var QR_ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
    function qrRawModules(v) {
      var r = (16 * v + 128) * v + 64;
      if (v >= 2) { var na = Math.floor(v / 7) + 2; r -= (25 * na - 10) * na - 55; if (v >= 7) r -= 36; }
      return r;
    }
    function qrDataCodewords(v, ecl) { return Math.floor(qrRawModules(v) / 8) - QR_ECC[ecl][v] * QR_BLOCKS[ecl][v]; }
    function qrSegment(s) {
      var bits = [], put = function (val, n) { for (var i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); }, i;
      if (/^\d+$/.test(s)) {
        for (i = 0; i < s.length; i += 3) { var g = s.substr(i, 3); put(+g, g.length * 3 + 1); }
        return { mode: 1, count: s.length, cc: [10, 12, 14], bits: bits };
      }
      if (new RegExp('^[0-9A-Z $%*+\\-./:]+$').test(s)) {
        for (i = 0; i + 1 < s.length; i += 2) put(QR_ALNUM.indexOf(s[i]) * 45 + QR_ALNUM.indexOf(s[i + 1]), 11);
        if (s.length % 2) put(QR_ALNUM.indexOf(s[s.length - 1]), 6);
        return { mode: 2, count: s.length, cc: [9, 11, 13], bits: bits };
      }
      var b = utf8(s);
      b.forEach(function (x) { put(x, 8); });
      return { mode: 4, count: b.length, cc: [8, 16, 16], bits: bits };
    }
    function qr(s, ecl) {
      ecl = QR_FMT[ecl] != null ? ecl : 'M';
      var seg = qrSegment(s), ver, cap, cc;
      for (ver = 1; ver <= 40; ver++) {
        cc = seg.cc[ver <= 9 ? 0 : ver <= 26 ? 1 : 2];
        cap = qrDataCodewords(ver, ecl) * 8;
        if (seg.count < (1 << cc) && 4 + cc + seg.bits.length <= cap) break;
      }
      if (ver > 40) return { error: 'too long for a QR code' };
      var bits = [], put = function (val, n) { for (var i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
      put(seg.mode, 4); put(seg.count, cc);
      bits = bits.concat(seg.bits);
      for (var t = 0; t < 4 && bits.length < cap; t++) bits.push(0);
      while (bits.length % 8) bits.push(0);
      for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
      var data = [];
      for (var i = 0; i < bits.length; i += 8) { var by = 0; for (var j = 0; j < 8; j++) by = (by << 1) | bits[i + j]; data.push(by); }

      // Error correction, split into blocks and interleaved.
      var nb = QR_BLOCKS[ecl][ver], eccLen = QR_ECC[ecl][ver], raw = Math.floor(qrRawModules(ver) / 8);
      var nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), div = rsDivisor(eccLen, 0x11D, 0), blocks = [], k = 0;
      for (i = 0; i < nb; i++) {
        var dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
        k += dat.length;
        var ecc = rsRemainder(dat, div, 0x11D);
        if (i < nShort) dat.push(0);
        blocks.push(dat.concat(ecc));
      }
      var all = [];
      for (i = 0; i < blocks[0].length; i++) for (j = 0; j < nb; j++) if (i !== shortLen - eccLen || j >= nShort) all.push(blocks[j][i]);

      // The symbol.
      var n = ver * 4 + 17, M = [], F = [], x, y;
      for (y = 0; y < n; y++) { M.push(new Array(n).fill(false)); F.push(new Array(n).fill(false)); }
      var set = function (cx, cy, dark) { M[cy][cx] = dark; F[cy][cx] = true; };
      for (i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
      [[3, 3], [n - 4, 3], [3, n - 4]].forEach(function (c) {
        for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
          var d = Math.max(Math.abs(dx), Math.abs(dy)), xx = c[0] + dx, yy = c[1] + dy;
          if (xx >= 0 && xx < n && yy >= 0 && yy < n) set(xx, yy, d !== 2 && d !== 4);
        }
      });
      var align = [];
      if (ver > 1) {
        var na = Math.floor(ver / 7) + 2, step = Math.floor((ver * 8 + na * 3 + 5) / (na * 4 - 4)) * 2;
        align = [6];
        for (var pos = n - 7; align.length < na; pos -= step) align.splice(1, 0, pos);
      }
      align.forEach(function (ay, ai) {
        align.forEach(function (ax, aj) {
          if ((ai === 0 && aj === 0) || (ai === 0 && aj === align.length - 1) || (ai === align.length - 1 && aj === 0)) return;
          for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        });
      });
      var drawFormat = function (mask) {
        var d = QR_FMT[ecl] << 3 | mask, rem = d;
        for (var q = 0; q < 10; q++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        var b = ((d << 10) | rem) ^ 0x5412, bit = function (q) { return ((b >>> q) & 1) !== 0; };
        for (q = 0; q <= 5; q++) set(8, q, bit(q));
        set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
        for (q = 9; q < 15; q++) set(14 - q, 8, bit(q));
        for (q = 0; q < 8; q++) set(n - 1 - q, 8, bit(q));
        for (q = 8; q < 15; q++) set(8, n - 15 + q, bit(q));
        set(8, n - 8, true);
      };
      drawFormat(0);
      if (ver >= 7) {
        var rem = ver;
        for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
        var vb = ver << 12 | rem;
        for (i = 0; i < 18; i++) {
          var on = ((vb >>> i) & 1) !== 0, a = n - 11 + i % 3, bb = Math.floor(i / 3);
          set(a, bb, on); set(bb, a, on);
        }
      }
      // Codewords in the zigzag.
      i = 0;
      for (var right = n - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (var vert = 0; vert < n; vert++) for (j = 0; j < 2; j++) {
          x = right - j;
          y = ((right + 1) & 2) === 0 ? n - 1 - vert : vert;
          if (!F[y][x] && i < all.length * 8) { M[y][x] = ((all[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
        }
      }
      // The mask with the lowest penalty.
      var maskFn = [
        function (x, y) { return (x + y) % 2 === 0; }, function (x, y) { return y % 2 === 0; },
        function (x) { return x % 3 === 0; }, function (x, y) { return (x + y) % 3 === 0; },
        function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
        function (x, y) { return x * y % 2 + x * y % 3 === 0; },
        function (x, y) { return (x * y % 2 + x * y % 3) % 2 === 0; },
        function (x, y) { return ((x + y) % 2 + x * y % 3) % 2 === 0; }
      ];
      var applyMask = function (m) {
        for (var yy = 0; yy < n; yy++) for (var xx = 0; xx < n; xx++) if (!F[yy][xx] && maskFn[m](xx, yy)) M[yy][xx] = !M[yy][xx];
      };
      var best = 0, bestP = Infinity;
      for (var m = 0; m < 8; m++) {
        applyMask(m); drawFormat(m);
        var p = qrPenalty(M, n);
        if (p < bestP) { bestP = p; best = m; }
        applyMask(m);
      }
      applyMask(best); drawFormat(best);
      return { dim: 2, grid: M, quiet: 2, version: ver };
    }
    function qrPenalty(M, n) {
      var p = 0, dark = 0, x, y;
      for (var pass = 0; pass < 2; pass++) {
        for (var a = 0; a < n; a++) {
          var run = 0, prev = null, line = '';
          for (var b = 0; b < n; b++) {
            var v = pass ? M[b][a] : M[a][b];
            line += v ? '1' : '0';
            if (v === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else { run = 1; prev = v; }
          }
          var padded = '0000' + line + '0000', at = -1;
          while ((at = padded.indexOf('1011101', at + 1)) >= 0) {
            if (padded.substr(at - 4, 4) === '0000' || padded.substr(at + 7, 4) === '0000') p += 40;
          }
        }
      }
      for (y = 0; y < n; y++) for (x = 0; x < n; x++) {
        if (M[y][x]) dark++;
        if (x < n - 1 && y < n - 1 && M[y][x] === M[y][x + 1] && M[y][x] === M[y + 1][x] && M[y][x] === M[y + 1][x + 1]) p += 3;
      }
      return p + (Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1) * 10;
    }

    // ---- Data Matrix (ECC 200, square symbols 10 x 10 to 104 x 104, ASCII encodation) ----
    // [size, data regions per side, data codewords, error codewords, interleaved blocks]
    var DM = [[10, 1, 3, 5, 1], [12, 1, 5, 7, 1], [14, 1, 8, 10, 1], [16, 1, 12, 12, 1], [18, 1, 18, 14, 1], [20, 1, 22, 18, 1],
      [22, 1, 30, 20, 1], [24, 1, 36, 24, 1], [26, 1, 44, 28, 1], [32, 2, 62, 36, 1], [36, 2, 86, 42, 1], [40, 2, 114, 48, 1],
      [44, 2, 144, 56, 1], [48, 2, 174, 68, 1], [52, 2, 204, 84, 2], [64, 4, 280, 112, 2], [72, 4, 368, 144, 4],
      [80, 4, 456, 192, 4], [88, 4, 576, 224, 4], [96, 4, 696, 272, 4], [104, 4, 816, 336, 6]];
    function datamatrix(s) {
      var b = utf8(s), cw = [], i;
      for (i = 0; i < b.length; i++) {
        var c = b[i];
        if (c >= 48 && c <= 57 && i + 1 < b.length && b[i + 1] >= 48 && b[i + 1] <= 57) { cw.push(130 + (c - 48) * 10 + (b[i + 1] - 48)); i++; }
        else if (c > 127) cw.push(235, c - 127);
        else cw.push(c + 1);
      }
      var spec = null;
      for (i = 0; i < DM.length; i++) if (DM[i][2] >= cw.length) { spec = DM[i]; break; }
      if (!spec) return { error: 'too long for a Data Matrix' };
      var size = spec[0], regions = spec[1], cap = spec[2], nb = spec[4], eccPer = spec[3] / nb;
      if (cw.length < cap) cw.push(129);
      while (cw.length < cap) { var r = ((149 * (cw.length + 1)) % 253) + 1, v = 129 + r; cw.push(v > 254 ? v - 254 : v); }
      var div = rsDivisor(eccPer, 0x12D, 1), all = cw.slice(), eccs = [];
      for (var blk = 0; blk < nb; blk++) eccs.push(rsRemainder(cw.filter(function (_, k) { return k % nb === blk; }), div, 0x12D));
      for (var j = 0; j < eccPer; j++) for (blk = 0; blk < nb; blk++) all.push(eccs[blk][j]);

      // Module placement (ISO/IEC 16022 Annex F).
      var rs = size / regions - 2, nrow = regions * rs, ncol = nrow, A = new Array(nrow * ncol).fill(0);
      var mod = function (row, col, ch, bit) {
        if (row < 0) { row += nrow; col += 4 - ((nrow + 4) % 8); }
        if (col < 0) { col += ncol; row += 4 - ((ncol + 4) % 8); }
        A[row * ncol + col] = 10 * ch + bit;
      };
      var utah = function (row, col, ch) {
        mod(row - 2, col - 2, ch, 1); mod(row - 2, col - 1, ch, 2); mod(row - 1, col - 2, ch, 3); mod(row - 1, col - 1, ch, 4);
        mod(row - 1, col, ch, 5); mod(row, col - 2, ch, 6); mod(row, col - 1, ch, 7); mod(row, col, ch, 8);
      };
      var corner = function (pts, ch) { pts.forEach(function (p, k) { mod(p[0], p[1], ch, k + 1); }); };
      var ch = 1, row = 4, col = 0;
      do {
        if (row === nrow && col === 0) corner([[nrow - 1, 0], [nrow - 1, 1], [nrow - 1, 2], [0, ncol - 2], [0, ncol - 1], [1, ncol - 1], [2, ncol - 1], [3, ncol - 1]], ch++);
        if (row === nrow - 2 && col === 0 && ncol % 4) corner([[nrow - 3, 0], [nrow - 2, 0], [nrow - 1, 0], [0, ncol - 4], [0, ncol - 3], [0, ncol - 2], [0, ncol - 1], [1, ncol - 1]], ch++);
        if (row === nrow - 2 && col === 0 && ncol % 8 === 4) corner([[nrow - 3, 0], [nrow - 2, 0], [nrow - 1, 0], [0, ncol - 2], [0, ncol - 1], [1, ncol - 1], [2, ncol - 1], [3, ncol - 1]], ch++);
        if (row === nrow + 4 && col === 2 && !(ncol % 8)) corner([[nrow - 1, 0], [nrow - 1, ncol - 1], [0, ncol - 3], [0, ncol - 2], [0, ncol - 1], [1, ncol - 3], [1, ncol - 2], [1, ncol - 1]], ch++);
        do { if (row < nrow && col >= 0 && !A[row * ncol + col]) utah(row, col, ch++); row -= 2; col += 2; } while (row >= 0 && col < ncol);
        row += 1; col += 3;
        do { if (row >= 0 && col < ncol && !A[row * ncol + col]) utah(row, col, ch++); row += 2; col -= 2; } while (row < nrow && col >= 0);
        row += 3; col += 1;
      } while (row < nrow || col < ncol);
      if (!A[nrow * ncol - 1]) { A[nrow * ncol - 1] = 1; A[nrow * ncol - ncol - 2] = 1; }

      // Data regions inside their finder (solid left / bottom) and clock (dotted top / right) edges.
      var G = [], y, x;
      for (y = 0; y < size; y++) G.push(new Array(size).fill(false));
      for (y = 0; y < size; y++) for (x = 0; x < size; x++) {
        var ry = y % (rs + 2), rx = x % (rs + 2), on;
        if (rx === 0 || ry === rs + 1) on = true;
        else if (ry === 0) on = rx % 2 === 0;
        else if (rx === rs + 1) on = ry % 2 === 1;
        else {
          var val = A[(Math.floor(y / (rs + 2)) * rs + ry - 1) * ncol + Math.floor(x / (rs + 2)) * rs + rx - 1];
          on = val === 1 || (val >= 10 && ((all[Math.floor(val / 10) - 1] >>> (8 - val % 10)) & 1) === 1);
        }
        G[y][x] = on;
      }
      return { dim: 2, grid: G, quiet: 1 };
    }

    function encode(type, text) {
      var s = String(text == null ? '' : text);
      if (!s) return { error: 'nothing to encode' };
      try {
        switch (type) {
          case 'code39': return code39(s);
          case 'ean13': return ean13(s, false);
          case 'upca': return ean13(s, true);
          case 'qr': return qr(s, 'M');
          case 'datamatrix': return datamatrix(s);
          default: return code128(s);
        }
      } catch (e) { return { error: (e && e.message) || String(e) }; }
    }
    // The symbol as SVG, w x h pt (a 2-D symbol is square: the smaller of the two).
    function svg(enc, w, h) {
      var d = '', x, y;
      if (enc.dim === 1) {
        var total = enc.bits.length + 2 * enc.quiet;
        for (x = 0; x < enc.bits.length; x++) {
          if (enc.bits[x] !== '1') continue;
          var run = 1;
          while (enc.bits[x + run] === '1') run++;
          d += 'M' + (x + enc.quiet) + ' 0h' + run + 'v1h-' + run + 'z';
          x += run - 1;
        }
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' 1" preserveAspectRatio="none" shape-rendering="crispEdges" style="width:' +
          n2(w) + 'pt;height:' + n2(h) + 'pt"><path fill="#000" d="' + d + '"/></svg>';
      }
      var n = enc.grid.length, q = enc.quiet, side = Math.min(w, h);
      for (y = 0; y < n; y++) for (x = 0; x < n; x++) {
        if (!enc.grid[y][x]) continue;
        var r = 1;
        while (x + r < n && enc.grid[y][x + r]) r++;
        d += 'M' + (x + q) + ' ' + (y + q) + 'h' + r + 'v1h-' + r + 'z';
        x += r - 1;
      }
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + (n + 2 * q) + ' ' + (n + 2 * q) + '" shape-rendering="crispEdges" style="width:' +
        n2(side) + 'pt;height:' + n2(side) + 'pt"><path fill="#000" d="' + d + '"/></svg>';
    }
    return { TYPES: TYPES, encode: encode, svg: svg };
  })();
  FBLabel.barcode = Barcode;

  // ===================================================================
  //  Rendering
  // ===================================================================
  var CSS = [
    '.fbl-sheet{position:relative;background:#fff;overflow:hidden;box-sizing:border-box}',
    '.fbl-label{position:absolute;box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column;color:#000;font-family:' + FONT + '}',
    '.fbl-guides .fbl-label{outline:1px dashed #b8c4ca;outline-offset:-0.5px}',
    '.fbl-label.fbl-outline{outline:0.5pt solid #888;outline-offset:-0.25pt}',
    '.fbl-label.fbl-blank{background:repeating-linear-gradient(45deg,transparent 0 6px,rgba(0,0,0,.035) 6px 12px)}',
    '.fbl-print .fbl-label.fbl-blank{background:none}',
    '.fbl-row{flex:none;display:flex;flex-direction:column;justify-content:center;overflow:hidden}',
    '.fbl-row.al-left{align-items:flex-start;text-align:left}.fbl-row.al-center{align-items:center;text-align:center}.fbl-row.al-right{align-items:flex-end;text-align:right}',
    '.fbl-line{white-space:nowrap;line-height:' + LH + '}',
    '.fbl-bc{display:flex;width:100%;align-items:center}.fbl-bc svg{display:block;flex:none}',
    '.fbl-bc-bad{align-items:center;justify-content:center;font-size:6.5pt;color:#8A1E30;border:0.5pt dashed #c99;text-align:center;overflow:hidden}',
    '.fbl-row.al-left .fbl-bc{justify-content:flex-start}.fbl-row.al-center .fbl-bc{justify-content:center}.fbl-row.al-right .fbl-bc{justify-content:flex-end}',
    '.fbl-cal{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;font:9pt ' + FONT + ';color:#555}',
    '.fbl-cal b{font-size:14pt;color:#222}'
  ].join('\n');
  FBLabel.CSS = CSS;
  function injectCss() {
    if (typeof document === 'undefined' || document.getElementById('fbl-css')) return;
    var st = document.createElement('style'); st.id = 'fbl-css'; st.textContent = CSS + '\n' + UI_CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  var MIN_MODULE = 0.5;   // pt (0.18 mm, 7 mil): narrower bars print unevenly on a 203 dpi label printer
  var MAX_MODULE = 2.5;

  function fieldValue(f, item) { return item ? item[f.kind === 'barcode' ? (f.of || f.key) : f.key] : ''; }
  function share(f) { return Math.max(0.25, num(f.share, f.kind === 'barcode' ? 3 : (f.lines || 1))); }

  // A 1-D symbol is as wide as fits (bars at most MAX_MODULE) and the row's height; a 2-D one is
  // the largest square that fits. Too-narrow bars and text a symbology can't carry are counted.
  function barcodeHtml(type, text, iw, h, stats, cache) {
    var key = type + '|' + text, enc = cache[key] || (cache[key] = Barcode.encode(type, text));
    if (enc.error) {
      stats.badCode++;
      if (!stats.badWhy) stats.badWhy = enc.error;
      if (stats.badText.length < 20 && stats.badText.indexOf(text) < 0) stats.badText.push(text);
      return '<div class="fbl-bc fbl-bc-bad" style="height:' + n2(h) + 'pt"><span>' + esc(text) + ': can\'t be a ' + esc(typeLabel(type)) + '</span></div>';
    }
    var m, w, hh;
    if (enc.dim === 1) {
      var mods = enc.bits.length + 2 * enc.quiet;
      m = Math.min(MAX_MODULE, iw / mods); w = m * mods; hh = h;
    } else {
      var n = enc.grid.length + 2 * enc.quiet;
      w = hh = Math.min(iw, h); m = w / n;
    }
    if (m < MIN_MODULE) { stats.dense++; if (stats.denseText.indexOf(text) < 0) stats.denseText.push(text); }
    return '<div class="fbl-bc" style="height:' + n2(h) + 'pt">' + Barcode.svg(enc, w, hh) + '</div>';
  }
  function typeLabel(id) {
    for (var i = 0; i < Barcode.TYPES.length; i++) if (Barcode.TYPES[i].id === id) return Barcode.TYPES[i].label;
    return 'Code 128';
  }

  function labelInner(item, fields, g, cache, stats) {
    var iw = g.lw - 2 * g.pad, ih = g.lh - 2 * g.pad;
    var vis = fields.filter(function (f) { var v = fieldValue(f, item); return f.show !== false && v != null && String(v).trim() !== ''; });
    var total = vis.reduce(function (a, f) { return a + share(f); }, 0) || 1;
    return vis.map(function (f) {
      var h = ih * share(f) / total, v = String(fieldValue(f, item));
      var al = ' al-' + (f.align || 'center');
      if (f.kind === 'barcode') {
        return '<div class="fbl-row' + al + '" style="height:' + n2(h) + 'pt">' + barcodeHtml(f.symbology || 'code128', v, iw, Math.max(4, h - 1), stats, cache) + '</div>';
      }
      var key = f.key + '|' + (f.bold ? 1 : 0) + '|' + f.size + '|' + (f.fixed ? 1 : 0) + '|' + f.lines + '|' + n2(iw) + '|' + n2(h) + '|' + v;
      var r = cache[key];
      if (!r) {
        var auto = f.size === 'auto' || f.size == null;
        r = cache[key] = fit(v, { width: iw, height: h, lines: f.lines || 1, bold: f.bold, even: auto, fixed: !auto && !!f.fixed,
                                  max: auto ? 0 : num(f.size, 0), min: 4 });
        if (r.clipped) stats.clipped++;
      }
      return '<div class="fbl-row' + al + '" style="height:' + n2(h) + 'pt;font-size:' + r.size + 'pt' + (f.bold ? ';font-weight:700' : '') + '">' +
        r.lines.map(function (l) { return '<div class="fbl-line">' + esc(l) + '</div>'; }).join('') + '</div>';
    }).join('');
  }

  /**
   * Lays labels out on sheets.
   * @param {object} o - { stock, items: [{...}], fields, fill: 'across' | 'down', startAt (1-based position on the
   *   first sheet), outlines (print each label's outline), calibrate (one sheet of numbered outlines, no data) }
   * @returns {{sheets:string[], labels:number, g:object, stock:object, dense:number, denseText:string[], clipped:number, error?:string}}
   */
  function render(o) {
    injectCss();
    var stock = normStock(o.stock), g = geometry(stock);
    var res = { sheets: [], labels: 0, g: g, stock: stock, dense: 0, denseText: [], badCode: 0, badText: [], badWhy: '', clipped: 0 };
    if (!g.ok) { res.error = 'The labels have no room: check the margins, gaps and the number across and down.'; return res; }
    var box = function (i, inner, cls) {
      var p = slot(g, i, o.fill);
      return '<div class="fbl-label' + (cls || '') + (o.outlines ? ' fbl-outline' : '') + '" style="left:' + n2(g.x(p.c)) + 'pt;top:' + n2(g.y(p.r)) +
        'pt;width:' + n2(g.lw) + 'pt;height:' + n2(g.lh) + 'pt;padding:' + n2(g.pad) + 'pt">' + inner + '</div>';
    };
    var sheet = function (body) { return '<div class="fbl-sheet" style="width:' + n2(g.W) + 'pt;height:' + n2(g.H) + 'pt">' + body + '</div>'; };
    if (o.calibrate) {
      var u = o.units === 'mm' ? 'mm' : 'in', f = UNITS[u], d = u === 'mm' ? 1 : 2;
      var sz = (g.lw / f).toFixed(d) + ' × ' + (g.lh / f).toFixed(d) + ' ' + u, body = '';
      for (var c = 0; c < g.per; c++) body += box(c, '<div class="fbl-cal"><b>' + (c + 1) + '</b><span>' + sz + '</span></div>', ' fbl-outline');
      res.sheets.push(sheet(body));
      return res;
    }
    var items = o.items || [], cache = {}, stats = res;
    var pos = Math.min(Math.max(1, Math.round(num(o.startAt, 1))), g.per) - 1, cur = '';
    for (var s = 0; s < pos; s++) cur += box(s, '', ' fbl-blank');
    items.forEach(function (it) {
      cur += box(pos, labelInner(it, o.fields || [], g, cache, stats));
      res.labels++;
      if (++pos >= g.per) { res.sheets.push(sheet(cur)); cur = ''; pos = 0; }
    });
    if (cur) res.sheets.push(sheet(cur));
    return res;
  }
  FBLabel.render = render;

  /**
   * The items on one page and the position the first goes in: Start at label applies to the first page.
   * @returns {{ items, startAt, pages }}
   */
  function pageOf(list, stock, startAt, page) {
    var g = geometry(stock), first = Math.min(Math.max(1, Math.round(num(startAt, 1))), g.per) - 1;
    var pages = g.ok ? Math.max(1, Math.ceil((first + list.length) / g.per)) : 1;
    page = Math.min(Math.max(0, page | 0), pages - 1);
    if (page === 0) return { items: list.slice(0, g.per - first), startAt: first + 1, pages: pages, page: 0 };
    var from = g.per - first + (page - 1) * g.per;
    return { items: list.slice(from, from + g.per), startAt: 1, pages: pages, page: page };
  }
  FBLabel.pageOf = pageOf;

  /** Shows a rendered page (its first sheet) in a host element, as large as fits the host. */
  // o.scale: 1 is life size (CSS inches: 96 px to the inch, after Windows display scaling, which is
  // the physical size on a standard display); omitted, the page fits the host. Returns the scale used.
  function showPage(host, res, o) {
    injectCss();
    o = o || {};
    if (!host) return 1;
    if (res.error) { host.innerHTML = '<div class="fbl-msg fbl-msg-err">' + esc(res.error) + '</div>'; return 1; }
    if (!res.sheets.length) { host.innerHTML = '<div class="fbl-msg">' + esc(o.empty || 'Nothing to print.') + '</div>'; return 1; }
    var Wpx = res.g.W * 4 / 3, Hpx = res.g.H * 4 / 3;
    var aw = Math.max(120, (host.clientWidth || 800) - 32), ah = Math.max(120, (host.clientHeight || 600) - 32);
    var scale = o.scale > 0 ? o.scale : Math.min(o.maxScale || (res.g.per === 1 ? 3 : 1.5), aw / Wpx, ah / Hpx);
    host.innerHTML = '<div class="fbl-figs fbl-figs-page"><figure class="fbl-fig"><div class="fbl-frame" style="width:' + n2(Wpx * scale) + 'px;height:' + n2(Hpx * scale) + 'px">' +
      '<div class="fbl-scaler fbl-guides" style="transform:scale(' + scale + ')">' + res.sheets[0] + '</div></div></figure></div>';
    return scale;
  }
  /** The scale at which a page fits the host. */
  FBLabel.fitScale = function (host, stock) {
    var g = geometry(stock);
    var aw = Math.max(120, (host.clientWidth || 800) - 32), ah = Math.max(120, (host.clientHeight || 600) - 32);
    return Math.min(aw / (g.W * 4 / 3), ah / (g.H * 4 / 3));
  };
  FBLabel.showPage = showPage;

  /** Shows rendered sheets in a host element, scaled to its width. */
  function preview(host, res, o) {
    injectCss();
    o = o || {};
    if (!host) return;
    if (res.error) { host.innerHTML = '<div class="fbl-msg fbl-msg-err">' + esc(res.error) + '</div>'; return; }
    if (!res.sheets.length) { host.innerHTML = '<div class="fbl-msg">' + esc(o.empty || 'Nothing to print.') + '</div>'; return; }
    var Wpx = res.g.W * 4 / 3, Hpx = res.g.H * 4 / 3;
    var single = res.g.per === 1;
    var avail = Math.max(160, (host.clientWidth || 800) - 40);
    var scale = single ? Math.min(2.5, Math.max(0.5, Math.min(avail, 420) / Wpx)) : Math.min(1.25, avail / Wpx);
    var max = single ? (o.maxLabels || 24) : (o.maxSheets || 3);
    var shown = res.sheets.slice(0, max);
    var html = shown.map(function (sh, i) {
      return '<figure class="fbl-fig"><div class="fbl-frame" style="width:' + n2(Wpx * scale) + 'px;height:' + n2(Hpx * scale) + 'px">' +
        '<div class="fbl-scaler fbl-guides" style="transform:scale(' + scale + ')">' + sh + '</div></div>' +
        (single ? '' : '<figcaption>Sheet ' + (i + 1) + ' of ' + res.sheets.length + '</figcaption>') + '</figure>';
    }).join('');
    var more = res.sheets.length - shown.length;
    host.innerHTML = '<div class="fbl-figs' + (single ? ' fbl-figs-wrap' : '') + '">' + html + '</div>' +
      (more > 0 ? '<div class="fbl-msg">+ ' + more.toLocaleString() + ' more ' + (single ? 'label' : 'sheet') + (more === 1 ? '' : 's') + ' print.</div>' : '');
  }
  FBLabel.preview = preview;

  /**
   * Prints rendered sheets through a new window: one sheet per page, the page the sheet's size.
   * @param {object} res - render()'s result.
   * @param {object} [o] - { title, win (a window opened during the click), noPrint }
   * @returns {Window|null}
   */
  function print(res, o) {
    o = o || {};
    if (!res || !res.sheets || !res.sheets.length) return null;
    var fonts = Array.prototype.map.call(document.querySelectorAll('style'), function (st) { return st.textContent; })
      .filter(function (t) { return /@font-face/.test(t) && /Open Sans/.test(t); }).join('\n');
    var W = n2(res.g.W), H = n2(res.g.H);
    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + esc(o.title || document.title) + '</title>' +
      '<style>' + fonts + '</style><style>' + CSS + '\n' +
      '@page{size:' + W + 'pt ' + H + 'pt;margin:0}html,body{margin:0;padding:0}' +
      '.fbl-sheet{break-after:page;page-break-after:always}.fbl-sheet:last-child{break-after:auto;page-break-after:auto}' +
      '@media screen{body{background:#6b7378;padding:16px 0}.fbl-sheet{margin:0 auto 16px;box-shadow:0 2px 10px rgba(0,0,0,.35)}}' +
      '</style></head><body class="fbl-print">' + res.sheets.join('') + '</body></html>';
    var w = o.win || global.open('', '_blank');
    if (!w) { log('print: the print window was blocked', 'warn'); return null; }
    w.document.open(); w.document.write(html); w.document.close();
    var f = w.document.fonts, family = '"FB Doc Open Sans"';
    var ready = f && f.load ? Promise.all([f.load('9pt ' + family), f.load('bold 9pt ' + family)]).then(function () { return f.ready; }) : Promise.resolve();
    Promise.race([ready, new Promise(function (r) { setTimeout(r, 4000); })]).catch(function () {}).then(function () {
      setTimeout(function () {
        try { w.focus(); if (!o.noPrint) w.print(); } catch (e) { log('print failed: ' + (e && e.message || e), 'error'); }
      }, 300);
    });
    return w;
  }
  FBLabel.print = print;

  /** Resolves once the label font is loaded, so measurements match the printout. */
  FBLabel.fontsReady = function () {
    try {
      var f = document.fonts;
      if (!f || !f.load) return Promise.resolve();
      return Promise.race([
        Promise.all([f.load('10px "FB Doc Open Sans"'), f.load('bold 10px "FB Doc Open Sans"')]),
        new Promise(function (r) { setTimeout(r, 3000); })
      ]).catch(function () {});
    } catch (_) { return Promise.resolve(); }
  };

  // ===================================================================
  //  Field layout
  // ===================================================================
  /** A report's fields with the saved settings laid over them, in the saved order (new fields at the end). */
  function mergeLayout(defaults, saved) {
    var byKey = {};
    (Array.isArray(saved) ? saved : []).forEach(function (s) { if (s && s.key) byKey[s.key] = s; });
    var out = defaults.map(function (d, i) {
      var s = byKey[d.key] || {};
      return Object.assign({}, d, pick(s, ['show', 'bold', 'size', 'fixed', 'align', 'lines', 'share', 'symbology']), { _o: s.key ? (Array.isArray(saved) ? saved.indexOf(s) : i) : 1000 + i });
    });
    out.sort(function (a, b) { return a._o - b._o; });
    out.forEach(function (f) { delete f._o; });
    return out;
  }
  function pick(o, keys) { var r = {}; keys.forEach(function (k) { if (o[k] !== undefined) r[k] = o[k]; }); return r; }
  /** The saveable part of a field layout. */
  FBLabel.layoutState = function (fields) {
    return fields.map(function (f) { return Object.assign({ key: f.key }, pick(f, ['show', 'bold', 'size', 'fixed', 'align', 'lines', 'share', 'symbology'])); });
  };
  FBLabel.mergeLayout = mergeLayout;

  var SIZES = ['auto', 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60];
  var SHARES = [0.5, 1, 1.5, 2, 3, 4, 5, 6];
  var ALIGNS = [['left', '⯇', 'Left'], ['center', '≡', 'Centre'], ['right', '⯈', 'Right']];

  /**
   * The label's fields as a small table: show, height share, size, bold, align, lines, order.
   * @param {object} o - { mount, fields, onChange(fields) }
   * @returns {{ set(fields), get() }}
   */
  function fieldEditor(o) {
    injectCss();
    var host = typeof o.mount === 'string' ? document.getElementById(o.mount) : o.mount;
    var fields = clone(o.fields || []);
    var opt = function (v, cur, label) { return '<option value="' + v + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + (label || v) + '</option>'; };
    function draw() {
      host.innerHTML = '<table class="fbl-fe"><thead><tr><th></th><th>Field</th><th title="The field\'s share of the label\'s height">Height</th>' +
        '<th title="Auto: as large as its lines allow. A size is the largest it may be: long text shrinks to fit, unless Fixed.">Size</th>' +
        '<th title="Fixed: always this size; text that doesn\'t fit is cut short with …">Fixed</th><th title="Bold">B</th><th>Align</th><th title="Most lines the text may wrap onto">Lines</th><th></th></tr></thead><tbody>' +
        fields.map(function (f, i) {
          var text = f.kind !== 'barcode', off = f.show === false;
          return '<tr data-i="' + i + '" class="' + (off ? 'fbl-off' : '') + '">' +
            '<td><input type="checkbox" data-k="show"' + (off ? '' : ' checked') + ' title="Print this field"></td>' +
            '<td class="fbl-fe-name">' + esc(f.label) + '</td>' +
            '<td><select data-k="share">' + SHARES.map(function (v) { return opt(v, share(f)); }).join('') + '</select></td>' +
            (text
              ? '<td><select data-k="size">' + SIZES.map(function (v) { return opt(v, f.size == null ? 'auto' : f.size, v === 'auto' ? 'Auto' : v + ' pt'); }).join('') + '</select></td>' +
                '<td><input type="checkbox" data-k="fixed"' + (f.fixed && auto(f) === false ? ' checked' : '') + (auto(f) ? ' disabled title="Pick a size first"' : ' title="Always this size; cut short with … when it doesn\'t fit"') + '></td>' +
                '<td><input type="checkbox" data-k="bold"' + (f.bold ? ' checked' : '') + '></td>'
              : '<td colspan="3"><select data-k="symbology" title="The barcode\'s type">' + Barcode.TYPES.map(function (t) {
                  return '<option value="' + t.id + '"' + ((f.symbology || 'code128') === t.id ? ' selected' : '') + ' title="' + esc(t.note) + '">' + esc(t.label) + '</option>';
                }).join('') + '</select></td>') +
            '<td><span class="fbl-seg">' + ALIGNS.map(function (a) {
              return '<button type="button" data-k="align" data-v="' + a[0] + '" title="' + a[2] + '" class="' + ((f.align || 'center') === a[0] ? 'on' : '') + '">' + alignIcon(a[0]) + '</button>';
            }).join('') + '</span></td>' +
            '<td>' + (text ? '<select data-k="lines">' + [1, 2, 3, 4].map(function (v) { return opt(v, f.lines || 1); }).join('') + '</select>' : '<span class="fbl-na">–</span>') + '</td>' +
            '<td class="fbl-fe-mv"><button type="button" data-mv="-1" title="Move up"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
            '<button type="button" data-mv="1" title="Move down"' + (i === fields.length - 1 ? ' disabled' : '') + '>▼</button></td></tr>';
        }).join('') + '</tbody></table>';
    }
    function changed() { draw(); if (o.onChange) o.onChange(clone(fields)); }
    host.addEventListener('change', function (e) {
      var tr = e.target.closest('tr[data-i]'), k = e.target.dataset.k;
      if (!tr || !k) return;
      var f = fields[+tr.dataset.i];
      if (k === 'show' || k === 'bold' || k === 'fixed') f[k] = e.target.checked;
      else if (k === 'symbology') f.symbology = e.target.value;
      else if (k === 'size') f.size = e.target.value === 'auto' ? 'auto' : num(e.target.value, 8);
      else f[k] = num(e.target.value, 1);
      changed();
    });
    host.addEventListener('click', function (e) {
      var b = e.target.closest('button'), tr = b && b.closest('tr[data-i]');
      if (!tr) return;
      var i = +tr.dataset.i;
      if (b.dataset.k === 'align') { fields[i].align = b.dataset.v; changed(); }
      else if (b.dataset.mv) {
        var j = i + (+b.dataset.mv);
        if (j < 0 || j >= fields.length) return;
        var t = fields[i]; fields[i] = fields[j]; fields[j] = t; changed();
      }
    });
    draw();
    return { set: function (f) { fields = clone(f || []); draw(); }, get: function () { return clone(fields); } };
  }
  function auto(f) { return f.size === 'auto' || f.size == null; }
  function alignIcon(a) {
    var y = [6, 10, 14, 18], w = [16, 10, 16, 10];
    var lines = y.map(function (yy, i) {
      var x1 = a === 'left' ? 4 : a === 'right' ? 20 - w[i] : 12 - w[i] / 2;
      return '<line x1="' + x1 + '" y1="' + yy + '" x2="' + (x1 + w[i]) + '" y2="' + yy + '"/>';
    }).join('');
    return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' + lines + '</svg>';
  }
  FBLabel.fieldEditor = fieldEditor;

  // ===================================================================
  //  Word label templates (Avery and the like) -> a sheet setup
  //  FBLabel.word.read(arrayBuffer, fileName) -> Promise of
  //    { stock (a new, unsaved setup), label: { w, h } pt, source: 'doc' | 'docx', warnings }
  //  A label template is one table on the page: its wide columns and tall rows are
  //  the labels, narrow ones between them the gaps. Read from the file in the
  //  browser: Word 97-2003 .doc / .dot (compound file, the table's sprmTDefTable
  //  and row heights, the section's page size and margins) or .docx / .dotx
  //  (word/document.xml). Lengths in Word are twips (1/20 pt).
  // ===================================================================
  var Word = (function () {
    var TW = 1 / 20;

    // ---- Word 97-2003: the compound file's streams ----
    function cfb(u8) {
      var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      var u16 = function (o) { return dv.getUint16(o, true); }, u32 = function (o) { return dv.getUint32(o, true); };
      var ss = 1 << u16(0x1E), mss = 1 << u16(0x20), hdr = ss === 4096 ? 4096 : 512;
      var secOff = function (n) { return hdr + n * ss; };
      var END = 0xFFFFFFFA;
      var difat = [], i, v;
      for (i = 0; i < 109; i++) { v = u32(0x4C + i * 4); if (v < END) difat.push(v); }
      var dsec = u32(0x44), nd = u32(0x48);
      while (nd-- > 0 && dsec < END && secOff(dsec) + ss <= u8.length) {
        for (i = 0; i < ss / 4 - 1; i++) { v = u32(secOff(dsec) + i * 4); if (v < END) difat.push(v); }
        dsec = u32(secOff(dsec) + ss - 4);
      }
      var fat = [];
      difat.forEach(function (s) { if (secOff(s) + ss <= u8.length) for (var k = 0; k < ss / 4; k++) fat.push(u32(secOff(s) + k * 4)); });
      function chain(start, table) {
        var out = [], s = start, guard = 0;
        while (s < END && guard++ < 100000) { out.push(s); s = table[s]; }
        return out;
      }
      function read(start, size) {
        var out = new Uint8Array(size), pos = 0;
        chain(start, fat).forEach(function (s) {
          var n = Math.min(ss, size - pos), at = secOff(s);
          if (n > 0 && at + n <= u8.length) { out.set(u8.subarray(at, at + n), pos); pos += n; }
        });
        return out;
      }
      var dirStart = u32(0x30), dir = read(dirStart, chain(dirStart, fat).length * ss);
      var ddv = new DataView(dir.buffer), entries = [];
      for (var o = 0; o + 128 <= dir.length; o += 128) {
        var nl = ddv.getUint16(o + 0x40, true), name = '';
        for (var c = 0; c + 2 < nl; c += 2) name += String.fromCharCode(ddv.getUint16(o + c, true));
        entries.push({ name: name, type: dir[o + 0x42], start: ddv.getUint32(o + 0x74, true), size: ddv.getUint32(o + 0x78, true) });
      }
      var cutoff = u32(0x38), mini = null, minifat = null;
      return function stream(name) {
        var e = entries.filter(function (x) { return x.name === name && x.type === 2; })[0];
        if (!e) return null;
        if (e.size >= cutoff) return read(e.start, e.size);
        if (!mini) {
          mini = read(entries[0].start, entries[0].size);
          var ms = u32(0x3C), mb = read(ms, chain(ms, fat).length * ss), mdv = new DataView(mb.buffer);
          minifat = []; for (var k = 0; k + 4 <= mb.length; k += 4) minifat.push(mdv.getUint32(k, true));
        }
        var out = new Uint8Array(e.size), pos = 0;
        chain(e.start, minifat).forEach(function (s) {
          var n = Math.min(mss, e.size - pos);
          if (n > 0) { out.set(mini.subarray(s * mss, s * mss + n), pos); pos += n; }
        });
        return out;
      };
    }
    // A sprm's operand length (the sprm at g[i]); -1 when it can't be read.
    function sprmLen(g, i) {
      var sprm = g[i] | (g[i + 1] << 8);
      switch (sprm >> 13) {
        case 0: case 1: return 1;
        case 2: case 4: case 5: return 2;
        case 3: return 4;
        case 7: return 3;
        case 6:
          if (sprm === 0xD608 || sprm === 0xD606) return ((g[i + 2] | (g[i + 3] << 8)) - 1) + 2;   // a 2-byte cb, one too many
          if (sprm === 0xC615) return g[i + 2] === 255 ? -1 : g[i + 2] + 1;
          return g[i + 2] + 1;
      }
      return -1;
    }
    function eachSprm(g, from, to, fn) {
      var i = from;
      while (i + 2 <= to) {
        var len = sprmLen(g, i);
        if (len < 0 || i + 2 + len > to) break;
        fn(g[i] | (g[i + 1] << 8), i + 2, len);
        i += 2 + len;
      }
    }
    function fromDoc(u8) {
      var stream = cfb(u8), wd = stream('WordDocument');
      if (!wd) throw new Error('it has no Word document inside');
      var w = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
      if (w.getUint16(0, true) !== 0xA5EC) throw new Error('it isn\'t a Word document');
      var flags = w.getUint16(0x0A, true);
      if (flags & 0x0100) throw new Error('it is password protected');
      var tb = stream(flags & 0x0200 ? '1Table' : '0Table');
      if (!tb) throw new Error('its table stream is missing');
      var t = new DataView(tb.buffer, tb.byteOffset, tb.byteLength);
      // FibRgFcLcb97 follows FibBase (32), csw + FibRgW, cslw + FibRgLw, cbRgFcLcb.
      var o = 34 + w.getUint16(32, true) * 2;
      o += 2 + w.getUint16(o, true) * 4 + 2;
      var fcLcb = function (k) { return { fc: w.getUint32(o + k * 8, true), lcb: w.getUint32(o + k * 8 + 4, true) }; };
      // The first section's page (PlcfSed -> Sepx); Word's defaults when a sprm is absent.
      var page = { w: 12240, h: 15840, top: 1440, bottom: 1440, left: 1800, right: 1800 };
      var sed = fcLcb(6);
      if (sed.lcb >= 16 && sed.fc + sed.lcb <= tb.length) {
        var n = (sed.lcb - 4) / 16, fcSepx = t.getInt32(sed.fc + (n + 1) * 4 + 2, true);
        if (fcSepx >= 0 && fcSepx + 2 < wd.length) {
          var cb = w.getInt16(fcSepx, true);
          eachSprm(wd, fcSepx + 2, Math.min(wd.length, fcSepx + 2 + cb), function (sprm, at) {
            var u = w.getUint16(at, true), s = w.getInt16(at, true);
            if (sprm === 0xB01F) page.w = u; else if (sprm === 0xB020) page.h = u;
            else if (sprm === 0xB021) page.left = u; else if (sprm === 0xB022) page.right = u;
            else if (sprm === 0x9023) page.top = Math.abs(s); else if (sprm === 0x9024) page.bottom = Math.abs(s);
          });
        }
      }
      // Table rows: a row end's PAPX (in the FKPs PlcfBtePapx names) holds its cell
      // boundaries (sprmTDefTable) and height (sprmTDyaRowHeight; negative = exact).
      var bte = fcLcb(13), nb = (bte.lcb - 4) / 8, rows = [], seen = {}, gapHalf = null;
      for (var k = 0; k < nb; k++) {
        var base = (t.getUint32(bte.fc + (nb + 1) * 4 + k * 4, true) & 0x3FFFFF) * 512;
        if (base + 512 > wd.length) continue;
        var crun = wd[base + 511];
        for (var r = 0; r < crun; r++) {
          var bOff = wd[base + (crun + 1) * 4 + r * 13];
          if (!bOff) continue;
          var at = base + bOff * 2;
          if (seen[at]) continue;
          seen[at] = 1;
          var c1 = wd[at], size;
          if (c1) { size = 2 * c1 - 1; at += 1; } else { size = 2 * wd[at + 1]; at += 2; }
          var cells = null, height = null;
          eachSprm(wd, at + 2, Math.min(wd.length, at + size), function (sprm, p) {
            if (sprm === 0xD608) {
              var nc = wd[p + 2]; cells = [];
              for (var q = 0; q <= nc; q++) cells.push(w.getInt16(p + 3 + q * 2, true));
            } else if (sprm === 0x9407) height = w.getInt16(p, true);
            else if (sprm === 0x9602 && gapHalf == null) gapHalf = w.getInt16(p, true);   // sprmTDxaGapHalf: the cells' side margin
          });
          if (cells && cells.length > 1) rows.push({ cells: cells, h: Math.abs(height || 0) });
        }
      }
      if (!rows.length) throw new Error('it has no label table');
      // Rows that share the commonest cell layout are the label table.
      var count = {}, best = null;
      rows.forEach(function (x) { var key = x.cells.join(','); count[key] = (count[key] || 0) + 1; if (!best || count[key] > count[best]) best = key; });
      var cellsOf = best.split(',').map(Number);
      return {
        page: page, source: 'doc', jc: '',
        left: cellsOf[0],                                         // from the left margin; negative: outdented
        cols: cellsOf.slice(1).map(function (x, i) { return x - cellsOf[i]; }),
        rows: rows.filter(function (x) { return x.cells.join(',') === best; }).map(function (x) { return x.h; }),
        cellMargin: gapHalf
      };
    }

    // ---- .docx: a zip; word/document.xml and word/settings.xml ----
    function inflate(data) {
      if (typeof DecompressionStream !== 'function') return Promise.reject(new Error('this browser can\'t open .docx files; save the template as .doc'));
      var s = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(s).arrayBuffer().then(function (b) { return new Uint8Array(b); });
    }
    function unzip(u8, want) {
      var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), e = u8.length - 22;
      while (e >= 0 && dv.getUint32(e, true) !== 0x06054B50) e--;
      if (e < 0) return Promise.reject(new Error('it isn\'t a .docx file'));
      var n = dv.getUint16(e + 10, true), p = dv.getUint32(e + 16, true), jobs = [], out = {};
      var dec = new TextDecoder();
      for (var i = 0; i < n && p + 46 <= u8.length; i++) {
        var method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
        var nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
        var name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
        if (want.indexOf(name) >= 0) {
          var ds = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true), data = u8.subarray(ds, ds + csize);
          jobs.push((method === 0 ? Promise.resolve(data) : inflate(data)).then((function (nm) { return function (b) { out[nm] = dec.decode(b); }; })(name)));
        }
        p += 46 + nl + xl + cl;
      }
      return Promise.all(jobs).then(function () { return out; });
    }
    function attr(tag, name) { var m = new RegExp('\\b' + name + '="(-?\\d+)"').exec(tag || ''); return m ? +m[1] : null; }
    function first(re, s) { var m = re.exec(s || ''); return m ? m[0] : ''; }
    function fromDocx(u8) {
      return unzip(u8, ['word/document.xml', 'word/settings.xml']).then(function (f) {
        var x = f['word/document.xml'];
        if (!x) throw new Error('it isn\'t a Word document');
        var pgSz = first(/<w:pgSz\b[^>]*>/, x), pgMar = first(/<w:pgMar\b[^>]*>/, x);
        var dflt = function (v, d) { return v == null ? d : v; };
        var page = { w: dflt(attr(pgSz, 'w:w'), 12240), h: dflt(attr(pgSz, 'w:h'), 15840),
          top: Math.abs(dflt(attr(pgMar, 'w:top'), 1440)), bottom: Math.abs(dflt(attr(pgMar, 'w:bottom'), 1440)),
          left: dflt(attr(pgMar, 'w:left'), 1800), right: dflt(attr(pgMar, 'w:right'), 1800) };
        var tbl = first(/<w:tbl>[\s\S]*?<\/w:tbl>/, x);
        if (!tbl) throw new Error('it has no label table');
        var cols = (tbl.match(/<w:gridCol\b[^>]*>/g) || []).map(function (g) { return attr(g, 'w:w') || 0; });
        var rows = (tbl.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || []).map(function (tr) { return Math.abs(attr(first(/<w:trHeight\b[^>]*>/, tr), 'w:val') || 0); });
        var tblPr = first(/<w:tblPr>[\s\S]*?<\/w:tblPr>/, tbl);
        var ind = attr(first(/<w:tblInd\b[^>]*>/, tblPr), 'w:w') || 0;
        var cellL = attr(first(/<w:tblCellMar>[\s\S]*?<w:(?:left|start)\b[^>]*>/, tblPr), 'w:w');
        var jc = (/<w:jc w:val="(\w+)"/.exec(tblPr) || [])[1] || '';
        var compat = +((/w:name="compatibilityMode"[^>]*w:val="(\d+)"/.exec(f['word/settings.xml'] || '') || [])[1] || 0);
        // Before Word 2013 (compatibility mode < 15) a table's edge sits its left cell
        // margin outside the indent, so the cell text lines up with the page margin.
        var cm = cellL == null ? 108 : cellL;
        return { page: page, source: 'docx', jc: jc, left: ind - (compat < 15 ? cm : 0), cols: cols, rows: rows, cellMargin: cellL };
      });
    }

    // ---- the table -> a sheet setup ----
    function avg(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
    function toStock(t, fileName) {
      var p = t.page, W = p.w * TW, H = p.h * TW, warnings = [];
      if (!t.cols.length || !t.rows.length) throw new Error('its table has no labels');
      // Columns: the wide ones are labels; narrow ones between them are the gaps.
      var widest = Math.max.apply(null, t.cols), x0 = (p.left + t.left) * TW;
      if (t.jc === 'center') x0 = (W - avg(t.cols) * t.cols.length * TW) / 2;
      var starts = [], gaps = [], lw = [], run = 0, cx = x0;
      t.cols.forEach(function (c) {
        if (c >= widest * 0.5) { if (starts.length) gaps.push(run * TW); starts.push(cx + (starts.length ? 0 : 0)); lw.push(c * TW); run = 0; }
        else if (starts.length) run += c;
        else x0 += c * TW;
        cx += c * TW;
      });
      // Rows: tall ones are labels; short ones between them the gaps; leading short ones move the top.
      var tallest = Math.max.apply(null, t.rows);
      if (!tallest) throw new Error('its rows have no height set, so the label height isn\'t known');
      var top = p.top * TW, nRows = 0, lh = [], gy = [], rr = 0;
      t.rows.forEach(function (h) {
        if (h >= tallest * 0.5) { if (nRows) gy.push(rr * TW); nRows++; lh.push(h * TW); rr = 0; }
        else if (nRows) rr += h;
        else top += h * TW;
      });
      var LW = avg(lw), LH = avg(lh), GX = avg(gaps), GY = avg(gy);
      if (lw.some(function (v) { return Math.abs(v - LW) > 1; })) warnings.push('the label columns differ in width; the setup uses their average');
      if (lh.some(function (v) { return Math.abs(v - LH) > 1; })) warnings.push('the label rows differ in height; the setup uses their average');
      // Only the rows that fit on the page (a template's table can run past it).
      while (nRows > 1 && top + nRows * LH + (nRows - 1) * GY > H + 1) nRows--;
      var cols = starts.length, ml = starts[0];
      var r2 = function (v) { return Math.round(v * 100) / 100; };
      var base = String(fileName || '').replace(/^.*[\\/]/, '').replace(/\.(docx?|dotx?)$/i, '').replace(/[_-]?(word)?[_-]?template$/i, '').replace(/[_]+/g, ' ').trim();
      var stock = {
        name: (base || 'Word template').slice(0, 60),
        note: 'From ' + String(fileName || 'a Word template').replace(/^.*[\\/]/, '') + ': ' + r2(LW / UNITS.mm) + ' × ' + r2(LH / UNITS.mm) + ' mm labels',
        w: r2(W), h: r2(H), cols: cols, rows: nRows,
        mt: r2(top), mb: r2(Math.max(0, H - top - nRows * LH - (nRows - 1) * GY)),
        ml: r2(ml), mr: r2(Math.max(0, W - ml - cols * LW - (cols - 1) * GX)),
        gx: r2(GX), gy: r2(GY),
        pad: t.cellMargin != null ? r2(Math.max(2, Math.min(12, t.cellMargin * TW))) : 4
      };
      // Snap a page within a point of a standard size to it exactly.
      Object.keys(PAPERS).forEach(function (k) {
        var pp = PAPERS[k];
        if (Math.abs(stock.w - pp[0]) < 1 && Math.abs(stock.h - pp[1]) < 1) { stock.w = pp[0]; stock.h = pp[1]; }
        if (Math.abs(stock.w - pp[1]) < 1 && Math.abs(stock.h - pp[0]) < 1) { stock.w = pp[1]; stock.h = pp[0]; }
      });
      return { stock: stock, label: { w: r2(LW), h: r2(LH) }, source: t.source, warnings: warnings };
    }

    /** Reads a Word label template (ArrayBuffer or Uint8Array) into a new sheet setup. */
    function read(buf, fileName) {
      return Promise.resolve().then(function () {
        var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
        if (u8.length < 512) throw new Error('the file is empty or too short');
        var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        if (dv.getUint32(0, true) === 0xE011CFD0 && dv.getUint32(4, true) === 0xE11AB1A1) return fromDoc(u8);
        if (u8[0] === 0x50 && u8[1] === 0x4B) return fromDocx(u8);
        throw new Error('it isn\'t a Word file (.doc or .docx)');
      }).then(function (t) { return toStock(t, fileName); });
    }
    return { read: read, toStock: toStock };
  })();
  FBLabel.word = Word;

  // ===================================================================
  //  Sheet setup pills + editor
  // ===================================================================
  var UI_CSS = [
    '.fbl-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.fbl-pills{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
    '.fbl-pill{border:1px solid var(--border,#d5dde1);background:var(--surface,#fff);color:var(--c-primary,#1d2a30);border-radius:999px;padding:4px 12px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}',
    '.fbl-pill:hover{border-color:var(--link,#2d9cdb)}',
    '.fbl-pill.on{background:#e3f1fb;border-color:var(--link,#2d9cdb);color:#1a6fa3;font-weight:600}',
    '.fbl-pill .fbl-my{font-size:10px;font-weight:700;color:#2f7d4f;margin-right:5px;text-transform:uppercase;letter-spacing:.03em}',
    '.fbl-pill-sep{width:1px;height:18px;background:var(--border,#d5dde1);margin:0 2px}',
    '.fbl-editbtn{font-size:12px}',
    '.fbl-ed{border:1px solid var(--border,#d5dde1);border-radius:8px;background:var(--surface,#fff);padding:10px 12px;margin-top:8px;box-shadow:0 4px 14px rgba(0,0,0,.08)}',
    '.fbl-ed.hidden{display:none}',
    '.fbl-ed-grid{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:flex-start}',
    '.fbl-ed-grp{display:flex;flex-direction:column;gap:5px}',
    '.fbl-ed-grp>b{font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--c-secondary,#6b7b83)}',
    '.fbl-ed-row{display:flex;gap:6px;align-items:center;font-size:12px}',
    '.fbl-ed-row label{display:flex;flex-direction:column;font-size:11px;color:var(--c-secondary,#6b7b83);gap:2px}',
    '.fbl-ed input[type=text]{width:64px;padding:3px 6px;font:inherit;font-size:12px;border:1px solid var(--border,#d5dde1);border-radius:5px}',
    '.fbl-ed input.fbl-name{width:200px}',
    '.fbl-ed select{padding:3px 4px;font:inherit;font-size:12px;border:1px solid var(--border,#d5dde1);border-radius:5px}',
    '.fbl-ed-info{font-size:12px;color:#415157;margin-top:8px}',
    '.fbl-ed-info.err{color:#8A1E30}',
    '.fbl-ed-foot{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;align-items:center}',
    '.fbl-ed-foot .sp{flex:1}',
    '.fbl-fe{border-collapse:collapse;font-size:12px;width:100%}',
    '.fbl-fe th{font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;color:var(--c-secondary,#6b7b83);text-align:left;padding:3px 4px;font-weight:600}',
    '.fbl-fe td{padding:3px 4px;border-top:1px solid #eef1f2;vertical-align:middle}',
    '.fbl-fe tr.fbl-off td:not(:first-child){opacity:.45}',
    '.fbl-fe select{padding:2px 3px;font:inherit;font-size:12px;border:1px solid var(--border,#d5dde1);border-radius:4px}',
    '.fbl-fe-name{font-weight:600;white-space:nowrap}',
    '.fbl-na{color:#b0bbc0}',
    '.fbl-seg{display:inline-flex;border:1px solid var(--border,#d5dde1);border-radius:5px;overflow:hidden}',
    '.fbl-seg button{border:0;background:#fff;padding:2px 4px;cursor:pointer;color:#6b7b83;display:flex}',
    '.fbl-seg button+button{border-left:1px solid var(--border,#d5dde1)}',
    '.fbl-seg button.on{background:#e3f1fb;color:#1a6fa3}',
    '.fbl-fe-mv{white-space:nowrap}',
    '.fbl-fe-mv button{border:1px solid var(--border,#d5dde1);background:#fff;border-radius:4px;font-size:9px;padding:2px 4px;cursor:pointer;color:#6b7b83}',
    '.fbl-fe-mv button:disabled{opacity:.3;cursor:default}',
    '.fbl-figs{display:flex;flex-direction:column;align-items:center;gap:6px}',
    '.fbl-figs-page{width:max-content;min-width:100%;margin:0 auto}',
    '.fbl-figs-wrap{flex-direction:row;flex-wrap:wrap;justify-content:center;gap:14px}',
    '.fbl-fig{margin:0;display:flex;flex-direction:column;align-items:center;gap:4px}',
    '.fbl-fig figcaption{font-size:11px;color:var(--c-secondary,#6b7b83)}',
    '.fbl-frame{position:relative;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.25);background:#fff}',
    '.fbl-scaler{transform-origin:0 0;position:absolute;left:0;top:0}',
    '.fbl-ed-src{font-size:12px;color:#1a6fa3;background:#eef6fc;border:1px solid #cbe5fb;border-radius:6px;padding:6px 9px;margin-bottom:8px}',
    '.fbl-ed-src.hidden{display:none}',
    '.fbl-drop{position:fixed;inset:0;z-index:10040;display:none;align-items:center;justify-content:center;background:rgba(45,156,219,.12);pointer-events:none}',
    '.fbl-drop.on{display:flex}',
    '.fbl-drop>div{border:2px dashed #2d9cdb;border-radius:12px;background:#fff;padding:22px 30px;font-size:14px;color:#1a6fa3;font-weight:600;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.12)}',
    '.fbl-drop small{display:block;font-weight:400;color:#6b7b83;margin-top:4px;font-size:12px}',
    '.fbl-msg{font-size:12.5px;color:var(--c-secondary,#6b7b83);text-align:center;padding:10px}',
    '.fbl-msg-err{color:#8A1E30}'
  ].join('\n');

  /**
   * The row of sheet-setup pills, and the editor behind "Sheet setup".
   * @param {object} o - { mount, editMount (where the editor opens; default after the bar), selected (id),
   *   units ('in' | 'mm'), onSelect(stock), onDraft(stock | null) (live preview while editing),
   *   onMessage(text, kind), drop (default true: a Word label template dropped anywhere on the
   *   page opens in the editor as a new setup; false: only the editor's button),
   *   filter(stock) (only the setups that suit this report get a pill, e.g. one label per page;
   *   the setups are still shared by every label report), filterNote (the editor's hint when a
   *   draft doesn't pass the filter) }
   * @returns {{ current(), select(id), refresh(), units(u), editing(), importWord(file) }}
   */
  function stockBar(o) {
    injectCss();
    var host = typeof o.mount === 'string' ? document.getElementById(o.mount) : o.mount;
    var units = o.units === 'mm' ? 'mm' : 'in';
    var all = [], cur = null, draft = null, editing = null, timer = null;
    var bar = document.createElement('div'); bar.className = 'fbl-bar';
    var ed = document.createElement('div'); ed.className = 'fbl-ed hidden';
    host.appendChild(bar);
    (o.editMount ? (typeof o.editMount === 'string' ? document.getElementById(o.editMount) : o.editMount) : host).appendChild(ed);

    function sizeText(s, withPer) {
      var g = geometry(s), f = UNITS[units], d = units === 'mm' ? 1 : 2;
      return (g.lw / f).toFixed(d) + ' × ' + (g.lh / f).toFixed(d) + ' ' + units + (withPer ? ', ' + g.per + ' per sheet' : '');
    }
    function drawBar() {
      var shared = all.filter(function (s) { return s.origin !== 'mine'; }), mine = all.filter(function (s) { return s.origin === 'mine'; });
      var pill = function (s) {
        return '<button type="button" class="fbl-pill' + (cur && cur.id === s.id ? ' on' : '') + '" data-id="' + esc(s.id) + '" title="' +
          esc((s.note ? s.note + '\n' : '') + sizeText(s, true) + (s.origin === 'mine' ? '\nYour own setup' : s.origin === 'company' ? '\nYour company\'s setup' : '')) + '">' +
          (s.origin === 'mine' ? '<span class="fbl-my">My</span>' : '') + esc(s.name) + '</button>';
      };
      bar.innerHTML = '<div class="fbl-pills">' + shared.map(pill).join('') + (mine.length ? '<span class="fbl-pill-sep"></span>' + mine.map(pill).join('') : '') + '</div>' +
        '<button type="button" class="hdr-btn fbl-editbtn" data-edit="1" title="Change this sheet\'s margins, gaps and label count, or make a new setup">' +
        '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="14" height="14"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 00-3-3L5 17v3z"/></svg> Sheet setup</button>' +
        '<button type="button" class="hdr-btn fbl-editbtn" data-word="1" title="Make a setup from a Word label template (Avery and the like, .doc or .docx). You can also drop the file anywhere on this page.">' +
        '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="14" height="14"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M12 17v-6M9 14l3 3 3-3"/></svg> From a Word template</button>';
    }
    // The Word template button's file picker (one per bar).
    var picker = document.createElement('input');
    picker.type = 'file'; picker.accept = '.doc,.docx,.dot,.dotx'; picker.style.display = 'none';
    host.appendChild(picker);
    picker.addEventListener('change', function () { var f = picker.files && picker.files[0]; picker.value = ''; if (f) importWord(f); });
    bar.addEventListener('click', function (e) {
      var p = e.target.closest('[data-id]');
      if (p) { select(p.dataset.id, true); return; }
      if (e.target.closest('[data-word]')) { picker.click(); return; }
      if (e.target.closest('[data-edit]')) { if (ed.classList.contains('hidden')) openEditor(cur); else closeEditor(); }
    });

    // ---- a Word label template -> a new setup in the editor ----
    function say(text, kind) { if (o.onMessage) o.onMessage(text, kind); else log(text, kind); }
    function importWord(file) {
      if (!file) return Promise.resolve(null);
      if (!/\.(docx?|dotx?)$/i.test(file.name || '')) { say('"' + (file.name || 'That file') + '" isn\'t a Word file: drop a .doc or .docx label template.', 'error'); return Promise.resolve(null); }
      return file.arrayBuffer().then(function (b) { return Word.read(b, file.name); }).then(function (r) {
        var s = Object.assign(normStock(r.stock), { id: null, origin: 'new', note: r.stock.note });
        openEditor(s);
        var src = ed.querySelector('[data-src]'), f = UNITS[units], d = units === 'mm' ? 1 : 2;
        src.textContent = 'Read from ' + file.name + ': ' + s.cols + ' × ' + s.rows + ' labels of ' + (r.label.w / f).toFixed(d) + ' × ' + (r.label.h / f).toFixed(d) + ' ' + units +
          ' on ' + paperOf(s).size + '. Check it with a Test sheet, then save it.' + (r.warnings.length ? ' Note: ' + r.warnings.join('; ') + '.' : '');
        src.classList.remove('hidden');
        say('Read the label template ' + file.name + '.', 'success');
        return s;
      }).catch(function (e) {
        say('That label template couldn\'t be read: ' + (e && e.message || e) + '.', 'error');
        return null;
      });
    }
    // Dropping a file anywhere on the page (while one is dragged over it, a hint shows).
    if (o.drop !== false && typeof document !== 'undefined' && !document.__fblDrop) {
      document.__fblDrop = true;
      var hint = document.createElement('div');
      hint.className = 'fbl-drop';
      hint.innerHTML = '<div>Drop a Word label template here<small>An Avery .doc or .docx: it becomes a new sheet setup.</small></div>';
      document.body.appendChild(hint);
      var depth = 0;
      var hasFiles = function (e) { var t = e.dataTransfer && e.dataTransfer.types; return !!t && Array.prototype.indexOf.call(t, 'Files') >= 0; };
      document.addEventListener('dragenter', function (e) { if (!hasFiles(e)) return; depth++; hint.classList.add('on'); });
      document.addEventListener('dragleave', function (e) { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) hint.classList.remove('on'); });
      document.addEventListener('dragover', function (e) { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
      document.addEventListener('drop', function (e) {
        if (!hasFiles(e)) return;
        e.preventDefault(); depth = 0; hint.classList.remove('on');
        var f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) importWord(f);
      });
    }
    function select(id, user) {
      var s = null;
      all.forEach(function (x) { if (x.id === id) s = x; });
      if (!s) s = all[0] || null;
      cur = s;
      drawBar();
      if (!ed.classList.contains('hidden')) openEditor(cur);
      if (o.onSelect && s) o.onSelect(clone(s), !!user);
    }
    function refresh(fresh) {
      all = Stocks.list(fresh);
      if (typeof o.filter === 'function') all = all.filter(function (s) { try { return !!o.filter(s); } catch (_) { return true; } });
    }

    // ---- editor ----
    var LEN = [['mt', 'Top'], ['mb', 'Bottom'], ['ml', 'Left'], ['mr', 'Right']];
    function v(pt) { var f = UNITS[units]; return String(Math.round(pt / f * 1000) / 1000); }
    function openEditor(s) {
      editing = clone(s); draft = clone(s);
      var p = paperOf(s), admin = isAdmin(), mine = s.origin === 'mine', co = s.origin === 'company', std = s.origin === 'standard', fresh = s.origin === 'new';
      var inp = function (k, label) { return '<label>' + label + '<input type="text" inputmode="decimal" data-len="' + k + '" value="' + v(s[k]) + '"></label>'; };
      ed.innerHTML =
        '<div class="fbl-ed-src hidden" data-src></div>' +
        '<div class="fbl-ed-grid">' +
          '<div class="fbl-ed-grp"><b>Name</b><input type="text" class="fbl-name" data-k="name" value="' + esc(mine || co || fresh ? s.name : s.name + ' (copy)') + '" maxlength="60">' +
            '<div class="fbl-ed-row"><label>Units<select data-k="units">' + ['in', 'mm'].map(function (u) { return '<option value="' + u + '"' + (u === units ? ' selected' : '') + '>' + (u === 'in' ? 'inches' : 'mm') + '</option>'; }).join('') + '</select></label></div></div>' +
          '<div class="fbl-ed-grp"><b>Paper</b><div class="fbl-ed-row">' +
            '<label>Size<select data-k="paper">' + Object.keys(PAPERS).concat(['Custom']).map(function (n) { return '<option' + (n === p.size ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
            '<label>Orientation<select data-k="orient"><option value="portrait"' + (p.orientation === 'portrait' ? ' selected' : '') + '>Portrait</option><option value="landscape"' + (p.orientation === 'landscape' ? ' selected' : '') + '>Landscape</option></select></label></div>' +
            '<div class="fbl-ed-row">' + inp('w', 'Width') + inp('h', 'Height') + '</div></div>' +
          '<div class="fbl-ed-grp"><b>Labels</b><div class="fbl-ed-row">' +
            '<label>Across<input type="text" inputmode="numeric" data-int="cols" value="' + s.cols + '"></label>' +
            '<label>Down<input type="text" inputmode="numeric" data-int="rows" value="' + s.rows + '"></label></div>' +
            '<div class="fbl-ed-row">' + inp('pad', 'Inside margin') + '</div></div>' +
          '<div class="fbl-ed-grp"><b>Page margins</b><div class="fbl-ed-row">' + LEN.map(function (l) { return inp(l[0], l[1]); }).join('') + '</div></div>' +
          '<div class="fbl-ed-grp"><b>Gaps between labels</b><div class="fbl-ed-row">' + inp('gx', 'Across') + inp('gy', 'Down') + '</div></div>' +
        '</div>' +
        '<div class="fbl-ed-info" data-info></div>' +
        '<div class="fbl-ed-foot">' +
          '<button type="button" class="ds-btn ds-btn-primary" data-act="mine">' + (mine ? 'Save' : 'Save as my setup') + '</button>' +
          (mine ? '<button type="button" class="ds-btn" data-act="mineNew">Save as new</button>' : '') +
          (admin ? '<button type="button" class="ds-btn ds-btn-admin" data-act="publish" title="Every user of every label report sees it">' + (co ? 'Save for everyone' : 'Add for everyone') + '</button>' : '') +
          (mine ? '<button type="button" class="ds-btn" data-act="delMine">Delete</button>' : '') +
          (admin && co ? '<button type="button" class="ds-btn" data-act="remove">Delete for everyone</button>' : '') +
          (admin && std ? '<button type="button" class="ds-btn" data-act="remove" title="Hide this standard setup from every user">Hide for everyone</button>' : '') +
          (admin && Stocks.hiddenCount() ? '<button type="button" class="ds-btn" data-act="unhide">Show hidden standard setups</button>' : '') +
          '<span class="sp"></span><button type="button" class="ds-btn" data-act="cancel">Close</button>' +
        '</div>';
      ed.classList.remove('hidden');
      ed.querySelector('[data-k="paper"]').dataset.prev = p.size;
      syncPaper(); info();
    }
    function closeEditor() {
      ed.classList.add('hidden'); editing = null; draft = null;
      if (o.onDraft) o.onDraft(null);
    }
    // Paper sizes fill width / height; Custom lets them be typed.
    function syncPaper() {
      var size = ed.querySelector('[data-k="paper"]').value, custom = size === 'Custom';
      ed.querySelectorAll('[data-len="w"],[data-len="h"]').forEach(function (i) { i.disabled = !custom; });
    }
    function readDraft() {
      var d = clone(editing), f = UNITS[units];
      ed.querySelectorAll('[data-len]').forEach(function (i) { d[i.dataset.len] = Math.max(0, num(i.value, 0)) * f; });
      ed.querySelectorAll('[data-int]').forEach(function (i) { d[i.dataset.int] = Math.round(num(i.value, 1)); });
      d.name = ed.querySelector('[data-k="name"]').value.trim() || 'Untitled';
      var size = ed.querySelector('[data-k="paper"]').value, landscape = ed.querySelector('[data-k="orient"]').value === 'landscape';
      if (PAPERS[size]) { var pp = PAPERS[size]; d.w = landscape ? pp[1] : pp[0]; d.h = landscape ? pp[0] : pp[1]; }
      else if ((d.w > d.h) !== landscape) { var t = d.w; d.w = d.h; d.h = t; }
      return normStock(d);
    }
    function info() {
      draft = readDraft();
      var g = geometry(draft), el = ed.querySelector('[data-info]');
      el.classList.toggle('err', !g.ok);
      var suits = typeof o.filter !== 'function' || !!o.filter(draft);
      el.textContent = (g.ok ? 'Each label is ' + sizeText(draft) + '; ' + g.per + ' per sheet. The preview shows this setup while the editor is open.'
                             : 'The labels have no room: make the margins or gaps smaller, or fewer labels across or down.') +
        (g.ok && !suits ? ' ' + (o.filterNote || 'This report doesn\'t print on this setup: it won\'t get a pill here (other label reports can use it).') : '');
      ed.querySelectorAll('[data-act="mine"],[data-act="mineNew"],[data-act="publish"]').forEach(function (b) { b.disabled = !g.ok; });
      if (o.onDraft) o.onDraft(clone(Object.assign({}, draft, { id: editing.id, origin: editing.origin })));
    }
    ed.addEventListener('input', function (e) {
      if (e.target.dataset.k === 'name') return;
      clearTimeout(timer); timer = setTimeout(info, 200);
    });
    ed.addEventListener('change', function (e) {
      var k = e.target.dataset.k;
      if (k === 'units') {
        // Re-show the typed lengths in the new unit.
        var d = readDraft(); units = e.target.value;
        ed.querySelectorAll('[data-len]').forEach(function (i) { i.value = v(d[i.dataset.len]); });
        drawBar();
        if (o.onUnits) o.onUnits(units);
        return;
      }
      if (k === 'paper') {
        var sel = e.target;
        if (sel.value === 'Custom') {
          var dd = readDraft();
          ed.querySelector('[data-len="w"]').value = v(dd.w); ed.querySelector('[data-len="h"]').value = v(dd.h);
        }
        syncPaper();
      }
      if (k === 'orient' && ed.querySelector('[data-k="paper"]').value === 'Custom') {
        var w = ed.querySelector('[data-len="w"]'), h = ed.querySelector('[data-len="h"]'), lw = num(w.value, 0), lh = num(h.value, 0);
        var land = e.target.value === 'landscape';
        if ((lw > lh) !== land) { w.value = String(lh); h.value = String(lw); }
      }
      if (k !== 'name') info();
    });
    ed.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.dataset.act, d = readDraft(), id = null, ok = true, msg = '';
      if (act === 'cancel') { closeEditor(); return; }
      if (act === 'mine' || act === 'mineNew') {
        if (act === 'mineNew' || editing.origin !== 'mine') delete d.id; else d.id = editing.id;
        if (act === 'mineNew' && d.name === editing.name) d.name += ' (copy)';
        id = Stocks.saveMine(d); ok = !!id; msg = ok ? 'Saved as your setup.' : 'That didn\'t save.';
      } else if (act === 'publish') {
        if (editing.origin === 'company') d.id = editing.id; else delete d.id;
        if (!global.confirm('Make "' + d.name + '" a sheet setup for everyone, in every label report?')) return;
        id = Stocks.publish(d); ok = !!id; msg = ok ? 'Everyone can use it now.' : 'That didn\'t save.';
      } else if (act === 'delMine') {
        if (!global.confirm('Delete your setup "' + editing.name + '"?')) return;
        ok = Stocks.deleteMine(editing.id); msg = ok ? 'Deleted.' : 'That didn\'t save.';
      } else if (act === 'remove') {
        var std = editing.origin === 'standard';
        if (!global.confirm((std ? 'Hide' : 'Delete') + ' "' + editing.name + '" for everyone, in every label report?')) return;
        ok = Stocks.remove(editing.id); msg = ok ? (std ? 'Hidden for everyone.' : 'Deleted for everyone.') : 'That didn\'t save.';
      } else if (act === 'unhide') {
        ok = Stocks.unhideAll(); msg = ok ? 'Every standard setup shows again.' : 'That didn\'t save.';
      }
      if (o.onMessage) o.onMessage(msg, ok ? 'success' : 'error');
      if (!ok) return;
      refresh(true);
      closeEditor();
      select(id || (act === 'unhide' ? cur && cur.id : (all[0] && all[0].id)), true);
    });

    refresh(false);
    select(o.selected, false);
    return {
      current: function () { return clone(cur); },
      select: function (id) { select(id, false); },
      refresh: function () { var id = cur && cur.id; refresh(true); select(id, false); },
      units: function () { return units; },
      editing: function () { return !ed.classList.contains('hidden'); },
      importWord: importWord
    };
  }
  FBLabel.stockBar = stockBar;
})(typeof window !== 'undefined' ? window : this);
