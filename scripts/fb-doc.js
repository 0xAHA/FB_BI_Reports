/*
 fb-doc.js  —  Printable-document engine for Fishbowl BI reports (namespace: FBDoc).
 Shared Script "fb-doc". Reports load it with its own Script directive, after
 fb-lib, and the Open Sans faces with the "fb-doc-fonts" Style directive
 (scripts/fb-doc-fonts.css, generated: see Other_NOT_FOR_PRODUCTION/Paperwork_POC
 /tools/build_fonts.py). Deploy fb-styles, fb-lib, fb-doc + fb-doc-fonts, then
 the reports.

 Promoted from the Paperwork proof of concept (Other_NOT_FOR_PRODUCTION/
 Paperwork_POC, which still carries its own copy). Changes since: the first
 sheet's page header may differ in height from the rest; print rules apply only
 while body has the class fbdoc-on; and FBDoc.Report (end of file), the
 paginated "PDF view" of the iReport ports with its App / PDF toggle.

 Replaces JasperReports output with HTML that prints and saves as PDF from the
 BI Report module's own Print / Save / Email buttons. The page IS the paper, so
 the engine lays the document out into fixed-size sheets itself:

   FBDoc.param        read a Fishbowl report-setting value (substituted into the
                      page before it loads), with a fallback when unsubstituted
   FBDoc.page         paper size from the PRINT setting (name or CSS form)
   FBDoc.fmt          Java DecimalFormat / SimpleDateFormat ports, currency glyphs
   FBDoc.Columns      shared column catalogue + fit(): hidden columns' width is
                      redistributed, the table always spans the content width
   FBDoc.layout       PURE page-break algorithm over measured heights (Node-testable)
   FBDoc.paginate     measure -> layout -> assemble sheets -> verify (self-heal)
   FBDoc.code128      Code 128-B barcode as SVG (no library)
   FBDoc.q / sys / presets / company   Fishbowl data helpers (bind parameters)
   FBDoc.picker       typeahead record picker

 Jasper band semantics reproduced by paginate():
   pageHeader      every sheet            pageFooter      every sheet but the last
   lastPageFooter  last sheet, pinned to the bottom (moves to its own sheet, with
                   the page header, when it does not fit)
   blocks          flow blocks and table rows; a table's column header repeats on
                   every sheet it reaches; keepWithNext / keepWithPrevious; group
                   headers re-shown "(continued)"; long text splits by line
   pageNo / pageCount placeholders filled after layout ("Page X of Y")

 NOTE: Fishbowl substitutes report-setting tokens and Script/Style directives by
 global text replacement. This file must never contain either literal (a dollar
 sign + upper-case code + opening brace, or a brace-percent pair). Refer to them in
 words only; tests/unit.test.js lints for it.
*/
(function (global) {
  'use strict';

  var FBDoc = {};
  FBDoc.BUILD = '2026.10.12-71495a8';   // @fb-build
  FBDoc.VERSION = FBDoc.BUILD;

  // ===================================================================
  //  Logging (defaults to FBLib's debug drawer when present)
  // ===================================================================
  var _logger = null;
  function log(msg, type) {
    msg = String(msg);
    if (msg.length > 600) msg = msg.slice(0, 600) + '… (' + msg.length + ' chars)';
    try {
      if (_logger) return _logger(msg, type || 'info');
      if (global.FBLib && global.FBLib.Common && global.FBLib.Common.debugLog) {
        global.FBLib.Common.debugLog('[FBDoc] ' + msg, type || 'info');
      }
    } catch (_) {}
  }
  FBDoc.setLogger = function (fn) { _logger = typeof fn === 'function' ? fn : null; };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  FBDoc.esc = esc;
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

  // ===================================================================
  //  Report settings
  //  A Fishbowl report setting is written in the page as a token: a dollar
  //  sign, an upper-case code, then "{Title|default|Group}". Fishbowl replaces
  //  the token with the chosen value before the page loads (the editor preview
  //  substitutes the default). Unsubstituted (e.g. a local test harness), the
  //  token's own default is used, else the fallback.
  // ===================================================================
  var TOKEN_RE = /^\x24[A-Z][A-Z0-9_]*\{([^}|]*)(?:\|([^}|]*))?(?:\|[^}]*)?\}$/;
  function param(v, fallback) {
    if (v == null) return fallback;
    var s = String(v).trim();
    if (s === '') return fallback;
    var m = TOKEN_RE.exec(s);
    if (m) return (m[2] != null && m[2] !== '') ? m[2] : fallback;
    return s;
  }
  // Settings are placed in <script type="text/plain" id="…"> blocks, so a
  // substituted value containing quotes or newlines can never break the JS.
  param.fromEl = function (id, fallback) {
    var el = (typeof document !== 'undefined') ? document.getElementById(id) : null;
    return param(el ? el.textContent : null, fallback);
  };
  param.isToken = function (v) { return TOKEN_RE.test(String(v == null ? '' : v).trim()); };
  param.bool = function (v, fallback) {
    var s = param(v, null);
    if (s == null) return !!fallback;
    s = String(s).toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
    return !!fallback;
  };
  param.int = function (v, fallback) {
    var n = parseInt(param(v, ''), 10);
    return isNaN(n) ? fallback : n;
  };
  FBDoc.param = param;

  // ===================================================================
  //  Page model
  // ===================================================================
  var PX_PER_MM = 96 / 25.4, PX_PER_PT = 96 / 72, PT_PER_MM = 72 / 25.4;
  var SIZES = {   // portrait, mm
    A3: [297, 420], A4: [210, 297], A5: [148, 210],
    B3: [353, 500], B4: [250, 353], B5: [176, 250],
    LETTER: [215.9, 279.4], LEGAL: [215.9, 355.6], TABLOID: [279.4, 431.8], LEDGER: [279.4, 431.8],
    EXECUTIVE: [184.15, 266.7]
  };
  // Jasper SOReport margins: top/bottom 20pt, left/right 30pt.
  var JASPER_MARGIN_MM = { t: 20 / PT_PER_MM, r: 30 / PT_PER_MM, b: 20 / PT_PER_MM, l: 30 / PT_PER_MM };

  function lengthMm(tok) {
    var m = /^(-?\d*\.?\d+)\s*(mm|cm|in|pt|px|pc)?$/i.exec(String(tok).trim());
    if (!m) return null;
    var v = parseFloat(m[1]), u = (m[2] || 'mm').toLowerCase();
    var mm = u === 'mm' ? v : u === 'cm' ? v * 10 : u === 'in' ? v * 25.4 : u === 'pt' ? v / PT_PER_MM
      : u === 'pc' ? v * 12 / PT_PER_MM : v / PX_PER_MM;
    return Math.round(mm * 10000) / 10000;
  }
  function boxMm(tokens) {
    var v = tokens.map(lengthMm);
    if (!v.length || v.some(function (x) { return x == null || x < 0; })) return null;
    if (v.length === 1) return { t: v[0], r: v[0], b: v[0], l: v[0] };
    if (v.length === 2) return { t: v[0], r: v[1], b: v[0], l: v[1] };
    if (v.length === 3) return { t: v[0], r: v[1], b: v[2], l: v[1] };
    return { t: v[0], r: v[1], b: v[2], l: v[3] };
  }

  /**
   * PRINT setting text -> PageSpec. Accepts a size name ("A4", "Letter",
   * "A4 landscape", "Letter:landscape"), CSS declarations ("size: 8.5in 11in
   * portrait; margin: 1in;", optionally wrapped in @page{}), or "216 x 279 mm".
   * Unsubstituted / unrecognised -> opts.fallback (default A4) + Jasper margins.
   */
  function resolvePage(raw, opts) {
    opts = opts || {};
    var warnings = [];
    var spec = { name: null, wMm: 0, hMm: 0, orientation: 'portrait', margin: null, source: 'default', raw: raw == null ? null : String(raw), warnings: warnings };
    var s = param(raw, '');
    s = String(s || '').replace(/@page\s*\{/i, '').replace(/\}\s*$/, '').trim();

    function setNamed(name, orient) {
      var k = String(name).toUpperCase();
      if (!SIZES[k]) return false;
      spec.name = k === 'LETTER' ? 'Letter' : k === 'LEGAL' ? 'Legal' : k === 'TABLOID' ? 'Tabloid' : k === 'LEDGER' ? 'Ledger' : k === 'EXECUTIVE' ? 'Executive' : k;
      spec.wMm = SIZES[k][0]; spec.hMm = SIZES[k][1];
      if (k === 'LEDGER') orient = orient || 'landscape';
      if (orient) spec.orientation = orient.toLowerCase();
      return true;
    }

    var ok = false;
    if (s) {
      if (/[:;]/.test(s) && /(size|margin)\s*:/i.test(s)) {
        // CSS declarations
        s.split(';').forEach(function (decl) {
          var p = decl.split(':'); if (p.length < 2) return;
          var prop = p[0].trim().toLowerCase(), val = p.slice(1).join(':').trim();
          var toks = val.split(/\s+/).filter(Boolean);
          if (prop === 'size') {
            var orient = null, lens = [];
            toks.forEach(function (t) {
              if (/^(portrait|landscape)$/i.test(t)) orient = t.toLowerCase();
              else if (SIZES[t.toUpperCase()]) ok = setNamed(t, orient) || ok;
              else lens.push(t);
            });
            if (lens.length === 2) {
              var w = lengthMm(lens[0]), h = lengthMm(lens[1]);
              if (w && h) { spec.wMm = w; spec.hMm = h; ok = true; spec.name = null; }
            } else if (lens.length === 1 && lengthMm(lens[0])) {
              spec.wMm = spec.hMm = lengthMm(lens[0]); ok = true;
            }
            if (orient) spec.orientation = orient;
          } else if (prop === 'margin') {
            var b = boxMm(toks); if (b) spec.margin = b; else warnings.push('bad margin: ' + val);
          } else if (/^margin-(top|right|bottom|left)$/.test(prop)) {
            var v = lengthMm(toks[0]); if (v == null) return;
            spec.margin = spec.margin || Object.assign({}, JASPER_MARGIN_MM);
            spec.margin[prop.charAt(7)] = v;
          }
        });
      } else {
        var m1 = /^([A-Za-z0-9]+)(?:\s*[:\s]\s*(portrait|landscape))?$/i.exec(s);
        var m2 = /^(\d*\.?\d+)\s*[x×]\s*(\d*\.?\d+)\s*(mm|cm|in|pt)?$/i.exec(s);
        if (m1) ok = setNamed(m1[1], m1[2]);
        else if (m2) {
          var u = m2[3] || 'mm';
          spec.wMm = lengthMm(m2[1] + u); spec.hMm = lengthMm(m2[2] + u); ok = !!(spec.wMm && spec.hMm);
        }
      }
    }
    if (ok) spec.source = 'setting';
    else {
      if (s) warnings.push('unrecognised page setting "' + s + '" — using ' + (opts.fallback || 'A4'));
      setNamed(opts.fallback || 'A4', opts.orientation || null);
      if (!SIZES[String(opts.fallback || 'A4').toUpperCase()]) setNamed('A4');
    }
    // Explicit dimensions define the orientation; a named size is flipped to match.
    var landscape = spec.orientation === 'landscape';
    if ((landscape && spec.wMm < spec.hMm) || (!landscape && spec.wMm > spec.hMm && spec.name)) {
      var t = spec.wMm; spec.wMm = spec.hMm; spec.hMm = t;
    }
    if (spec.wMm > spec.hMm) spec.orientation = 'landscape';
    if (spec.wMm < 50 || spec.hMm < 50 || spec.wMm > 1500 || spec.hMm > 1500) {
      warnings.push('page size out of range — using A4'); setNamed('A4'); spec.orientation = 'portrait';
    }
    if (!spec.margin || opts.margin === 'document') spec.margin = Object.assign({}, opts.documentMargin || JASPER_MARGIN_MM);
    ['t', 'r', 'b', 'l'].forEach(function (k) {
      spec.margin[k] = Math.max(0, Math.min(spec.margin[k], (k === 't' || k === 'b' ? spec.hMm : spec.wMm) / 3));
    });
    return spec;
  }

  // The BI Report module's Print / Save-PDF / Email path ignores a CSS
  // "@page { margin: 0 }" and applies Chromium's default 0.4in print margins,
  // then shrinks anything wider than the printable area to fit (measured in the
  // client 2026-10-08: a full-bleed A4 sheet printed at 90.3%). So each sheet
  // is sized to the PRINTABLE area (paper minus this inset), and @page declares
  // the same margin explicitly, so paths that honour CSS and paths that don't
  // both print at 100%. The document's own margins become the sheet padding
  // beyond the inset (a margin smaller than the inset is the inset).
  var PRINT_INSET_MM = 0.4 * 25.4;

  // PageSpec -> pixel geometry. paperW/paperH = the whole sheet of paper (screen
  // preview frame); W/H = the printable sheet. H is floored to Chromium's layout
  // unit (1/64 px) and shortened by `shortPx`, so accumulated rounding can never
  // push a sheet onto an extra (blank) printed page.
  function geometry(spec, opts) {
    opts = opts || {};
    var floor64 = function (px) { return Math.floor(px * 64) / 64; };
    var insetMm = opts.printInsetMm != null ? opts.printInsetMm : PRINT_INSET_MM;
    var inset = insetMm * PX_PER_MM;
    var paperW = floor64(spec.wMm * PX_PER_MM), paperH = floor64(spec.hMm * PX_PER_MM);
    var W = floor64(paperW - 2 * inset);
    var H = floor64(paperH - 2 * inset) - (opts.shortPx == null ? 2 : opts.shortPx);
    var pad = {
      t: Math.max(0, spec.margin.t * PX_PER_MM - inset), r: Math.max(0, spec.margin.r * PX_PER_MM - inset),
      b: Math.max(0, spec.margin.b * PX_PER_MM - inset), l: Math.max(0, spec.margin.l * PX_PER_MM - inset)
    };
    return {
      spec: spec, W: W, H: H, pad: pad, paperW: paperW, paperH: paperH, inset: inset, insetMm: insetMm,
      CW: W - pad.l - pad.r, innerH: H - pad.t - pad.b,
      CWpt: (W - pad.l - pad.r) / PX_PER_PT
    };
  }

  FBDoc.page = { resolve: resolvePage, geometry: geometry, SIZES: SIZES, JASPER_MARGIN_MM: JASPER_MARGIN_MM, PRINT_INSET_MM: PRINT_INSET_MM };
  FBDoc.units = { PX_PER_MM: PX_PER_MM, PX_PER_PT: PX_PER_PT, PT_PER_MM: PT_PER_MM };

  // ===================================================================
  //  Formatting — Java DecimalFormat / SimpleDateFormat subsets
  // ===================================================================
  function parseJavaPattern(pattern) {
    // Split positive;negative on an unquoted ';'.
    var parts = [], cur = '', q = false;
    for (var i = 0; i < pattern.length; i++) {
      var c = pattern.charAt(i);
      if (c === "'") { q = !q; cur += c; continue; }
      if (c === ';' && !q) { parts.push(cur); cur = ''; continue; }
      cur += c;
    }
    parts.push(cur);
    function sub(p) {
      var prefix = '', numberPart = '', suffix = '', state = 0, quoted = false;
      for (var j = 0; j < p.length; j++) {
        var ch = p.charAt(j);
        if (ch === "'") {
          if (p.charAt(j + 1) === "'") { (state === 0 ? (prefix += "'") : state === 2 ? (suffix += "'") : null); j++; continue; }
          quoted = !quoted; continue;
        }
        var isNum = !quoted && /[#0,.]/.test(ch);
        if (state === 0 && isNum) state = 1;
        if (state === 1 && !isNum) state = 2;
        if (state === 0) prefix += quoted ? ch : ch.replace('¤', '\u0000C');
        else if (state === 1) numberPart += ch;
        else suffix += quoted ? ch : ch.replace('¤', '\u0000C');
      }
      return { prefix: prefix, numberPart: numberPart, suffix: suffix };
    }
    var pos = sub(parts[0]);
    var np = pos.numberPart, dot = np.indexOf('.');
    var intPart = dot >= 0 ? np.slice(0, dot) : np, frac = dot >= 0 ? np.slice(dot + 1) : '';
    var lastComma = intPart.lastIndexOf(',');
    var spec = {
      pos: pos, neg: parts.length > 1 ? sub(parts[1]) : null,
      minInt: (intPart.match(/0/g) || []).length,
      grouping: lastComma >= 0 ? intPart.length - lastComma - 1 : 0,
      minFrac: (frac.match(/0/g) || []).length,
      maxFrac: (frac.match(/[0#]/g) || []).length,
      percent: /%/.test(pos.prefix + pos.suffix) ? 100 : /‰/.test(pos.prefix + pos.suffix) ? 1000 : 1
    };
    return spec;
  }
  var _patCache = {};

  /**
   * Format like java.text.DecimalFormat(pattern).format(value).
   * opts.symbol    replaces the literal '$' (Fishbowl's currency placeholder in
   *                REPORT_DECIMAL_* patterns) and '¤'. '' strips it.
   * opts.rounding  'halfEven' (DecimalFormat default) | 'halfUp' (Fishbowl's
   *                CurrencySymbolConst.getFormattedCurrency uses HALF_UP).
   */
  function fmtNumber(pattern, value, opts) {
    opts = opts || {};
    if (value == null || value === '' || isNaN(Number(value))) return '';
    var spec = _patCache[pattern] || (_patCache[pattern] = parseJavaPattern(String(pattern || '#,##0.##')));
    var v = Number(value) * spec.percent;
    var neg = v < 0 || (v === 0 && 1 / v < 0);
    var mode = opts.rounding === 'halfUp' ? 'halfExpand' : 'halfEven';
    var digits;
    try {
      digits = new Intl.NumberFormat('en-US', {
        useGrouping: false, minimumFractionDigits: spec.minFrac, maximumFractionDigits: spec.maxFrac,
        minimumIntegerDigits: Math.max(1, spec.minInt), roundingMode: mode
      }).format(Math.abs(v));
    } catch (_) {
      digits = Math.abs(v).toFixed(spec.maxFrac);
      if (spec.maxFrac > spec.minFrac) digits = digits.replace(/0+$/, function (z) { return z.slice(0, Math.max(0, z.length - (spec.maxFrac - spec.minFrac))); }).replace(/\.$/, '');
    }
    var ip = digits.split('.')[0], fp = digits.split('.')[1] || '';
    if (spec.minInt === 0 && ip === '0' && fp) ip = '';
    if (spec.grouping > 0 && ip.length > spec.grouping) {
      var re = new RegExp('\\B(?=(\\d{' + spec.grouping + '})+(?!\\d))', 'g');
      ip = ip.replace(re, ',');
    }
    var body = ip + (fp ? '.' + fp : '');
    var isZero = Number(body.replace(/,/g, '')) === 0;
    if (isZero) neg = false;   // Java prints "-0.00" for -0.004; Fishbowl paperwork never wants that
    var sym = opts.symbol;
    function affix(a) {
      var out = a.replace(/\u0000C/g, sym != null ? sym : '$');
      if (sym != null) out = out.replace(/\$/g, sym);
      return out;
    }
    if (neg && spec.neg) return affix(spec.neg.prefix) + body + affix(spec.neg.suffix);
    return (neg ? '-' : '') + affix(spec.pos.prefix) + body + affix(spec.pos.suffix);
  }

  // Fishbowl timestamps come back as "YYYY-MM-DD HH:mm:ss[.S]" (local) or ISO
  // with a zone. Local forms are built from parts — new Date('YYYY-MM-DD') would
  // be read as UTC and shift the day.
  function toDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (typeof v === 'number') return new Date(v);
    var s = String(v).trim();
    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) && /T/.test(s)) { var d0 = new Date(s); return isNaN(d0) ? null : d0; }
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?/.exec(s);
    if (!m) { var d1 = new Date(s); return isNaN(d1) ? null : d1; }
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), m[7] ? +String(m[7]).slice(0, 3).padEnd(3, '0') : 0);
  }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }

  /** Format like java.text.SimpleDateFormat(pattern).format(value). */
  function fmtDate(pattern, value) {
    var d = toDate(value);
    if (!d) return '';
    pattern = pattern || 'MM/dd/yyyy';
    var out = '', i = 0;
    while (i < pattern.length) {
      var c = pattern.charAt(i);
      if (c === "'") {
        var j = pattern.indexOf("'", i + 1);
        if (j === i + 1) { out += "'"; i += 2; continue; }
        out += pattern.slice(i + 1, j < 0 ? pattern.length : j); i = j < 0 ? pattern.length : j + 1; continue;
      }
      if (!/[A-Za-z]/.test(c)) { out += c; i++; continue; }
      var n = 1; while (pattern.charAt(i + n) === c) n++;
      var h = d.getHours();
      switch (c) {
        case 'y': out += n === 2 ? pad(d.getFullYear() % 100, 2) : pad(d.getFullYear(), n); break;
        case 'M': out += n >= 4 ? MONTHS[d.getMonth()] : n === 3 ? MONTHS[d.getMonth()].slice(0, 3) : pad(d.getMonth() + 1, n); break;
        case 'd': out += pad(d.getDate(), n); break;
        case 'E': out += n >= 4 ? DAYS[d.getDay()] : DAYS[d.getDay()].slice(0, 3); break;
        case 'H': out += pad(h, n); break;
        case 'k': out += pad(h === 0 ? 24 : h, n); break;
        case 'h': out += pad(h % 12 === 0 ? 12 : h % 12, n); break;
        case 'K': out += pad(h % 12, n); break;
        case 'm': out += pad(d.getMinutes(), n); break;
        case 's': out += pad(d.getSeconds(), n); break;
        case 'S': out += pad(d.getMilliseconds(), 3).slice(0, Math.max(n, 1)); break;
        case 'a': out += h < 12 ? 'AM' : 'PM'; break;
        default: out += pattern.substr(i, n);
      }
      i += n;
    }
    return out;
  }

  // Java DateFormat.LONG/LONG ("October 8, 2026 3:04:05 PM AEDT") — the
  // "printed at" stamp in the Jasper page footer.
  function printedAt(d) {
    d = d || new Date();
    try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'long' }).format(d); }
    catch (_) { return d.toString(); }
  }

  // Currency glyph like Fishbowl's CurrencySymbolConst (the locale's own
  // symbol: AUD/USD/CAD/NZD "$", GBP "£", EUR "€"), or the ISO code when the
  // "Currency Use Code" system property is on.
  function currencySymbol(code, useCode) {
    if (!code) return '$';
    if (useCode) return code;
    if (code === 'INR') return 'Rs.';
    try {
      var parts = new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0);
      for (var i = 0; i < parts.length; i++) if (parts[i].type === 'currency') return parts[i].value;
    } catch (_) {}
    return code;
  }

  FBDoc.fmt = {
    number: fmtNumber, date: fmtDate, toDate: toDate, printedAt: printedAt,
    currencySymbol: currencySymbol, parsePattern: parseJavaPattern
  };

  // ===================================================================
  //  Columns — one catalogue for every document, fit to the content width
  //  basis/min in pt; flex = share of spare width (0 = fixed width).
  //  Widths come from the Jasper paperwork so a column looks the same in
  //  every document; only text columns flex.
  // ===================================================================
  var CATALOG = {
    line:         { basis: 30,  min: 22, flex: 0,    align: 'center' },
    type:         { basis: 43,  min: 34, flex: 0,    align: 'center' },
    num:          { basis: 90,  min: 60, flex: 0.25, align: 'left' },
    desc:         { basis: 120, min: 70, flex: 1,    align: 'left' },
    numdesc:      { basis: 160, min: 90, flex: 1,    align: 'left' },
    cf:           { basis: 72,  min: 48, flex: 0,    align: 'center' },
    date:         { basis: 72,  min: 56, flex: 0,    align: 'center' },
    unitPrice:    { basis: 72,  min: 54, flex: 0,    align: 'right' },
    curUnitPrice: { basis: 72,  min: 54, flex: 0,    align: 'right' },
    qty:          { basis: 61,  min: 48, flex: 0,    align: 'right' },
    total:        { basis: 72,  min: 56, flex: 0,    align: 'right' },
    curTotal:     { basis: 72,  min: 56, flex: 0,    align: 'right' },
    taxCode:      { basis: 32,  min: 28, flex: 0,    align: 'left' },
    taxAmt:       { basis: 63,  min: 50, flex: 0,    align: 'right' },
    curTax:       { basis: 63,  min: 50, flex: 0,    align: 'right' },
    // payments
    payDate:      { basis: 73,  min: 56, flex: 0,    align: 'left' },
    payMethod:    { basis: 200, min: 90, flex: 1,    align: 'left' },
    payAmount:    { basis: 144, min: 70, flex: 0,    align: 'right' },
    // key/value info strips (equal shares)
    strip:        { basis: 92,  min: 50, flex: 1,    align: 'center' }
  };

  /**
   * Fit columns to `width` (pt). cols: [{ key, kind?, basis?, min?, flex? }].
   * Every column starts at its basis; spare width goes to flex columns by
   * weight (all columns by basis when none flex); a shortfall shrinks flex
   * columns toward min, then fixed ones. Still too wide: `compact` — the caller
   * drops one font step, so minimums shrink by opts.compactScale (default 7/9,
   * 9pt -> 7pt) and the shrink repeats; last resort scales everything.
   * Widths sum exactly to `width`.
   */
  function fitColumns(cols, width, catalog, opts) {
    catalog = catalog || CATALOG;
    opts = opts || {};
    var items = cols.map(function (c) {
      var base = catalog[c.kind || c.key] || { basis: 72, min: 40, flex: 0 };
      return Object.assign({}, base, c);
    });
    if (!items.length) return { widths: [], compact: false, items: items };
    var w = items.map(function (c) { return c.basis; });
    var total = function () { return w.reduce(function (a, b) { return a + b; }, 0); };
    var spare = width - total(), compact = false;
    if (spare > 0) {
      var flexIdx = items.map(function (c, i) { return c.flex > 0 ? i : -1; }).filter(function (i) { return i >= 0; });
      if (flexIdx.length) {
        var fsum = flexIdx.reduce(function (a, i) { return a + items[i].flex; }, 0);
        flexIdx.forEach(function (i) { w[i] += spare * items[i].flex / fsum; });
      } else {
        var bsum = total();
        w = w.map(function (x) { return x + spare * x / bsum; });
      }
    } else if (spare < 0) {
      var shrink = function (pred) {
        var over = total() - width;
        if (over <= 0) return;
        var idx = items.map(function (c, i) { return pred(c) ? i : -1; }).filter(function (i) { return i >= 0; });
        var room = idx.reduce(function (a, i) { return a + Math.max(0, w[i] - items[i].min); }, 0);
        if (room <= 0) return;
        var take = Math.min(over, room);
        idx.forEach(function (i) { w[i] -= take * Math.max(0, w[i] - items[i].min) / room; });
      };
      shrink(function (c) { return c.flex > 0; });
      shrink(function (c) { return !(c.flex > 0); });
      if (total() - width > 0.01) {
        compact = true;
        var cs = opts.compactScale || 7 / 9;
        items.forEach(function (c) { c.min = c.min * cs; });
        shrink(function (c) { return c.flex > 0; });
        shrink(function (c) { return !(c.flex > 0); });
      }
      if (total() - width > 0.01) {
        var k = width / total();
        w = w.map(function (x) { return x * k; });
        compact = true;
      }
    }
    // Round to 0.01pt; the last column takes the remainder so the sum is exact.
    w = w.map(function (x) { return Math.round(x * 100) / 100; });
    var diff = Math.round((width - total()) * 100) / 100;
    w[w.length - 1] = Math.round((w[w.length - 1] + diff) * 100) / 100;
    return { widths: w, compact: compact, items: items };
  }
  function colgroup(widths) {
    return '<colgroup>' + widths.map(function (x) { return '<col style="width:' + x + 'pt">'; }).join('') + '</colgroup>';
  }
  FBDoc.Columns = { CATALOG: CATALOG, fit: fitColumns, colgroup: colgroup };

  // ===================================================================
  //  LAYOUT — pure page-break algorithm (no DOM; Node-testable)
  //
  //  items[k] = {
  //    h          height (px)
  //    table      table key or null (consecutive rows of one table share a
  //               <table>; its column header costs chrome[table] on every
  //               sheet where a run of that table starts)
  //    kwn / kwp  keep with next / keep with previous (no break between)
  //    brk        force a break before this item
  //    grp        [groupId, …] outer→inner the item belongs to (as child/footer)
  //    split      { tops:[], bots:[], padT, padB } line boxes for splittable text
  //  }
  //  groups[id] = { header: index of the header item, repeatH: height of its
  //                 "(continued)" variant, 0 = don't repeat }
  //  cap(p, last) = body height available on sheet p (last: the last sheet,
  //                 whose footer is the taller lastPageFooter)
  //
  //  Returns pages: [{ from:{i,l}, to:{i,l}, last, repeat:[groupIds], forced? }]
  //  {i,l} = item index + first line (l>0 = continuing a split item). The
  //  last page may be empty (footer-only) when even the final row can't share
  //  a sheet with the last-page footer.
  // ===================================================================
  var EPS = 0.01;
  function layout(model) {
    var items = model.items || [], N = items.length;
    var chrome = model.chrome || {}, groups = model.groups || {};
    var cap = model.cap, orphans = model.orphans || 2, widows = model.widows || 2;
    var pages = [];
    var END = { i: N, l: 0 };

    function nLines(it) { return it.split ? it.split.tops.length : 0; }
    function fragH(it, a, b) {
      var s = it.split;
      return s.padT + (s.bots[b - 1] - s.tops[a]) + s.padB;
    }
    function restH(it, a) { return a > 0 ? fragH(it, a, nLines(it)) : it.h; }
    function openGroups(pos) {
      if (pos.i >= N) return [];
      var it = items[pos.i];
      return (it.grp || []).filter(function (g) {
        var G = groups[g]; return G && G.header != null && G.header < pos.i && G.repeatH > 0;
      });
    }
    function prelude(pos) {
      return openGroups(pos).reduce(function (a, g) { return a + groups[g].repeatH; }, 0);
    }
    function canBreakBefore(k) {
      if (k <= 0 || k >= N) return true;
      if (items[k - 1].kwn || items[k].kwp) return false;
      return true;
    }
    // Largest line L (a < L <= n) such that lines [a, L) fit in `avail`,
    // honouring orphans (≥ orphans lines here) and widows (≥ widows left over).
    function lastFittingLine(it, a, avail, relax) {
      var n = nLines(it), best = null;
      for (var L = a + 1; L <= n; L++) {
        if (fragH(it, a, L) > avail + EPS) break;
        if (!relax) {
          if (L < n && L - a < Math.min(orphans, n - a)) continue;
          if (L < n && n - L < widows) continue;
        }
        best = L;
      }
      return best;
    }

    function fill(start, budget) {
      var used = prelude(start), tbl = null, lastGood = null;
      for (var k = start.i; k < N; k++) {
        var it = items[k], a = (k === start.i ? start.l : 0);
        var cc = (it.table && it.table !== tbl) ? (chrome[it.table] || 0) : 0;
        var h = restH(it, a);
        if (used + cc + h <= budget + EPS) {
          used += cc + h; tbl = it.table || null;
          if (k + 1 < N) {
            if (canBreakBefore(k + 1)) lastGood = { i: k + 1, l: 0 };
            if (items[k + 1].brk) return { to: { i: k + 1, l: 0 }, end: false, lastGood: lastGood };
          }
          continue;
        }
        // Doesn't fit whole: split text inside it?
        if (it.split) {
          var L = lastFittingLine(it, a, budget - used - cc, false);
          if (L != null && L > a) return { to: { i: k, l: L }, end: false, lastGood: lastGood };
        }
        if (lastGood && (lastGood.i > start.i)) return { to: lastGood, end: false, lastGood: lastGood };
        if (k > start.i || a > 0) {
          // Keep rules allow no break on this sheet: relax them, break before k.
          return { to: { i: k, l: 0 }, end: false, lastGood: lastGood, relaxed: true };
        }
        // First item on the sheet and still too tall: force progress.
        if (it.split) {
          var Lf = Math.max(a + 1, lastFittingLine(it, a, budget - used - cc, true) || a + 1);
          if (Lf < nLines(it)) return { to: { i: k, l: Lf }, end: false, lastGood: null, forced: true };
          return { to: { i: k + 1, l: 0 }, end: k + 1 >= N, lastGood: null, forced: true, overflow: k };
        }
        return { to: { i: k + 1, l: 0 }, end: k + 1 >= N, lastGood: null, forced: true, overflow: k };
      }
      return { to: END, end: true, lastGood: lastGood };
    }

    var pos = { i: 0, l: 0 }, guard = 0;
    if (N === 0) return [{ from: END, to: END, last: true, repeat: [] }];
    while (pos.i < N && guard++ < 100000) {
      var p = pages.length;
      var rep = openGroups(pos);
      var asLast = fill(pos, cap(p, true));
      if (asLast.end && !asLast.forced) { pages.push({ from: pos, to: END, last: true, repeat: rep }); return pages; }
      var r = fill(pos, cap(p, false));
      if (r.end && !r.forced) {
        // Everything fits under the normal footer but not with the taller
        // last-page footer: carry the tail (from the last good break) over so
        // the totals never sit on a sheet alone — unless there is no good break.
        if (r.lastGood && r.lastGood.i > pos.i) {
          pages.push({ from: pos, to: r.lastGood, last: false, repeat: rep });
          pos = r.lastGood; continue;
        }
        pages.push({ from: pos, to: END, last: false, repeat: rep });
        pages.push({ from: END, to: END, last: true, repeat: [] });
        return pages;
      }
      var pg = { from: pos, to: r.to, last: false, repeat: rep };
      if (r.forced) pg.forced = true;
      if (r.overflow != null) pg.overflow = r.overflow;
      if (r.relaxed) pg.relaxed = true;
      pages.push(pg);
      if (r.to.i === pos.i && r.to.l <= pos.l) { r.to = { i: pos.i + 1, l: 0 }; pg.to = r.to; }  // progress guard
      pos = r.to;
      if (pos.i >= N) { pg.last = false; pages.push({ from: END, to: END, last: true, repeat: [] }); return pages; }
    }
    return pages;
  }
  FBDoc.layout = layout;

  // ===================================================================
  //  Code 128-B (pure). Returns module widths (bar, space, bar, …) including
  //  start, check and stop symbols; quiet zones are left to the renderer.
  // ===================================================================
  var C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 ' +
    '122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 ' +
    '322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 ' +
    '112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 ' +
    '312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 ' +
    '142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 ' +
    '421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 ' +
    '211412 211214 211232 2331112').split(' ');
  function code128B(text) {
    text = String(text == null ? '' : text);
    var codes = [104], sum = 104;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 32 || c > 127) c = 63;   // '?' for anything Code B can't carry
      var v = c - 32;
      codes.push(v); sum += v * (i + 1);
    }
    codes.push(sum % 103);
    codes.push(106);
    var modules = [];
    codes.forEach(function (v) { C128[v].split('').forEach(function (d) { modules.push(+d); }); });
    return { codes: codes, modules: modules };
  }
  // opts.module = module (narrowest bar) width in pt: the barcode is drawn at its
  // natural width (modules x module), like Jasper's barbecue component, and the
  // caller centres it. Omit it to stretch to the container instead.
  function code128Svg(text, opts) {
    opts = opts || {};
    var quiet = opts.quiet == null ? 10 : opts.quiet;
    var mods = code128B(text).modules;
    var total = mods.reduce(function (a, b) { return a + b; }, 0) + quiet * 2;
    var x = quiet, rects = '';
    mods.forEach(function (w, i) {
      if (i % 2 === 0) rects += '<rect x="' + x + '" y="0" width="' + w + '" height="100"/>';
      x += w;
    });
    var size = opts.module ? ' style="width:' + (total * opts.module).toFixed(2) + 'pt;height:100%;display:block"' : '';
    return '<svg class="fbdoc-barcode" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' 100" preserveAspectRatio="none" ' +
      'shape-rendering="crispEdges" role="img" aria-label="' + esc(text) + '"' + size + '><g fill="#000">' + rects + '</g></svg>';
  }
  FBDoc.code128 = { encode: code128B, svg: code128Svg, PATTERNS: C128 };

  // ===================================================================
  //  Fishbowl data helpers
  // ===================================================================
  // Values are bound INLINE (escaped literals) by default. The client's object
  // form, runQuery({ query, parameters }), runs server-side through a different
  // path (runSqlQuery) that requires the company "Data Access API" setting
  // (COMPANY_DATA_ACCESS_API, off by default) plus the Data-View right; when it
  // is refused the client rejects with a bare string. Plain runQuery(sql) — the
  // path every BI report uses — needs neither. Opt in with q.useBindParams(true).
  var _useBind = false;
  function inlineBind(sql, params) {
    var i = 0;
    var out = sql.replace(/\?/g, function () {
      if (i >= params.length) throw new Error('more ? placeholders than parameters');
      var v = params[i++];
      if (v == null) return 'NULL';
      if (typeof v === 'number') {
        if (!isFinite(v)) throw new Error('non-finite number parameter');
        return String(v);
      }
      if (typeof v === 'boolean') return v ? '1' : '0';
      return "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
    });
    if (i !== params.length) throw new Error('more parameters than ? placeholders');
    return out;
  }
  function normRows(r) {
    if (r == null) return [];
    if (typeof r === 'string') { try { var p = JSON.parse(r); return Array.isArray(p) ? p : []; } catch (_) { return []; } }
    return Array.isArray(r) ? r : [];
  }
  // Readable text from whatever the client rejected with (string, Java
  // exception proxy, object, Error).
  function errText(e) {
    if (e == null) return 'unknown error';
    if (typeof e === 'string') return e;
    if (e.message) return String(e.message);
    try { var j = JSON.stringify(e); if (j && j !== '{}') return j; } catch (_) {}
    try { return String(e); } catch (_) { return 'unknown error'; }
  }
  FBDoc.errText = errText;
  function isErrorRow(row) {
    var k = row && Object.keys(row);
    return k && k.length === 1 && /^error$/i.test(k[0]);
  }
  /** Run a SELECT; `?` placeholders are filled from params (inline by default). */
  async function q(sql, params) {
    params = params || [];
    if (typeof global.runQueryAsync !== 'function' && typeof global.runQuery !== 'function') throw new Error('runQuery unavailable');
    var arg = (params.length && _useBind) ? { query: sql, parameters: params } : (params.length ? inlineBind(sql, params) : sql);
    var rows;
    try {
      rows = normRows(typeof global.runQueryAsync === 'function' ? await global.runQueryAsync(arg) : global.runQuery(arg));
    } catch (e) {
      var head = String(sql).replace(/\s+/g, ' ').trim().slice(0, 90);
      log('query failed: ' + errText(e) + ' | ' + head, 'error');
      throw new Error('Query failed: ' + errText(e) + ' (' + head + '…)');
    }
    if (rows.length === 1 && isErrorRow(rows[0])) {
      var msg = rows[0][Object.keys(rows[0])[0]];
      throw new Error('Query failed: ' + msg);
    }
    return rows;
  }
  q.useBindParams = function (on) { _useBind = !!on; };

  async function sys(keys) {
    if (!keys || !keys.length) return {};
    var rows = await q('SELECT sysKey AS k, sysValue AS v FROM sysproperties WHERE sysKey IN (' +
      keys.map(function () { return '?'; }).join(',') + ')', keys);
    var out = {};
    rows.forEach(function (r) { out[r.k] = r.v; });
    return out;
  }

  /** Saved options of a stock Jasper report: { name: value } ('' = unset). */
  async function presets(reportPath) {
    var rows = await q('SELECT rp.name AS name, rp.paramValue AS value FROM reportparameter rp ' +
      'JOIN report r ON r.id = rp.reportId WHERE r.path = ?', [reportPath]);
    var out = {};
    rows.forEach(function (r) { out[r.name] = r.value == null ? '' : String(r.value); });
    return out;
  }

  async function companyLogo() {
    var rows = await q("SELECT imageFull AS full, imageThumbnail AS thumb FROM image " +
      "WHERE LOWER(tableName) = 'company' AND recordId = 1 ORDER BY id LIMIT 1");
    if (!rows.length) return null;
    var b = rows[0].full || rows[0].thumb;
    if (!b) return null;
    b = String(b);
    return b.indexOf('data:') === 0 ? b : 'data:image/png;base64,' + b;
  }

  FBDoc.q = q; FBDoc.sys = sys; FBDoc.presets = presets; FBDoc.companyLogo = companyLogo;
  FBDoc._inlineBind = inlineBind;

  // ===================================================================
  //  DOM — everything below needs a browser
  // ===================================================================
  var CSS = [
    '.fbdoc-root{font-family:"FB Doc Open Sans","Open Sans",Arial,"Liberation Sans",sans-serif;font-size:9pt;line-height:1.25;color:#000;',
    '  -webkit-print-color-adjust:exact;print-color-adjust:exact;font-kerning:normal;text-rendering:geometricPrecision}',
    '.fbdoc-root *,.fbdoc-root *::before,.fbdoc-root *::after{box-sizing:border-box}',
    '.fbdoc-root p,.fbdoc-root h1,.fbdoc-root h2,.fbdoc-root h3,.fbdoc-root ul,.fbdoc-root ol{margin:0}',
    '.fbdoc-canvas{background:#6b7378;overflow:auto;padding:24px 0;position:relative}',
    '.fbdoc-stage{margin:0 auto;position:relative}',
    '.fbdoc-scaler{transform-origin:0 0;position:absolute;left:0;top:0}',
    // Screen: a full-size paper frame (padding = the print inset) holding the
    // printable sheet. Print: the frame collapses; the printer adds the inset.
    '.fbdoc-paper{background:#fff;margin:0 0 16px;box-shadow:0 2px 10px rgba(0,0,0,.35);position:relative;',
    '  break-inside:avoid;break-after:page;page-break-after:always}',
    '.fbdoc-paper:last-child{break-after:auto;page-break-after:auto;margin-bottom:0}',
    '.fbdoc-sheet{display:flex;flex-direction:column;overflow:hidden;position:relative;break-inside:avoid}',
    '.fbdoc-band{flex:none;position:relative}',
    '.fbdoc-body{flex:1 1 auto;min-height:0;overflow:hidden;display:flex;flex-direction:column}',
    '.fbdoc-body>*{flex:none}',
    '.fbdoc-flow{position:relative}',
    '.fbdoc-table{table-layout:fixed;width:100%;border-collapse:separate;border-spacing:0}',
    '.fbdoc-table td,.fbdoc-table th{vertical-align:top;overflow:hidden;overflow-wrap:anywhere}',
    '.fbdoc-txt{white-space:pre-wrap;overflow-wrap:anywhere}',
    '.fbdoc-measure{position:absolute;left:-30000px;top:0;visibility:hidden;pointer-events:none}',
    '.fbdoc-barcode{display:block;width:100%;height:100%}',
    '.fbdoc-sheet[data-fbdoc-overflow]{outline:3px solid #d33}',
    // Print rules apply only while the document is the page (body.fbdoc-on):
    // a report showing its App view prints as it always did.
    '@media print{',
    '  html:has(body.fbdoc-on),body.fbdoc-on{margin:0!important;padding:0!important;height:auto!important;min-height:0!important;overflow:visible!important;background:#fff!important;display:block!important}',
    '  body.fbdoc-on>*:not(.fbdoc-canvas):not(.fbdoc-view){display:none!important}',
    '  body.fbdoc-on .fbdoc-view{display:block!important;height:auto!important;overflow:visible!important;position:static!important}',
    '  body.fbdoc-on .fbdoc-view-bar{display:none!important}',
    '  body.fbdoc-on .fbdoc-canvas{padding:0!important;background:none!important;overflow:visible!important;height:auto!important;position:static!important}',
    '  .fbdoc-stage{width:auto!important;height:auto!important}',
    // Nothing may be wider than the printable area in print, or the print path
    // shrinks the whole page to fit (the screen wrappers carry inline widths).
    '  .fbdoc-scaler{transform:none!important;position:static!important;width:auto!important}',
    '  .fbdoc-paper{margin:0!important;padding:0!important;width:auto!important;height:auto!important;box-shadow:none!important}',
    '  .fbdoc-sheet{outline:none!important}',
    '}'
  ].join('\n');

  function ensureCss() {
    if (document.getElementById('fbdoc-css')) return;
    var st = document.createElement('style'); st.id = 'fbdoc-css'; st.textContent = CSS;
    document.head.appendChild(st);
  }
  function applyPageCss(spec, insetMm) {
    var st = document.getElementById('fbdoc-page');
    if (!st) { st = document.createElement('style'); st.id = 'fbdoc-page'; document.head.appendChild(st); }
    st.textContent = '@page{size:' + spec.wMm.toFixed(2) + 'mm ' + spec.hMm.toFixed(2) + 'mm;margin:' + insetMm.toFixed(2) + 'mm}';
  }

  function toNode(content, ctx) {
    if (typeof content === 'function') content = content(ctx);
    if (content == null) return null;
    if (typeof content === 'string') {
      var d = document.createElement('div'); d.innerHTML = content; return d;
    }
    return content;
  }
  // Placeholders resolved after layout ("Page X of Y").
  var VAR = function (name) { return '<span data-fbdoc-var="' + name + '"></span>'; };
  FBDoc.var = VAR;

  async function settle(host) {
    void host.offsetHeight;
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (_) {}
    var imgs = Array.prototype.slice.call(host.querySelectorAll('img'));
    await Promise.all(imgs.map(function (im) {
      if (im.complete && im.naturalWidth) return null;
      return (im.decode ? im.decode() : Promise.resolve()).catch(function () { im.style.visibility = 'hidden'; });
    }));
    void host.offsetHeight;
  }

  function lineBoxes(textNode, originTop, k) {
    var range = document.createRange();
    range.selectNodeContents(textNode);
    var rects = Array.prototype.slice.call(range.getClientRects());
    var lines = [];
    rects.forEach(function (r) {
      if (r.height <= 0) return;
      var top = r.top / k - originTop, bot = r.bottom / k - originTop;
      var last = lines[lines.length - 1];
      if (last && Math.abs(last.top - top) < 2) { last.bot = Math.max(last.bot, bot); return; }
      lines.push({ top: top, bot: bot });
    });
    return lines;
  }
  // Character offset where line L starts (binary search over Range rects).
  function lineStartOffset(textNode, L, lines, originTop, k) {
    var text = textNode.nodeValue, lo = 0, hi = text.length, target = lines[L].top - 1;
    var range = document.createRange();
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      range.setStart(textNode, mid); range.setEnd(textNode, Math.min(mid + 1, text.length));
      var r = range.getClientRects()[0] || range.getBoundingClientRect();
      var top = r.top / k - originTop;
      if (top >= target) hi = mid; else lo = mid + 1;
    }
    return lo;
  }
  function splitTarget(node) {
    var el = node.matches && node.matches('[data-fbdoc-split]') ? node : node.querySelector('[data-fbdoc-split]');
    if (!el) return null;
    var tn = null;
    for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) { tn = c; break; }
    return tn ? { el: el, text: tn } : null;
  }

  /**
   * Render one or more documents into fixed-size sheets inside `mount`.
   * opts = { mount, page: PageSpec, docs: [docDef], slackPx?, shortPx? }
   * docDef = {
   *   id, pageHeader(ctx), pageFooter(ctx), lastPageFooter(ctx)   html | Node | fn
   *   tables: { key: { colgroup, thead, className } }
   *   blocks: [{ html, table?, kwn?, kwp?, brk?, grp?:[ids], groupHeader?:id,
   *              repeatHtml?, stripe?: true|'attach', split?: true, cls? }]
   * }
   * ctx passed to band functions: { doc, first, last, pageNo: VAR, pageCount: VAR }
   */
  async function paginate(opts, _attempt) {
    _attempt = _attempt || 0;
    var t0 = Date.now();
    ensureCss();
    var spec = opts.page, slack = opts.slackPx == null ? 2 : opts.slackPx;
    var g = geometry(spec, { shortPx: opts.shortPx, printInsetMm: opts.printInsetMm });
    applyPageCss(spec, g.insetMm);
    var mount = opts.mount;
    mount.classList.add('fbdoc-canvas');

    // ---- measuring host
    var host = document.createElement('div');
    host.className = 'fbdoc-root fbdoc-measure';
    host.style.width = g.CW + 'px';
    document.body.appendChild(host);

    var docsOut = [], warnings = [];
    try {
      var measured = opts.docs.map(function (doc) { return renderForMeasure(doc, host); });
      await settle(host);
      var hostRect = host.getBoundingClientRect();
      var k = hostRect.width / host.offsetWidth || 1;   // body zoom guard
      var originTop = hostRect.top / k;

      var sheets = [];
      measured.forEach(function (m, di) {
        var doc = opts.docs[di];
        // ---- measure
        var hOf = function (el) { return el ? el.getBoundingClientRect().height / k : 0; };
        var hdrH = hOf(m.bands.header), hdrRestH = hOf(m.bands.headerRest), ftrH = hOf(m.bands.footer), lastH = hOf(m.bands.last);
        var chrome = {};
        Object.keys(m.theads).forEach(function (key) { chrome[key] = hOf(m.theads[key]); });
        var groups = {};
        var items = m.blocks.map(function (b, idx) {
          var it = { h: hOf(b.node), table: b.def.table || null, kwn: !!b.def.kwn, kwp: !!b.def.kwp, brk: !!b.def.brk, grp: b.def.grp || [] };
          if (b.def.groupHeader) groups[b.def.groupHeader] = { header: idx, repeatH: b.repeatNode ? hOf(b.repeatNode) : 0 };
          if (b.def.split) {
            var st = splitTarget(b.node);
            if (st) {
              var top = b.node.getBoundingClientRect().top / k - originTop;
              var lines = lineBoxes(st.text, originTop + top, k);
              if (lines.length > 1) {
                var bot = top + it.h;
                it.split = {
                  tops: lines.map(function (x) { return x.top; }), bots: lines.map(function (x) { return x.bot; }),
                  padT: lines[0].top, padB: Math.max(0, (bot - top) - lines[lines.length - 1].bot)
                };
                b.lines = lines; b.splitTarget = st; b.top = top;
              }
            }
          }
          return it;
        });
        var cap = function (p, last) { return g.innerH - (p === 0 ? hdrH : hdrRestH) - (last ? lastH : ftrH) - slack; };
        var pages = layout({ items: items, chrome: chrome, groups: groups, cap: cap, orphans: opts.orphans, widows: opts.widows });
        pages.forEach(function (pg) { if (pg.forced || pg.relaxed) warnings.push(doc.id + ': ' + (pg.forced ? 'forced' : 'relaxed') + ' break near item ' + pg.from.i); });

        // ---- split fragments (character offsets) before any node moves
        var cuts = {};   // item index -> sorted line indices where it is cut
        pages.forEach(function (pg) { if (pg.to.l > 0) (cuts[pg.to.i] = cuts[pg.to.i] || []).push(pg.to.l); });
        var frags = {};  // item index -> [{node, from, to}]
        Object.keys(cuts).forEach(function (ki) {
          var b = m.blocks[ki]; if (!b.splitTarget) return;
          var text = b.splitTarget.text, full = text.nodeValue;
          // Fresh top: an earlier split item above may have reflowed the host.
          var nowTop = b.node.getBoundingClientRect().top / k - originTop;
          var bounds = [0].concat(cuts[ki].map(function (L) {
            return lineStartOffset(text, L, b.lines, originTop + nowTop, k);
          })).concat([full.length]);
          frags[ki] = [];
          for (var f = 0; f < bounds.length - 1; f++) {
            var node = f === 0 ? b.node : b.node.cloneNode(true);
            frags[ki].push({ node: node, text: full.slice(bounds[f], bounds[f + 1]).replace(/^\n/, ''), cont: f > 0 });
          }
          frags[ki].forEach(function (fr) {
            var st2 = splitTarget(fr.node);
            st2.text.nodeValue = fr.text;
            if (fr.cont && fr.node.tagName === 'TBODY') {
              // Continuation row: only the split cell carries on.
              Array.prototype.forEach.call(fr.node.querySelectorAll('td'), function (td) {
                if (!td.contains(st2.el)) td.innerHTML = '';
              });
            }
          });
        });

        // ---- assemble sheets
        var docSheets = [];
        pages.forEach(function (pg, pi) {
          var ctx = { doc: doc, first: pi === 0, last: pg.last, pageNo: VAR('pageNo'), pageCount: VAR('pageCount') };
          var sheet = document.createElement('div');
          sheet.className = 'fbdoc-sheet';
          sheet.style.width = g.W + 'px'; sheet.style.height = g.H + 'px';
          sheet.style.padding = g.pad.t + 'px ' + g.pad.r + 'px ' + g.pad.b + 'px ' + g.pad.l + 'px';
          sheet.setAttribute('data-fbdoc-doc', doc.id || di);
          var hdr = document.createElement('div'); hdr.className = 'fbdoc-band fbdoc-header';
          appendContent(hdr, doc.pageHeader, ctx);
          var body = document.createElement('div'); body.className = 'fbdoc-body';
          var ftr = document.createElement('div'); ftr.className = 'fbdoc-band ' + (pg.last ? 'fbdoc-lastfooter' : 'fbdoc-footer');
          appendContent(ftr, pg.last ? (doc.lastPageFooter || doc.pageFooter) : doc.pageFooter, ctx);
          sheet.appendChild(hdr); sheet.appendChild(body); sheet.appendChild(ftr);

          var curTable = null, curKey = null, curTbodyParent = null;
          var openTable = function (key) {
            var tdef = (doc.tables || {})[key] || {};
            var t = document.createElement('table');
            t.className = 'fbdoc-table ' + (tdef.className || '');
            t.setAttribute('data-fbdoc-table', key);
            t.innerHTML = (tdef.colgroup || '') + (tdef.thead || '');
            body.appendChild(t);
            curTable = t; curKey = key; curTbodyParent = t;
          };
          var place = function (node, key) {
            if (key) { if (curKey !== key) openTable(key); curTbodyParent.appendChild(node); }
            else { curTable = null; curKey = null; body.appendChild(node); }
          };
          // repeated group headers
          (pg.repeat || []).forEach(function (gid, ri) {
            var hb = m.blocks[groups[gid].header];
            if (hb && hb.repeatNode) place(hb.repeatNode.cloneNode(true), hb.def.table || null);
          });
          if (pg.from.i < m.blocks.length) {
            var endI = pg.to.i + (pg.to.l > 0 ? 1 : 0);
            for (var i = pg.from.i; i < endI && i < m.blocks.length; i++) {
              var b = m.blocks[i];
              var node = b.node;
              if (frags[i]) {
                var fromL = (i === pg.from.i) ? pg.from.l : 0;
                var idx = (cuts[i] || []).filter(function (L) { return L <= fromL; }).length;
                node = frags[i][idx].node;
              }
              place(node, b.def.table || null);
            }
          }
          sheet.setAttribute('data-fbdoc-page', pi + 1);
          docSheets.push({ sheet: sheet, body: body, last: pg.last });
        });

        // ---- page numbers + zebra (per sheet, per table run, like Jasper's PAGE_COUNT)
        docSheets.forEach(function (s, si) {
          Array.prototype.forEach.call(s.sheet.querySelectorAll('[data-fbdoc-var="pageNo"]'), function (e) { e.textContent = si + 1; });
          Array.prototype.forEach.call(s.sheet.querySelectorAll('[data-fbdoc-var="pageCount"]'), function (e) { e.textContent = docSheets.length; });
          Array.prototype.forEach.call(s.body.querySelectorAll('table.fbdoc-table'), function (t) {
            var n = 0, odd = false;
            Array.prototype.forEach.call(t.tBodies, function (tb) {
              var st = tb.getAttribute('data-fbdoc-stripe');
              if (st === 'row') { n++; odd = n % 2 === 0; }
              tb.classList.toggle('fbdoc-zebra', (st === 'row' || st === 'attach') && odd);
            });
          });
        });
        docsOut.push({ id: doc.id, pageCount: docSheets.length, pages: pages });
        docSheets.forEach(function (s) { sheets.push(s); });
      });

      // ---- swap in atomically
      var stage = document.createElement('div'); stage.className = 'fbdoc-stage';
      var scaler = document.createElement('div'); scaler.className = 'fbdoc-scaler fbdoc-root';
      scaler.style.width = g.paperW + 'px';
      sheets.forEach(function (s) {
        var paper = document.createElement('div');
        paper.className = 'fbdoc-paper';
        paper.style.width = g.paperW + 'px'; paper.style.height = g.paperH + 'px';
        paper.style.padding = g.inset + 'px';
        paper.appendChild(s.sheet);
        scaler.appendChild(paper);
      });
      stage.appendChild(scaler);
      mount.replaceChildren(stage);
      fitView(mount, g, sheets.length);

      // ---- verify: any sheet whose body overflows -> retry with more slack
      var over = 0;
      sheets.forEach(function (s) {
        var d = s.body.scrollHeight - s.body.clientHeight;
        if (d > 1) { over = Math.max(over, d); s.sheet.setAttribute('data-fbdoc-overflow', Math.ceil(d)); }
      });
      var res = { sheets: sheets.length, docs: docsOut, geometry: g, warnings: warnings, ms: Date.now() - t0, slack: slack, attempt: _attempt };
      if (over > 1 && _attempt < 2) {
        log('sheet overflow ' + Math.ceil(over) + 'px — re-laying out with more slack', 'warn');
        return paginate(Object.assign({}, opts, { slackPx: slack + over + 2 }), _attempt + 1);
      }
      if (over > 1) res.warnings.push('sheet overflow ' + Math.ceil(over) + 'px persists');
      warnings.forEach(function (w) { log(w, 'warn'); });
      FBDoc.last = res;
      return res;
    } finally {
      host.remove();
    }
  }

  function appendContent(el, content, ctx) {
    var n = toNode(content, ctx);
    if (!n) return;
    if (n.tagName === 'DIV' && !n.className && !n.id) { while (n.firstChild) el.appendChild(n.firstChild); }
    else el.appendChild(n);
  }

  // Build every band and block once inside the measuring host.
  function renderForMeasure(doc, host) {
    var wrap = document.createElement('div');
    host.appendChild(wrap);
    var ctx0 = { doc: doc, first: true, last: false, pageNo: VAR('pageNo'), pageCount: VAR('pageCount') };
    var band = function (content, last, first) {
      if (!content) return null;
      var d = document.createElement('div'); d.className = 'fbdoc-band';
      appendContent(d, content, Object.assign({}, ctx0, { last: !!last, first: first !== false }));
      wrap.appendChild(d); return d;
    };
    // The page header is measured twice: a Jasper title band prints on the
    // first sheet only, so later sheets may carry a shorter header.
    var bands = { header: band(doc.pageHeader), headerRest: band(doc.pageHeader, false, false),
                  footer: band(doc.pageFooter), last: band(doc.lastPageFooter || doc.pageFooter, true) };
    var theads = {}, blocks = [], curTable = null, curKey = null;
    (doc.blocks || []).forEach(function (def) {
      var key = def.table || null, node, repeatNode = null;
      if (key) {
        if (curKey !== key) {
          var tdef = (doc.tables || {})[key] || {};
          curTable = document.createElement('table');
          curTable.className = 'fbdoc-table ' + (tdef.className || '');
          curTable.innerHTML = (tdef.colgroup || '') + (tdef.thead || '');
          wrap.appendChild(curTable); curKey = key;
          if (!theads[key]) theads[key] = curTable.tHead;
        }
        node = document.createElement('tbody');
        node.innerHTML = def.html || '';
        if (def.stripe) node.setAttribute('data-fbdoc-stripe', def.stripe === 'attach' ? 'attach' : 'row');
        if (def.cls) node.className = def.cls;
        curTable.appendChild(node);
        if (def.repeatHtml) {
          repeatNode = document.createElement('tbody');
          repeatNode.innerHTML = def.repeatHtml;
          if (def.cls) repeatNode.className = def.cls;
          curTable.appendChild(repeatNode);
        }
      } else {
        curKey = null; curTable = null;
        node = document.createElement('div');
        node.className = 'fbdoc-flow' + (def.cls ? ' ' + def.cls : '');
        node.innerHTML = def.html || '';
        wrap.appendChild(node);
        if (def.repeatHtml) {
          repeatNode = document.createElement('div'); repeatNode.className = node.className;
          repeatNode.innerHTML = def.repeatHtml; wrap.appendChild(repeatNode);
        }
      }
      node.setAttribute('data-fbdoc-block', blocks.length);
      blocks.push({ def: def, node: node, repeatNode: repeatNode });
    });
    // Repeat ("continued") variants stay in the host: measured there, cloned
    // into a sheet when a group runs over a page break.
    return { bands: bands, theads: theads, blocks: blocks };
  }

  // Scale the stage to the canvas width on screen (print removes the transform).
  function fitView(mount, g, count) {
    var stage = mount.querySelector('.fbdoc-stage'), scaler = mount.querySelector('.fbdoc-scaler');
    if (!stage || !scaler) return;
    var apply = function () {
      var avail = Math.max(200, mount.clientWidth - 32);
      var s = Math.min(1, avail / g.paperW);
      var gap = 16, totalH = count * g.paperH + Math.max(0, count - 1) * gap;
      scaler.style.transform = 'scale(' + s + ')';
      stage.style.width = (g.paperW * s) + 'px';
      stage.style.height = (totalH * s) + 'px';
    };
    apply();
    if (typeof ResizeObserver === 'function' && !mount._fbdocRO) {
      mount._fbdocRO = new ResizeObserver(function () { if (mount._fbdocFit) mount._fbdocFit(); });
      mount._fbdocRO.observe(mount);
    }
    mount._fbdocFit = apply;
  }

  // ===================================================================
  //  In-page print. window.print() on the report page is unreliable in
  //  Fishbowl's browser (often nothing happens), so — like the other BI
  //  reports — copy the laid-out sheets and every <style> (fb-doc CSS, the
  //  @page rule, embedded fonts, report CSS) into a new window and print THAT.
  //  Fonts are loaded first so text widths, and so page breaks, are identical.
  //  Returns the window (null if a popup was blocked).
  // ===================================================================
  function printWindow(opts) {
    opts = opts || {};
    var mount = opts.mount || document.querySelector('.fbdoc-canvas');
    var scaler = mount && mount.querySelector('.fbdoc-scaler');
    if (!scaler || !scaler.querySelector('.fbdoc-sheet')) { log('printWindow: nothing to print', 'warn'); return null; }
    var css = Array.prototype.map.call(document.querySelectorAll('style'), function (st) { return st.textContent; }).join('\n');
    var clone = scaler.cloneNode(true);
    clone.style.transform = 'none'; clone.style.position = 'static'; clone.style.margin = '0 auto';
    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + esc(opts.title || document.title) + '</title>' +
      '<style>' + css + '</style>' +
      '<style>html,body{margin:0;padding:0;background:#6b7378}.fbdoc-canvas{padding:16px 0;overflow:visible}.fbdoc-stage{width:auto}</style>' +
      '</head><body class="fbdoc-on"><div class="fbdoc-canvas"><div class="fbdoc-stage">' + clone.outerHTML + '</div></div></body></html>';
    // opts.win: a window the caller opened during the click (a window opened
    // after an await can lose the click's permission to open popups).
    var w = opts.win || window.open('', '_blank');
    if (!w) { log('printWindow: popup blocked', 'warn'); return null; }
    w.document.open(); w.document.write(html); w.document.close();
    var fonts = w.document.fonts;
    var family = '"FB Doc Open Sans"';
    var ready = fonts && fonts.load
      ? Promise.all([fonts.load('9pt ' + family), fonts.load('bold 9pt ' + family), fonts.load('italic 9pt ' + family)])
          .then(function () { return fonts.ready; })
      : Promise.resolve();
    var timeout = new Promise(function (r) { setTimeout(r, 4000); });
    Promise.race([ready, timeout]).catch(function () {}).then(function () {
      setTimeout(function () {
        try { w.focus(); if (!opts.noPrint) w.print(); }
        catch (e) { log('printWindow: print failed: ' + errText(e), 'error'); }
      }, 300);
    });
    return w;
  }

  FBDoc.paginate = paginate;
  FBDoc.printWindow = printWindow;
  FBDoc.CSS = CSS;

  // ===================================================================
  //  Record picker — typeahead + browse dropdown with filter chips
  //  FBDoc.picker({
  //    input,                     text box (typing searches)
  //    button?,                   opens the dropdown (browse with no text)
  //    filters?: [{ key, label, multi?, options:[{value,label}], value }]
  //                               multi: value is an array ([] = all);
  //                               single: value is one option value
  //    search: async (term, filterValues) -> [{ value, label, sub?, meta?:[..] }]
  //    onPick(item), onEnter?(text), onFilters?(filterValues)   (persist them)
  //  })
  //  Returns { open, close, filters() }.
  // ===================================================================
  var PICK_CSS = [
    '.fbdoc-pick{position:absolute;z-index:10050;background:#fff;border:1px solid #c9d1d6;border-radius:8px;',
    '  box-shadow:0 8px 24px rgba(0,0,0,.18);display:none;min-width:420px;max-width:640px;font:12px/1.35 "Segoe UI",sans-serif;color:#1d2a30}',
    '.fbdoc-pick-filters{padding:8px 10px 6px;border-bottom:1px solid #e3e7e9;background:#f7f9fa;border-radius:8px 8px 0 0}',
    '.fbdoc-pick-frow{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:4px}',
    '.fbdoc-pick-frow b{font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:#6b7b83;margin-right:4px;min-width:52px}',
    '.fbdoc-chip{border:1px solid #c9d1d6;background:#fff;border-radius:999px;padding:2px 9px;cursor:pointer;font:inherit;font-size:11.5px;color:#415157}',
    '.fbdoc-chip.on{background:#e3f1fb;border-color:#2d9cdb;color:#1a6fa3;font-weight:600}',
    '.fbdoc-pick-list{max-height:320px;overflow:auto}',
    '.fbdoc-pick-row{display:flex;gap:10px;align-items:baseline;padding:6px 10px;cursor:pointer;border-bottom:1px solid #f0f2f3}',
    '.fbdoc-pick-row.act{background:#e8f2fb}',
    '.fbdoc-pick-row .lb{font-weight:700;min-width:70px}',
    '.fbdoc-pick-row .sb{color:#415157;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.fbdoc-pick-row .mt{color:#6b7b83;white-space:nowrap;font-variant-numeric:tabular-nums;min-width:74px;text-align:right;flex:none}',
    '.fbdoc-pick-row .mt:first-of-type{text-align:left;min-width:84px}',
    '.fbdoc-pick-row .mt:last-child{min-width:88px}',
    '.fbdoc-pick-note{padding:8px 10px;color:#6b7b83}'
  ].join('\n');

  function picker(opts) {
    if (!document.getElementById('fbdoc-pick-css')) {
      var st = document.createElement('style'); st.id = 'fbdoc-pick-css'; st.textContent = PICK_CSS; document.head.appendChild(st);
    }
    var input = opts.input;
    var box = document.createElement('div');
    box.className = 'fbdoc-pick';
    box.innerHTML = '<div class="fbdoc-pick-filters"></div><div class="fbdoc-pick-list"></div>';
    document.body.appendChild(box);
    var fBox = box.firstChild, list = box.lastChild;
    var filters = (opts.filters || []).map(function (f) {
      return Object.assign({}, f, { value: f.multi ? (Array.isArray(f.value) ? f.value.map(String) : []) : String(f.value == null ? '' : f.value) });
    });
    if (!filters.length) fBox.style.display = 'none';
    var items = [], active = -1, token = 0, timer = null, isOpen = false;
    // The label of the record on show: while the box still holds it unchanged,
    // opening the dropdown browses everything instead of searching for it.
    var current = '';

    function values() {
      var v = {}; filters.forEach(function (f) { v[f.key] = f.multi ? f.value.slice() : f.value; }); return v;
    }
    function renderFilters() {
      fBox.innerHTML = filters.map(function (f, fi) {
        var allOn = f.multi && !f.value.length;
        return '<div class="fbdoc-pick-frow"><b>' + esc(f.label) + '</b>' +
          (f.multi ? '<button type="button" class="fbdoc-chip' + (allOn ? ' on' : '') + '" data-f="' + fi + '" data-v="*">All</button>' : '') +
          f.options.map(function (o) {
            var on = f.multi ? f.value.indexOf(String(o.value)) >= 0 : String(o.value) === f.value;
            return '<button type="button" class="fbdoc-chip' + (on ? ' on' : '') + '" data-f="' + fi + '" data-v="' + esc(o.value) + '">' + esc(o.label) + '</button>';
          }).join('') + '</div>';
      }).join('');
    }
    function place() {
      var r = input.getBoundingClientRect();
      var w = Math.min(640, Math.max(420, r.width));
      var left = Math.min(r.left, window.innerWidth - w - 8);
      box.style.left = (Math.max(8, left) + window.scrollX) + 'px';
      box.style.top = (r.bottom + window.scrollY + 3) + 'px';
    }
    function renderList(note) {
      if (note) { list.innerHTML = '<div class="fbdoc-pick-note">' + esc(note) + '</div>'; return; }
      list.innerHTML = items.map(function (it, i) {
        return '<div class="fbdoc-pick-row' + (i === active ? ' act' : '') + '" data-i="' + i + '">' +
          '<span class="lb">' + esc(it.label) + '</span><span class="sb">' + esc(it.sub || '') + '</span>' +
          (it.meta || []).map(function (m) { return '<span class="mt">' + esc(m) + '</span>'; }).join('') + '</div>';
      }).join('');
      var act = list.querySelector('.act'); if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest' });
    }
    function show() {
      if (!isOpen) { isOpen = true; renderFilters(); box.style.display = 'block'; }
      place();
    }
    function open() { show(); run(0); }
    function close() { isOpen = false; box.style.display = 'none'; }
    function run(delay) {
      clearTimeout(timer);
      var my = ++token, term = input.value.trim();
      if (term === current) term = '';
      timer = setTimeout(async function () {
        if (!isOpen) return;
        renderList('Searching…');
        try {
          var res = await opts.search(term, values());
          if (my !== token) return;
          items = res || []; active = items.length ? 0 : -1;
          renderList(items.length ? null : (term ? 'No match for "' + term + '"' : 'Nothing matches these filters'));
        } catch (e) {
          if (my !== token) return;
          items = []; log('picker search failed: ' + errText(e), 'warn');
          renderList('Search failed: ' + errText(e));
        }
      }, delay == null ? 200 : delay);
    }
    function pick(i) {
      var it = items[i]; if (!it) return;
      close();
      input.value = current = String(it.label);
      opts.onPick(it);
    }

    input.addEventListener('focus', function () { input.select(); open(); });
    input.addEventListener('click', function () { if (!isOpen) open(); });
    input.addEventListener('input', function () { show(); run(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { if (!isOpen) open(); else { active = Math.min(items.length - 1, active + 1); renderList(); } e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); renderList(); e.preventDefault(); }
      else if (e.key === 'Enter') {
        if (isOpen && active >= 0 && items.length) pick(active);
        else if (opts.onEnter) { close(); opts.onEnter(input.value.trim()); }
        e.preventDefault();
      } else if (e.key === 'Escape') { close(); }
    });
    if (opts.button) opts.button.addEventListener('click', function () { if (isOpen) close(); else { input.focus(); open(); } });
    // Clicks inside the dropdown must not blur the input (which would close it).
    box.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var row = e.target.closest('[data-i]');
      if (row) { pick(+row.getAttribute('data-i')); return; }
      var chip = e.target.closest('[data-f]');
      if (!chip) return;
      var f = filters[+chip.getAttribute('data-f')], v = chip.getAttribute('data-v');
      if (f.multi) {
        if (v === '*') f.value = [];
        else {
          var at = f.value.indexOf(v);
          if (at >= 0) f.value.splice(at, 1); else f.value.push(v);
          if (f.value.length === f.options.length) f.value = [];   // every option = All
        }
      } else f.value = v;
      renderFilters();
      if (opts.onFilters) opts.onFilters(values());
      run(0);
    });
    input.addEventListener('blur', function () { setTimeout(function () { if (document.activeElement !== input) close(); }, 150); });
    window.addEventListener('resize', function () { if (isOpen) place(); });
    return { open: open, close: close, filters: values,
             setCurrent: function (label) { current = String(label == null ? '' : label); input.value = current; } };
  }
  FBDoc.picker = picker;

  // ===================================================================
  //  REPORT — the paginated "PDF view" of a tabular BI report (the iReport
  //  ports). The report hands over the rows it already renders for print,
  //  and this lays them out the way the standard Jasper reports do:
  //    title band     company (13pt bold), title (16pt bold), the parameter
  //                   line(s) (10pt), centred; first sheet only unless
  //                   titleEveryPage (a jrxml that puts them in its page
  //                   header, as On Hand does)
  //    column header  repeated on every sheet
  //    rows           group rows (tr.rpt-grp) keep with their first line and
  //                   are repeated "(continued)" at the top of a sheet that
  //                   starts inside the group; sub-group rows (tr.rpt-sub)
  //                   the same within their group; the first of a run of
  //                   minor rows (tr.rpt-minor) keeps with the line above;
  //                   a row with data-pdf-break starts a new sheet
  //    summary        the totals row (foot), kept with the last line
  //    page footer    printed date and time left, "Page X of Y" right
  //  Columns are sized to the content. Each column's natural (unwrapped) and
  //  narrowest (wrapped) widths are measured: numbers never wrap (only their
  //  heading may), text columns share the spare width or wrap to fit. When
  //  even that is too wide the font steps down a point at a time (to 6.5pt);
  //  past that every column scales.
  //
  //  FBDoc.Report.render(mount, spec, pageSpec) -> paginate result
  //  FBDoc.Report.view(opts)  -> { mode, setMode, refresh, print }
  //    the App / PDF icon toggle (header) + paper bar + sheets, with the
  //    user's view, paper size and orientation remembered per report (the
  //    report's FBLib.Settings, user key "docView").
  //
  //  spec = { company, title, subtitle: text | [text], titleEveryPage,
  //           head: '<tr><th>…</tr>', rows: ['<tr …>…</tr>', …], foot: '<tr>…</tr>',
  //           empty: text shown when there are no rows,
  //           css: report CSS for the row content (scope it: .fbdoc-rpt-tbl …,
  //                .fbdoc-rpt-flow …),
  //           fontPt: the jrxml's detail font size (default 10; headings +1) }
  //  A report of several parts (subreports one after another) passes
  //  sections instead of head / rows / foot:
  //    sections: [{ heading?: text, newPage?: bool, head, rows, foot }   a table
  //               | { heading?, newPage?, flow: [html, …] }]            free blocks
  //  Each table's columns are fitted on their own; one font size serves all.
  //  Flow blocks (e.g. a row of address labels) are placed whole, never split.
  //  Heading cells may set data-pdf-min="<pt>": the column is never narrower
  //  (a blank "Count" column on a count sheet). A group row may set
  //  data-pdf-level="<n>" for a deeper heading (rpt-grp is 1, rpt-sub 2):
  //  part → section → category all repeat "(continued)" in order.
  //  pageFooter: false leaves the date / "Page X of Y" footer off (an
  //  original without one).
  // ===================================================================
  var RPT_CSS = [
    '.fbdoc-rpt-head{text-align:center;padding-bottom:6pt}',
    '.fbdoc-rpt-co{font-size:13pt;font-weight:700;line-height:18pt}',
    '.fbdoc-rpt-title{font-size:16pt;font-weight:700;line-height:22pt}',
    '.fbdoc-rpt-sub{font-size:10pt;line-height:13pt;white-space:pre-wrap}',
    '.fbdoc-rpt-foot{display:flex;justify-content:space-between;gap:12pt;font-size:9pt;line-height:15pt;padding-top:3pt}',
    '.fbdoc-rpt-empty{font-size:10pt;padding:14pt 0;text-align:center;color:#333}',
    '.fbdoc-rpt-sect{font-size:10pt;font-weight:700;padding:10pt 0 4pt}',
    '.fbdoc-rpt-flow{font-size:var(--fbdoc-td,10pt)}',
    '.fbdoc-rpt-tbl{--fbdoc-td:10pt;--fbdoc-th:11pt}',
    '.fbdoc-rpt-tbl th{font-size:var(--fbdoc-th);font-weight:700;text-align:left;padding:2pt 3pt;border:0;border-bottom:1pt solid #000;',
    '  vertical-align:bottom;background:none;color:#000}',
    '.fbdoc-rpt-tbl td{font-size:var(--fbdoc-td);padding:1.5pt 3pt;vertical-align:top}',
    '.fbdoc-rpt-tbl .num-cell{text-align:right;font-variant-numeric:tabular-nums}',
    '.fbdoc-rpt-tbl .nw{white-space:nowrap}',
    '.fbdoc-rpt-tbl a{color:inherit;text-decoration:none;font-weight:inherit}',
    '.fbdoc-rpt-tbl .rpt-toggle{display:none}',
    // A group heading wraps between its parts (name, description, counts),
    // never inside the name, and the cell's break-anywhere rule is lifted.
    // (break-word, unlike the cell's anywhere, keeps a flex item from
    // shrinking below its longest word, so names wrap only between words.)
    '.fbdoc-rpt-tbl .rpt-grp-inner{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 6pt;white-space:normal;overflow-wrap:break-word}',
    '.fbdoc-rpt-tbl .rpt-grp-meta{font-size:.85em;font-weight:400;color:#444}',
    '.fbdoc-rpt-tbl tr.rpt-grp td{font-weight:700;padding-top:6pt;border-bottom:.75pt solid #000;background:none}',
    '.fbdoc-rpt-tbl tr.rpt-sub td{font-weight:700;padding-top:3pt;background:none}',
    '.fbdoc-rpt-tbl tr.rpt-minor td{padding-top:0;padding-bottom:0;color:#222;background:none}',
    '.fbdoc-rpt-tbl tbody.fbdoc-total td{font-weight:700;border-top:1pt solid #000;padding-top:3pt}',
    '.fbdoc-rpt-tbl tr.fbdoc-cont .rpt-grp-inner::after{content:"(continued)";font-weight:400;font-style:italic;white-space:nowrap}',
    // A heading row without .rpt-grp-inner: the marker goes on its label
    // cell, the one spanning columns, else the first cell (never on a figure
    // the user has moved to the front).
    '.fbdoc-rpt-tbl tr.fbdoc-cont:not(:has(.rpt-grp-inner))>td[colspan]:not([colspan="1"]):not(:has(>div,>p))::after,',
    '.fbdoc-rpt-tbl tr.fbdoc-cont:not(:has(.rpt-grp-inner))>td[colspan]:not([colspan="1"])>:is(div,p):last-child::after,',
    '.fbdoc-rpt-tbl tr.fbdoc-cont:not(:has(.rpt-grp-inner)):not(:has(>td[colspan]:not([colspan="1"])))>td:first-child:not(:has(>div,>p))::after,',
    '.fbdoc-rpt-tbl tr.fbdoc-cont:not(:has(.rpt-grp-inner)):not(:has(>td[colspan]:not([colspan="1"])))>td:first-child>:is(div,p):last-child::after',
    '  {content:" (continued)";font-weight:400;font-style:italic;white-space:nowrap}',
    // measuring tables (never shown)
    '.fbdoc-mt-nw td,.fbdoc-mt-nw th,.fbdoc-mt-nw td *,.fbdoc-mt-nw th *{white-space:nowrap!important}',
    // scaled to fit (even 6.5pt was too wide): nothing may stay unwrapped
    '.fbdoc-squeezed td,.fbdoc-squeezed th,.fbdoc-squeezed td *,.fbdoc-squeezed th *{white-space:normal!important}',
    // the view: App / PDF toggle, paper bar, sheets
    '.fbdoc-view{display:none;flex:1 1 auto;min-height:0;flex-direction:column}',
    '.fbdoc-view.on{display:flex}',
    '.fbdoc-view>.fbdoc-canvas{flex:1 1 auto;min-height:0}',
    '.fbdoc-view-bar{flex:none;display:flex;align-items:center;gap:8px;padding:6px 20px;background:#fff;',
    '  border-bottom:1px solid var(--border,#E3E3E3);font-size:12.5px;color:var(--c-secondary,#506872)}',
    '.fbdoc-view-bar select{width:auto;min-width:0;padding:3px 6px;margin:0}',
    '.fbdoc-view-bar .fbdoc-vb-info{margin-left:6px}',
    '.fbdoc-view-bar .fbdoc-vb-spacer{flex:1 1 auto}',
    '.fbdoc-view-canvas.fbdoc-busy .fbdoc-stage{opacity:.55;transition:opacity .15s}',
    '.fbdoc-view-note{color:#fff;text-align:center;padding:40px 20px;font-size:13px}',
    '.fbdoc-toggle .hdr-btn svg{width:16px;height:16px}'
  ].join('\n');

  function ensureRptCss() {
    ensureCss();
    if (document.getElementById('fbdoc-rpt-css')) return;
    var st = document.createElement('style'); st.id = 'fbdoc-rpt-css'; st.textContent = RPT_CSS;
    document.head.appendChild(st);
  }
  // One style element each for the chosen font size and the report's own CSS:
  // printWindow copies every <style>, so the printout matches the screen.
  function setStyle(id, text) {
    var st = document.getElementById(id);
    if (!st) { st = document.createElement('style'); st.id = id; document.head.appendChild(st); }
    if (st.textContent !== text) st.textContent = text;
  }
  function setFontSize(pt) {
    setStyle('fbdoc-rpt-size', '.fbdoc-rpt-tbl{--fbdoc-td:' + pt + 'pt;--fbdoc-th:' + (pt + 1) + 'pt}');
  }
  function fontSteps(base) {
    var out = [], p = base;
    while (p >= 6.5) { out.push(p); p -= p > 7 ? 1 : 0.5; }
    if (out[out.length - 1] !== 6.5) out.push(6.5);
    return out;
  }
  async function fontsReady() {
    try {
      if (document.fonts && document.fonts.load) {
        var fam = '"FB Doc Open Sans"';
        await Promise.race([
          Promise.all([document.fonts.load('10pt ' + fam), document.fonts.load('bold 10pt ' + fam), document.fonts.load('italic 10pt ' + fam)]),
          new Promise(function (r) { setTimeout(r, 3000); })
        ]);
      }
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    } catch (_) {}
  }

  // Row class and the forced-break flag, from the row's own <tr> tag.
  function rowInfo(html) {
    var m = /^\s*<tr\b([^>]*)>/i.exec(html || '');
    var attrs = m ? m[1] : '';
    var cls = ' ' + ((/\bclass\s*=\s*"([^"]*)"/i.exec(attrs) || [])[1] || '') + ' ';
    var kind = cls.indexOf(' rpt-grp ') >= 0 ? 'grp' : cls.indexOf(' rpt-sub ') >= 0 ? 'sub' : cls.indexOf(' rpt-minor ') >= 0 ? 'minor' : 'line';
    // Heading depth: rpt-grp 1, rpt-sub 2; data-pdf-level="n" on either sets
    // a deeper level (part → section → category).
    var level = kind === 'grp' ? 1 : kind === 'sub' ? 2 : 0;
    var lv = /\bdata-pdf-level\s*=\s*"?(\d+)/i.exec(attrs);
    if (lv && level) level = Math.max(1, parseInt(lv[1], 10));
    return { kind: kind, level: level, brk: /\bdata-pdf-break\b/i.test(attrs) };
  }
  function contHtml(html) {
    return /^\s*<tr\b[^>]*\bclass\s*=\s*"/i.test(html)
      ? html.replace(/(<tr\b[^>]*\bclass\s*=\s*")/i, '$1fbdoc-cont ')
      : html.replace(/<tr\b/i, '<tr class="fbdoc-cont"');
  }
  // A spanning cell's text belongs to no one column: blank it for measuring.
  function blankSpans(html) {
    return String(html).replace(/(<td\b[^>]*\bcolspan\s*=\s*"?\s*(?:[2-9]|\d{2,})[^>]*>)[\s\S]*?(<\/td>)/gi, '$1$2');
  }

  // Natural and narrowest widths (pt, cell boxes) of every column, at the
  // font size currently set: body cells and headings measured apart.
  function measureColumns(head, rows, foot) {
    var PT = 72 / 96;
    var other = [], lines = [];
    rows.forEach(function (h) { (rowInfo(h).kind === 'line' || rowInfo(h).kind === 'minor' ? lines : other).push(h); });
    var MAXL = 2500;
    if (lines.length > MAXL) {
      var step = lines.length / MAXL, s = [];
      for (var i = 0; i < MAXL; i++) s.push(lines[Math.floor(i * step)]);
      lines = s;
    }
    // The totals row is measured in its own tbody.fbdoc-total: it prints bold.
    var body = other.slice(0, 1500).concat(lines).map(blankSpans)
      .concat(foot ? ['</tbody><tbody class="fbdoc-total">' + blankSpans(foot)] : []);
    var host = document.createElement('div');
    host.className = 'fbdoc-root fbdoc-measure';
    document.body.appendChild(host);
    try {
      host.innerHTML = '<table class="fbdoc-rpt-tbl" style="table-layout:auto;width:auto;border-collapse:separate;border-spacing:0"><thead>' + head + '</thead></table>';
      var ht = host.firstChild, hcells = ht.tHead && ht.tHead.rows[0] ? ht.tHead.rows[0].cells : [];
      var n = 0;
      Array.prototype.forEach.call(hcells, function (c) { n += c.colSpan || 1; });
      var zoom = ht.getBoundingClientRect().width / (ht.offsetWidth || 1) || 1;
      var w = function (cells) { return Array.prototype.map.call(cells, function (c) { return c.getBoundingClientRect().width / zoom * PT; }); };
      var num = Array.prototype.map.call(hcells, function (c) { return /\bnum-cell\b/.test(c.className); });
      var fixedMin = Array.prototype.map.call(hcells, function (c) { return parseFloat(c.getAttribute('data-pdf-min')) || 0; });
      // Headings: unwrapped, then as narrow as their longest word.
      ht.classList.add('fbdoc-mt-nw');
      var headMax = w(hcells);
      ht.classList.remove('fbdoc-mt-nw'); ht.style.width = '1px';
      var headMin = w(hcells);
      // Body: a first row of n empty cells carries the column widths.
      var probe = '<tr>' + new Array(n + 1).join('<td></td>') + '</tr>';
      host.insertAdjacentHTML('beforeend', '<table class="fbdoc-rpt-tbl fbdoc-mt-nw" style="table-layout:auto;width:auto;border-collapse:separate;border-spacing:0"><tbody>' +
        probe + body.join('') + '</tbody></table>');
      var bt = host.lastChild, pcells = bt.tBodies[0].rows[0].cells;
      var bodyMax = w(pcells);
      bt.classList.remove('fbdoc-mt-nw'); bt.style.width = '1px';
      var bodyMin = w(pcells);
      if (hcells.length !== n) {   // spanning headings: no per-column flags
        num = bodyMax.map(function () { return false; });
        fixedMin = bodyMax.map(function () { return 0; });
      }
      return { n: n, num: num, fixedMin: fixedMin, headMax: headMax, headMin: headMin, bodyMax: bodyMax, bodyMin: bodyMin };
    } finally { host.remove(); }
  }

  // Fit the measured columns to `width` pt. Every column starts at its
  // natural width. Spare width goes to the text columns, in proportion.
  // Short of width, number headings wrap first (two-line headings over
  // narrow figures, as the Jasper reports have them; figures never wrap),
  // then the WIDEST text columns narrow, all to one common cap (so a long
  // description wraps while part numbers and names stay on one line), never
  // below their longest word.
  // compact = it would not fit without scaling at this font size; the
  // widths are then scaled to fit, for the last font step.
  function fitMeasured(m, width) {
    var hmax = function (i) { return m.headMax.length === m.n ? m.headMax[i] : 0; };
    var hmin = function (i) { return m.headMin.length === m.n ? m.headMin[i] : 0; };
    var basis = [], min = [], text = [];
    for (var i = 0; i < m.n; i++) {
      var bmax = m.bodyMax[i] || 0, bmin = m.bodyMin[i] || 0;
      basis[i] = Math.max(bmax, hmax(i), 12) + 0.5;
      text[i] = !m.num[i];
      min[i] = text[i] ? Math.min(basis[i], Math.max(bmin, hmin(i), 28) + 0.5)
                       : Math.min(basis[i], Math.max(bmax, hmin(i)) + 0.5);
      // An unbreakable token (an email address, a URL) may not hold a text
      // column wider than 120pt: past that, the cell breaks it anywhere.
      if (text[i]) min[i] = Math.min(min[i], 120);
      var fm = (m.fixedMin && m.fixedMin[i]) || 0;
      if (fm) { basis[i] = Math.max(basis[i], fm); min[i] = Math.max(min[i], fm); }
    }
    var sum = function (a) { return a.reduce(function (s, x) { return s + x; }, 0); };
    var w = basis.slice(), compact = false;
    var spare = width - sum(w);
    if (spare > 0) {
      var tsum = sum(w.filter(function (x, j) { return text[j]; }));
      var base = tsum > 0 ? tsum : sum(w);
      w = w.map(function (x, j) { return (tsum > 0 && !text[j]) ? x : x + spare * x / base; });
    } else if (spare < 0) {
      // 1. Number columns narrow toward their figures (their headings wrap),
      //    only as far as needed: a heading line is cheaper than a wrapped row.
      var over = -spare;
      var room = sum(w.map(function (x, j) { return text[j] ? 0 : Math.max(0, x - min[j]); }));
      if (room > 0) {
        var take = Math.min(over, room);
        w = w.map(function (x, j) { return text[j] ? x : x - take * Math.max(0, x - min[j]) / room; });
      }
      if (sum(w) - width > 0.01) {
        // 2. Text columns: the cap C with sum(max(min, min(basis, C))) + rest = width.
        var capped = function (C) { return w.map(function (x, j) { return text[j] ? Math.max(min[j], Math.min(basis[j], C)) : x; }); };
        if (sum(capped(0)) <= width) {
          var lo = 0, hi = Math.max.apply(null, basis);
          for (var it = 0; it < 40; it++) { var mid = (lo + hi) / 2; if (sum(capped(mid)) > width) hi = mid; else lo = mid; }
          w = capped(lo);
        } else {
          w = capped(0);
          compact = true;
          var k = width / sum(w);
          w = w.map(function (x) { return x * k; });
        }
      }
    }
    // Round to 0.01pt; the last column takes the remainder so the sum is exact.
    w = w.map(function (x) { return Math.round(x * 100) / 100; });
    w[w.length - 1] = Math.round((w[w.length - 1] + width - sum(w)) * 100) / 100;
    return { widths: w, compact: compact };
  }

  function titleHtml(spec) {
    var sub = [].concat(spec.subtitle || []).filter(function (s) { return s != null && String(s) !== ''; });
    return '<div class="fbdoc-rpt-head">' +
      (spec.company ? '<div class="fbdoc-rpt-co">' + esc(spec.company) + '</div>' : '') +
      '<div class="fbdoc-rpt-title">' + esc(spec.title || '') + '</div>' +
      sub.map(function (s) { return '<div class="fbdoc-rpt-sub">' + esc(s) + '</div>'; }).join('') + '</div>';
  }

  // The spec's parts: its sections, or its one table. Headings lose the App
  // view's inline styles (screen min-widths): the page sets its own widths.
  function sectionsOf(spec) {
    var list = spec.sections || [{ head: spec.head, rows: spec.rows, foot: spec.foot }];
    return list.map(function (sec) {
      return Object.assign({}, sec, { head: sec.head ? String(sec.head).replace(/\s+style\s*=\s*"[^"]*"/gi, '') : '' });
    });
  }
  var isTable = function (sec) { return !!(sec && !sec.flow && sec.head && sec.rows && sec.rows.length); };

  // A table's rows as FBDoc blocks (see the band notes above).
  function tableBlocks(sec, key, blocks) {
    var rows = sec.rows, infos = rows.map(rowInfo);
    var open = [];   // the open heading at each level (index = level - 1)
    rows.forEach(function (html, i) {
      var info = infos[i], next = infos[i + 1];
      var b = { html: html, table: key };
      if (info.level) {
        // A heading closes every heading at its level and below, repeats
        // (continued) under its open parents, and keeps with the row after
        // it unless that row is a heading at its level or above (an empty,
        // e.g. collapsed, group).
        var L = info.level, id = key + 'h' + i;
        open = open.slice(0, L - 1);
        b.groupHeader = id; b.grp = open.filter(Boolean); b.repeatHtml = contHtml(html);
        b.kwn = !!next && !(next.level && next.level <= L);
        open[L - 1] = id;
      } else {
        b.grp = open.filter(Boolean);
        if (info.kind === 'minor' && i > 0 && infos[i - 1].kind !== 'minor') b.kwp = true;
      }
      if (info.brk && i > 0) b.brk = true;
      blocks.push(b);
    });
    if (sec.foot) blocks.push({ html: sec.foot, table: key, cls: 'fbdoc-total', kwp: true });
  }

  // The FBDoc document for a report spec, at the chosen column widths
  // (one list per section; null for flow sections).
  function reportDoc(spec, sections, widths, squeezed) {
    var stamp = printedAt(new Date());
    var blocks = [], tables = {}, multi = sections.length > 1;
    var empty = function (text) { return { html: '<div class="fbdoc-rpt-empty">' + esc(text || 'No data matches these filters.') + '</div>' }; };
    sections.forEach(function (sec, si) {
      var hasFlow = !!(sec.flow && sec.flow.length);
      if (multi && !sec.heading && !hasFlow && !isTable(sec)) return;     // an untitled empty part prints nothing
      var brk = !!sec.newPage && blocks.length > 0;
      if (sec.heading) { blocks.push({ html: '<div class="fbdoc-rpt-sect">' + esc(sec.heading) + '</div>', kwn: true, brk: brk }); brk = false; }
      var from = blocks.length;
      if (hasFlow) sec.flow.forEach(function (h) { blocks.push({ html: '<div class="fbdoc-rpt-flow">' + h + '</div>' }); });
      else if (isTable(sec)) {
        var key = 's' + si;
        tables[key] = { colgroup: widths && widths[si] ? colgroup(widths[si]) : '', thead: '<thead>' + sec.head + '</thead>',
                        className: 'fbdoc-rpt-tbl' + (squeezed ? ' fbdoc-squeezed' : '') };
        tableBlocks(sec, key, blocks);
      } else blocks.push(empty(sec.empty || spec.empty));
      if (brk && blocks[from]) blocks[from].brk = true;
    });
    if (!blocks.length) blocks.push(empty(spec.empty));
    return {
      id: 'report',
      pageHeader: function (ctx) { return (ctx.first || spec.titleEveryPage) ? titleHtml(spec) : ''; },
      pageFooter: function (ctx) {
        if (spec.pageFooter === false) return '';   // an original without a page footer
        return '<div class="fbdoc-rpt-foot"><span>' + esc(stamp) + '</span><span>Page ' + ctx.pageNo + ' of ' + ctx.pageCount + '</span></div>';
      },
      tables: tables,
      blocks: blocks
    };
  }

  /** Lay a report spec out into sheets inside `mount`. */
  async function renderReport(mount, spec, page) {
    ensureRptCss();
    await fontsReady();
    var g = geometry(page, {});
    setStyle('fbdoc-rpt-own', spec.css || '');
    var sections = sectionsOf(spec), chosen = null;
    if (sections.some(isTable)) {
      var steps = fontSteps(spec.fontPt || 10);
      for (var i = 0; i < steps.length; i++) {
        setFontSize(steps[i]);
        var fits = sections.map(function (sec) { return isTable(sec) ? fitMeasured(measureColumns(sec.head, sec.rows, sec.foot), g.CWpt) : null; });
        chosen = { pt: steps[i], fits: fits, compact: fits.some(function (f) { return f && f.compact; }) };
        if (!chosen.compact) break;
      }
    } else setFontSize(spec.fontPt || 10);
    var widths = chosen ? chosen.fits.map(function (f) { return f ? f.widths : null; }) : null;
    var res = await paginate({ mount: mount, page: page, docs: [reportDoc(spec, sections, widths, !!(chosen && chosen.compact))] });
    res.fontPt = chosen ? chosen.pt : (spec.fontPt || 10);
    res.scaled = !!(chosen && chosen.compact);
    return res;
  }

  var PAPERS = ['Letter', 'Legal', 'A4', 'A3', 'A5', 'Tabloid', 'Executive'];
  var ICON = {
    app: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/></svg>',
    pdf: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
    portrait: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="18" rx="1.5"/></svg>',
    landscape: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="1.5"/></svg>'
  };
  var PREF_KEY = 'docView';

  /**
   * The App / PDF view of a report.
   * opts = {
   *   app:          the App view element (hidden in PDF view); the sheets go
   *                 right after it, a child of <body>
   *   toggleBefore: header element the toggle is placed before (with a divider)
   *   page:         the original's paper { size: 'Letter', orientation: 'landscape' }
   *   doc():        the report spec (above), built from the current state
   *   title():      the print window's title (optional)
   *   onMode(mode): called after the view changes (optional)
   * }
   */
  function reportView(opts) {
    ensureRptCss();
    var std = { size: (opts.page && opts.page.size) || 'Letter', orientation: (opts.page && opts.page.orientation) === 'landscape' ? 'landscape' : 'portrait' };
    var saved = {};
    try { var v = global.FBLib && global.FBLib.Settings && global.FBLib.Settings.resolve(PREF_KEY); if (v && typeof v === 'object') saved = v; } catch (_) {}
    var state = {
      mode: saved.mode === 'pdf' ? 'pdf' : 'app',
      size: PAPERS.indexOf(saved.size) >= 0 ? saved.size : std.size,
      orientation: saved.orientation === 'landscape' || saved.orientation === 'portrait' ? saved.orientation : std.orientation
    };
    function save() {
      try {
        global.FBLib.Settings.setUserKey(PREF_KEY, { mode: state.mode, size: state.size, orientation: state.orientation });
        global.FBLib.Settings.saveUser();
      } catch (_) {}
    }
    function pageSpec() {
      return resolvePage(state.size + ' ' + state.orientation, { fallback: std.size, margin: 'document' });
    }

    // ---- header toggle
    var tog = document.createElement('span');
    tog.className = 'split-btn fbdoc-toggle';
    tog.innerHTML =
      '<button type="button" class="hdr-btn hdr-btn-icon" data-view="app" title="App view: the interactive report">' + ICON.app + '</button>' +
      '<button type="button" class="hdr-btn hdr-btn-icon" data-view="pdf" title="PDF view: printable pages laid out like the standard report">' + ICON.pdf + '</button>';
    var before = opts.toggleBefore;
    if (before && before.parentNode) {
      before.parentNode.insertBefore(tog, before);
      var dv = document.createElement('span'); dv.className = 'hdr-divider';
      before.parentNode.insertBefore(dv, before);
    }

    // ---- the PDF view: paper bar + sheets
    var wrap = document.createElement('div');
    wrap.className = 'fbdoc-view';
    wrap.innerHTML =
      '<div class="fbdoc-view-bar">' +
        '<span>Paper</span><select class="fbdoc-vb-paper" title="Paper size">' +
          PAPERS.map(function (p) { return '<option value="' + p + '">' + p + '</option>'; }).join('') + '</select>' +
        '<span class="split-btn">' +
          '<button type="button" class="hdr-btn hdr-btn-icon" data-orient="portrait" title="Portrait">' + ICON.portrait + '</button>' +
          '<button type="button" class="hdr-btn hdr-btn-icon" data-orient="landscape" title="Landscape">' + ICON.landscape + '</button>' +
        '</span>' +
        '<span class="fbdoc-vb-info"></span><span class="fbdoc-vb-spacer"></span>' +
        '<button type="button" class="hdr-btn fbdoc-vb-std" title="The standard report\'s paper: ' + esc(std.size + ' ' + std.orientation) + '">Standard paper</button>' +
      '</div>' +
      '<div class="fbdoc-canvas fbdoc-view-canvas"></div>';
    opts.app.parentNode.insertBefore(wrap, opts.app.nextSibling);
    var bar = wrap.firstChild, canvas = wrap.lastChild;
    var paperSel = bar.querySelector('.fbdoc-vb-paper'), info = bar.querySelector('.fbdoc-vb-info'), stdBtn = bar.querySelector('.fbdoc-vb-std');

    function syncControls() {
      Array.prototype.forEach.call(tog.querySelectorAll('[data-view]'), function (b) { b.classList.toggle('active', b.getAttribute('data-view') === state.mode); });
      paperSel.value = state.size;
      Array.prototype.forEach.call(bar.querySelectorAll('[data-orient]'), function (b) { b.classList.toggle('active', b.getAttribute('data-orient') === state.orientation); });
      stdBtn.style.display = (state.size === std.size && state.orientation === std.orientation) ? 'none' : '';
    }

    var timer = null, running = false, dirty = false, laidOut = false;
    function refresh(now) {
      laidOut = false;
      if (state.mode !== 'pdf') return;
      clearTimeout(timer);
      timer = setTimeout(run, now ? 0 : 120);
    }
    async function run() {
      timer = null;
      if (running) { dirty = true; return; }
      running = true; dirty = false;
      canvas.classList.add('fbdoc-busy');
      info.textContent = 'Laying out the pages…';
      try {
        var spec = opts.doc();
        if (!spec) { canvas.innerHTML = '<div class="fbdoc-view-note">Nothing to show yet.</div>'; info.textContent = ''; }
        else {
          var res = await renderReport(canvas, spec, pageSpec());
          laidOut = !dirty;
          info.textContent = res.sheets + (res.sheets === 1 ? ' page' : ' pages') + ' · ' + state.size + ' ' + state.orientation +
            ' · ' + res.fontPt + 'pt' + (res.scaled ? ' (scaled to fit)' : '');
        }
      } catch (e) {
        log('report layout failed: ' + errText(e), 'error');
        info.textContent = 'The pages could not be laid out: ' + errText(e);
      } finally {
        running = false;
        canvas.classList.remove('fbdoc-busy');
        if (dirty) run();
      }
    }

    function setMode(mode, persist) {
      state.mode = mode === 'pdf' ? 'pdf' : 'app';
      var pdf = state.mode === 'pdf';
      opts.app.style.display = pdf ? 'none' : '';
      wrap.classList.toggle('on', pdf);
      document.body.classList.toggle('fbdoc-on', pdf);
      syncControls();
      if (persist) save();
      if (pdf) refresh(true);
      if (opts.onMode) { try { opts.onMode(state.mode); } catch (_) {} }
    }

    tog.addEventListener('click', function (e) {
      var b = e.target.closest('[data-view]');
      if (b && b.getAttribute('data-view') !== state.mode) setMode(b.getAttribute('data-view'), true);
    });
    paperSel.addEventListener('change', function () { state.size = paperSel.value; syncControls(); save(); refresh(true); });
    bar.addEventListener('click', function (e) {
      var o = e.target.closest('[data-orient]');
      if (o && o.getAttribute('data-orient') !== state.orientation) { state.orientation = o.getAttribute('data-orient'); syncControls(); save(); refresh(true); }
      if (e.target.closest('.fbdoc-vb-std')) { state.size = std.size; state.orientation = std.orientation; syncControls(); save(); refresh(true); }
    });

    // Print the pages: the ones on show when they are current, else laid out
    // off screen. The print window opens now, during the click.
    async function print() {
      var spec = opts.doc();
      if (!spec) return null;
      var title = (opts.title && opts.title()) || spec.title || document.title;
      var w = window.open('', '_blank');
      if (!w) { log('print: popup blocked', 'warn'); return null; }
      try { w.document.write('<!DOCTYPE html><title>' + esc(title) + '</title><p style="font:13px sans-serif;padding:20px">Preparing the pages…</p>'); } catch (_) {}
      if (state.mode === 'pdf' && laidOut && !running && !timer) return printWindow({ mount: canvas, title: title, win: w });
      var tmp = document.createElement('div');
      tmp.style.cssText = 'position:fixed;left:-30000px;top:0;width:1400px;height:900px;overflow:hidden';
      document.body.appendChild(tmp);
      try {
        await renderReport(tmp, spec, pageSpec());
        return printWindow({ mount: tmp, title: title, win: w });
      } catch (e) {
        log('print failed: ' + errText(e), 'error');
        try { w.close(); } catch (_) {}
        throw e;
      } finally { tmp.remove(); }
    }

    syncControls();
    setMode(state.mode, false);
    return {
      mode: function () { return state.mode; },
      setMode: function (m) { setMode(m, true); },
      refresh: function () { refresh(false); },
      print: print,
      paper: function () { return { size: state.size, orientation: state.orientation }; }
    };
  }

  FBDoc.Report = {
    render: renderReport, view: reportView, measure: measureColumns, fit: fitMeasured, doc: reportDoc, sections: sectionsOf,
    rowInfo: rowInfo, fontSteps: fontSteps, PAPERS: PAPERS, CSS: RPT_CSS
  };

  global.FBDoc = FBDoc;
  if (typeof module === 'object' && module.exports) module.exports = FBDoc;
})(typeof window !== 'undefined' ? window : globalThis);
