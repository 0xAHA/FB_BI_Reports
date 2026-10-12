/*
 fb-doc.js  —  Printable-document engine for Fishbowl BI paperwork (namespace: FBDoc).
 PROOF OF CONCEPT (Other_NOT_FOR_PRODUCTION/Paperwork_POC). Not deployed.

 Replaces JasperReports paperwork with HTML that prints and saves as PDF from the
 BI Report module's own Print / Save / Email buttons. The page IS the paper, so
 the engine lays the document out into fixed-size sheets itself:

   FBDoc.param        read a Fishbowl report-setting value (substituted into the
                      page before it loads), with a fallback when unsubstituted
   FBDoc.launch       the module + record a host opened this report from
                      (window.FB_LAUNCH; spec in LAUNCH_CONTEXT.md)
   FBDoc.page        paper size from the PRINT setting (name or CSS form)
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
  FBDoc.VERSION = 'poc-2026.10.08';

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
  //  Launch context
  //  A host that opens this report from a Fishbowl module (the report_btn
  //  plugin's Reports > Apps entries) sets window.FB_LAUNCH before any page
  //  script runs:
  //    { v: 1, host, module: 'SO', moduleName, table?, id, num?, reportId?, params? }
  //  module is the record type as a Fishbowl setting code, id its primary key in
  //  table (the host's table wins; else MODULES below; null when unknown).
  //  Every module sends a launch; one with no record type gets a code made from
  //  its name (e.g. CALENDAR) and no table.
  //  A report lists the modules it serves in an fb-launch meta tag in its head
  //  (content "SO"); the host reads that, this code does not. Never write that
  //  tag literally here: this file is inlined into pages and the host takes the
  //  first one it finds. Spec: LAUNCH_CONTEXT.md.
  //  get() normalises the payload (object or JSON string; id <= 0 becomes 0,
  //  meaning "opened from the module with no record"), or returns null.
  // ===================================================================
  var LAUNCH_MODULES = {
    SO: 'so', PO: 'po', MO: 'mo', WO: 'wo', TO: 'xo', PICK: 'pick', SHIP: 'ship',
    RECEIPT: 'receipt', RMA: 'rma', PART: 'part', PROD: 'product', BOM: 'bom',
    CUST: 'customer', VEND: 'vendor', CAR: 'carrier', LOC: 'location',
    LG: 'locationgroup', CLASS: 'qbclass', USER: 'sysuser', USER_GROUP: 'usergroup',
    COMPANY: 'company', CURRENCY: 'currency', PRICING_RULE: 'pricingrule',
    TAX_RATE: 'taxrate', PAYMENT_TERMS: 'paymentterms', UOM: 'uom'
  };
  function launchGet(win) {
    win = win || global;
    var raw = win ? win.FB_LAUNCH : null;
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (_) { return null; } }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var module = String(raw.module == null ? '' : raw.module).trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/.test(module)) return null;
    var id = parseInt(raw.id, 10), params = {};
    if (raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params)) {
      Object.keys(raw.params).forEach(function (k) { params[k] = raw.params[k]; });
    }
    return {
      v: parseInt(raw.v, 10) || 1,
      host: raw.host == null ? '' : String(raw.host),
      module: module,
      moduleName: raw.moduleName == null ? '' : String(raw.moduleName),
      table: /^[a-z][a-z0-9_]*$/i.test(String(raw.table == null ? '' : raw.table)) ? String(raw.table).toLowerCase()
           : Object.prototype.hasOwnProperty.call(LAUNCH_MODULES, module) ? LAUNCH_MODULES[module] : null,
      id: id > 0 ? id : 0,
      num: raw.num == null ? '' : String(raw.num).trim(),
      reportId: parseInt(raw.reportId, 10) > 0 ? parseInt(raw.reportId, 10) : 0,
      params: params
    };
  }
  FBDoc.launch = {
    MODULES: LAUNCH_MODULES,
    get: launchGet,
    // The launched record's id when the launch came from `code`'s module, else 0.
    id: function (code, win) {
      var l = launchGet(win);
      return l && l.module === String(code).toUpperCase() ? l.id : 0;
    },
    // A host-supplied override, keyed by the report setting's title.
    param: function (name, fallback, win) {
      var l = launchGet(win);
      return l && Object.prototype.hasOwnProperty.call(l.params, name) ? l.params[name] : fallback;
    }
  };

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
    '@media print{',
    '  html,body{margin:0!important;padding:0!important;height:auto!important;min-height:0!important;overflow:visible!important;background:#fff!important;display:block!important}',
    '  body>*:not(.fbdoc-canvas){display:none!important}',
    '  .fbdoc-canvas{padding:0!important;background:none!important;overflow:visible!important;height:auto!important;position:static!important}',
    '  .fbdoc-stage{width:auto!important;height:auto!important}',
    // Nothing may be wider than the printable area in print, or the print path
    // shrinks the whole page to fit (the screen wrappers carry inline widths).
    '  .fbdoc-scaler{transform:none!important;position:static!important;width:auto!important}',
    '  .fbdoc-paper{margin:0!important;padding:0!important;width:auto!important;height:auto!important;box-shadow:none!important}',
    '  .fbdoc-sheet{outline:none!important}',
    '}'
  ].join('\n');

  // Inserted FIRST in <head>: a report's own rules of equal specificity (e.g. a
  // header cell's vertical-align) must win over these defaults. printWindow
  // copies the styles in document order, so the print keeps the same cascade.
  function ensureCss() {
    if (document.getElementById('fbdoc-css')) return;
    var st = document.createElement('style'); st.id = 'fbdoc-css'; st.textContent = CSS;
    document.head.insertBefore(st, document.head.firstChild);
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
        var hdrH = hOf(m.bands.header), ftrH = hOf(m.bands.footer), lastH = hOf(m.bands.last);
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
        var cap = function (p, last) { return g.innerH - hdrH - (last ? lastH : ftrH) - slack; };
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
            // Pages style continued fragments with [data-fbdoc-cont] (e.g. hide a
            // "Notes:" label, or show "(continued)").
            if (fr.cont) fr.node.setAttribute('data-fbdoc-cont', '');
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
    var band = function (content, last) {
      if (!content) return null;
      var d = document.createElement('div'); d.className = 'fbdoc-band';
      appendContent(d, content, Object.assign({}, ctx0, { last: !!last }));
      wrap.appendChild(d); return d;
    };
    var bands = { header: band(doc.pageHeader), footer: band(doc.pageFooter), last: band(doc.lastPageFooter || doc.pageFooter, true) };
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
      '</head><body><div class="fbdoc-canvas"><div class="fbdoc-stage">' + clone.outerHTML + '</div></div></body></html>';
    var w = window.open('', '_blank');
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
  //  App shell — the screen around one paperwork document.
  //  A report supplies only what is particular to its document; the shell owns
  //  the toolbar, record picker, Settings drawer (options, paper, flags),
  //  settings store, stock presets, launch handling, load/render and print.
  //
  //  var APP = FBDoc.app({
  //    title: 'Sales Order',                 toolbar title before a record loads
  //    record: { code: 'SO',                 FB_LAUNCH module code(s) taken (string or array)
  //              table: 'so', numColumn: 'num', noun: 'order',
  //              setting: 'set-so',          id of the text/plain block holding the record setting
  //              label: function (model) {}  the picker text for a loaded record (default model.h.num)
  //              newest: async function () {} optional start record when nothing else applies },
  //    flags: [{ key: 'invoice', label: 'Invoice', title: '…', setting: 'set-invoice', reloadEnv: true }],
  //    sys: ['SO Notice'],                   extra sysproperties (env.sys[key])
  //    env: function (env, sys) {},          add fields to env
  //    presets: function (flags) { return ['../reports/…/X.jasper'] },
  //    defaults: function (env, flags) { return { Option: value } },
  //    options: [['Group', [['Name', 'Label', choices?], …]], …]   no choices = checkbox;
  //              choices = ['a', 'b'] or [['value', 'Label'], …] (a select), or 'text' (a text box),
  //    optionsIntro: 'the stock Sales Order report',
  //    fetch: async function (id, app) { return model },
  //    build: function (model, geom, app) { return doc },   for FBDoc.paginate
  //    picker: { placeholder, filters: async function (saved) {}, where: function (f) {}, alias: 'so',
  //              search: async function (term, f, app) {} }
  //  });
  //  env: edition / isAU / isUS / isCaOrIntl, multiCurrency, price / cost / total / qty /
  //       date patterns, barcodeDI, useCode, logo, sys (every sysproperty read).
  //  app: env, flags, opt(name), optSource(name), label(key, default), debug(msg, type),
  //       setTitle(text), load(id), rerender(), id, model, launched (true when a host
  //       opened the report on a record: the record is then fixed and the toolbar
  //       shows only Print and Settings).
  // ===================================================================
  var APP_CSS = [
    'html,body{margin:0;padding:0;height:100%}',
    'body{font-family:"Inter",-apple-system,"Segoe UI",sans-serif;font-size:13px;display:flex;flex-direction:column;height:100vh;background:var(--bg-1,#f4f6f7);padding-bottom:var(--debug-drawer-h,0px)}',
    'header h1{font-size:16px;font-weight:700;margin:0;line-height:1.15}',
    '#statusLine{font-size:12px;color:var(--c-tertiary,#6b7b83);margin:2px 0 0}',
    '.hdr-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.fbd-pick{position:relative;display:flex;align-items:center;gap:4px}',
    '.fbd-pick input{width:190px;padding:6px 9px;border:1px solid var(--border-strong,#c9d1d6);border-radius:7px;font:inherit;font-size:12px}',
    '.fbd-pick button,.fbd-select{padding:6px 9px;border:1px solid var(--border-strong,#c9d1d6);border-radius:7px;background:#fff;cursor:pointer;font:inherit;font-size:12px}',
    '.fbd-check{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:var(--c-secondary,#415157);cursor:pointer}',
    'body.fbd-launched .fbd-browse{display:none!important}',
    '#docCanvas{flex:1 1 auto;min-height:0}',
    '#docEmpty{padding:60px 20px;text-align:center;color:#8a989f;font-size:14px}',
    '.opt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px 22px}',
    '.opt-group h4{margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--c-secondary,#415157);border-bottom:1px solid var(--border,#e3e7e9);padding-bottom:4px}',
    '.opt-row{display:flex;align-items:center;gap:7px;font-size:12px;padding:2px 0}',
    '.opt-row select{font:inherit;font-size:12px;padding:2px 4px}',
    '.opt-src{margin-left:auto;font-size:10px;font-weight:700;color:#8a989f}',
    '.opt-src.j{color:#2d9cdb}.opt-src.c{color:#c26a00}.opt-src.s{color:#1f8a4c}',
    '.fbd-docset{display:flex;flex-wrap:wrap;gap:10px 22px;align-items:center;margin:0 0 14px;padding:0 0 12px;border-bottom:1px solid var(--border,#e3e7e9)}',
    '.ds-btn{padding:7px 13px;font-size:12px;border-radius:7px;border:1px solid var(--border-strong,#c9d1d6);background:#fff;cursor:pointer;font-family:inherit;font-weight:600}',
    '.ds-btn-primary{background:var(--color-primary,#2d9cdb);color:#fff;border-color:var(--color-primary,#2d9cdb)}',
    '.ds-btn-admin{background:var(--acc-orange-bg,#fff3e0);border-color:var(--acc-orange,#f0a040)}'
  ].join('\n');
  var APP_PAPERS = ['A4', 'A4 landscape', 'Letter', 'Letter landscape', 'Legal', 'A5'];
  var APP_SYS = ['QBVersion', 'Multi Currency', 'REPORT_DECIMAL_PRICE', 'REPORT_DECIMAL_COST', 'REPORT_DECIMAL_TOTAL', 'REPORT_DECIMAL_QTY',
    'REPORT_DATE_FORMAT', 'Barcodes have DI', 'Currency Use Code'];

  function app(cfg) {
    var A = { cfg: cfg, env: null, flags: {}, model: null, id: 0, launched: false };
    var rec = cfg.record || {};
    var codes = [].concat(rec.code || []).map(function (c) { return String(c).toUpperCase(); });
    var noun = rec.noun || 'record';
    var defaults = {}, presetVals = {}, company = {}, session = {};
    var loadTok = 0, pageOverride = '', pick = null, launchedFrom = '', debugApi = null;
    var storeKey = cfg.storageKey || (global.FB_REPORT && global.FB_REPORT.key) || 'cdx.bi.paperwork';
    var L = global.FBLib;

    function $(id) { return document.getElementById(id); }
    function status(t) { var el = $('statusLine'); if (el) el.textContent = t; }
    A.debug = function (m, t) { try { L.Common.debugLog(m, t); } catch (_) {} };
    function resolve(k, d) { try { var v = L.Settings.resolve(k); return v == null ? d : v; } catch (_) { return d; } }
    function setUser(k, v) { try { L.Settings.setUserKey(k, v); L.Settings.saveUser(); } catch (_) {} }
    try {
      L.Settings.init({ masterStorage: 'userProperties', userKey: storeKey + '.user.v1', masterKey: storeKey + '.master.v1',
        defaults: { v: 1, lastId: 0, seenSetting: '', showDebug: false, pickFilters: null, paper: '' } });
    } catch (e) { console.warn('FBLib.Settings.init failed:', e); }

    // ---- options: session > company (admin) > stock preset > jrxml default ----
    function coerce(name, raw) {
      var d = defaults[name];
      if (typeof d === 'boolean') return String(raw).toLowerCase() === 'true';
      if (typeof d === 'number') { var n = parseInt(raw, 10); return isNaN(n) ? d : n; }
      return raw;
    }
    function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
    A.opt = function (name) {
      if (own(session, name)) return session[name];
      if (own(company, name)) return company[name];
      if (presetVals[name] != null && String(presetVals[name]) !== '') return coerce(name, presetVals[name]);
      return defaults[name];
    };
    A.optSource = function (name) {
      return own(session, name) ? 's' : own(company, name) ? 'c' : (presetVals[name] != null && String(presetVals[name]) !== '') ? 'j' : 'd';
    };
    // FieldTitle:* — '' or '%' means "use the default label".
    A.label = function (key, dflt) {
      var v = session['FieldTitle:' + key];
      if (v == null) v = company['FieldTitle:' + key];
      if (v == null) v = presetVals['FieldTitle:' + key];
      return (v == null || v === '' || v === '%') ? dflt : v;
    };
    A.setTitle = function (t) { var el = $('docTitle'); if (el) el.textContent = t; };

    // ---- environment (system properties, edition, formats, presets, logo) ----
    async function loadEnv() {
      var s = await sys(APP_SYS.concat(cfg.sys || []));
      var edition = String(s['QBVersion'] || 'US').toUpperCase();
      var env = {
        sys: s, edition: edition, isAU: edition === 'AU', isUS: edition === 'US', isCaOrIntl: edition !== 'US' && edition !== 'AU',
        multiCurrency: String(s['Multi Currency']).toLowerCase() === 'true',
        price: s['REPORT_DECIMAL_PRICE'] || '$#,##0.00', total: s['REPORT_DECIMAL_TOTAL'] || '$#,##0.00',
        cost: s['REPORT_DECIMAL_COST'] || s['REPORT_DECIMAL_PRICE'] || '$#,##0.00',
        qty: s['REPORT_DECIMAL_QTY'] || '#,##0.##', date: s['REPORT_DATE_FORMAT'] || 'MM/dd/yyyy',
        barcodeDI: String(s['Barcodes have DI']).toLowerCase() === 'true',
        useCode: String(s['Currency Use Code']).toLowerCase() === 'true'
      };
      if (cfg.env) cfg.env(env, s);
      var pv = {};
      var paths = cfg.presets ? cfg.presets(A.flags) : [];
      for (var i = 0; i < paths.length; i++) {
        try { Object.assign(pv, await presets(paths[i])); } catch (e) { A.debug('stock presets unavailable (' + paths[i] + '): ' + errText(e), 'warn'); }
      }
      try { env.logo = await companyLogo(); } catch (e) { env.logo = null; }
      A.env = env; presetVals = pv;
      defaults = cfg.defaults ? cfg.defaults(env, A.flags) : {};
    }

    // ---- paper: the PRINT setting (size + orientation), or the user's choice ----
    function settingPage() { return resolvePage(param.fromEl('set-print', 'A4'), { fallback: 'A4', margin: 'document' }); }
    function pageLabel(spec) {
      return (spec.name || (Math.round(spec.wMm) + '×' + Math.round(spec.hMm) + ' mm')) + (spec.orientation === 'landscape' ? ' landscape' : '');
    }
    function pageSpec() { return pageOverride ? resolvePage(pageOverride, { fallback: 'A4', margin: 'document' }) : settingPage(); }

    // ---- load / render ----
    A.fetch = function (id) { return cfg.fetch(id, A); };
    A.load = async function (id) {
      id = parseInt(id, 10);
      if (!id) return;
      var tok = ++loadTok;
      A.id = id;
      status('Loading…');
      try {
        var m = await cfg.fetch(id, A);
        if (tok !== loadTok) return;
        A.model = m;
        if (!A.launched) setUser('lastId', id);
        var lbl = rec.label ? rec.label(m) : (m && m.h && m.h.num != null ? m.h.num : String(id));
        if (pick) pick.setCurrent(lbl); else if ($('recInput')) $('recInput').value = lbl;
        await render(m, tok);
      } catch (e) {
        if (tok !== loadTok) return;
        A.debug('load ' + id + ': ' + errText(e) + (e && e.stack ? ' | ' + e.stack : ''), 'error');
        status('Error — ' + errText(e));
      }
    };
    async function render(m, tok) {
      var spec = pageSpec();
      var doc = cfg.build(m, geometry(spec), A);
      A.lastDoc = doc;
      var res = await paginate({ mount: $('docCanvas'), page: spec, docs: [doc] });
      if (tok != null && tok !== loadTok) return res;
      status(res.sheets + ' page' + (res.sheets === 1 ? '' : 's') + ' · ' + pageLabel(spec) + ' · ' + res.ms + ' ms' +
        (res.warnings.length ? ' · ' + res.warnings.length + ' warning(s), see debug' : '') +
        (A.launched ? ' · from ' + launchedFrom + ' module' : ''));
      spec.warnings.forEach(function (w) { A.debug('page: ' + w, 'warn'); });
      return res;
    }
    A.render = render;
    A.rerender = function () { if (A.model) return render(A.model, loadTok); };

    // ---- record lookups ----
    async function numToId(txt) {
      if (!rec.table) return 0;
      var rows = await q('SELECT id FROM ' + rec.table + ' WHERE ' + (rec.numColumn || 'num') + ' = ? LIMIT 1', [String(txt).trim()]);
      return rows.length ? parseInt(rows[0].id, 10) : 0;
    }
    async function step(dir) {
      if (!A.id || !rec.table) return;
      var P = cfg.picker || {}, alias = P.alias || rec.table;
      var where = P.where ? P.where(pick ? pick.filters() : null) : [];
      where.push(alias + '.id ' + (dir > 0 ? '>' : '<') + ' ?');
      var rows = await q('SELECT ' + alias + '.id FROM ' + rec.table + ' ' + alias + ' WHERE ' + where.join(' AND ') +
        ' ORDER BY ' + alias + '.id ' + (dir > 0 ? 'ASC' : 'DESC') + ' LIMIT 1', [A.id]);
      if (rows.length) A.load(rows[0].id);
      else status('No ' + (dir > 0 ? 'next' : 'previous') + ' ' + noun + ' within the picker filters');
    }

    // ---- Settings drawer ----
    function renderOptions() {
      var grid = $('optGrid');
      if (!grid) return;
      grid.innerHTML = (cfg.options || []).map(function (g) {
        return '<div class="opt-group"><h4>' + esc(g[0]) + '</h4>' + g[1].map(function (o) {
          var name = o[0], v = A.opt(name), src = A.optSource(name);
          var ctl = o[2] === 'text'
            ? '<input type="text" data-opt="' + esc(name) + '" value="' + esc(v == null ? '' : v) + '" style="font:inherit;font-size:12px;padding:2px 5px;width:150px">'
            : o[2]
            ? '<select data-opt="' + esc(name) + '">' + o[2].map(function (x) {
                var val = Array.isArray(x) ? x[0] : x, lbl = Array.isArray(x) ? x[1] : x;
                return '<option value="' + esc(val) + '"' + (String(v).toLowerCase() === String(val).toLowerCase() ? ' selected' : '') + '>' + esc(lbl) + '</option>';
              }).join('') + '</select>'
            : '<input type="checkbox" data-opt="' + esc(name) + '"' + (v ? ' checked' : '') + '>';
          return '<label class="opt-row">' + ctl + '<span>' + esc(o[1]) + '</span><span class="opt-src ' + src + '" title="' +
            ({ s: 'changed this session', c: 'saved for everyone', j: 'stock report preset', d: 'jrxml default' })[src] + '">' + src.toUpperCase() + '</span></label>';
        }).join('') + '</div>';
      }).join('');
    }
    function onOptionChange(e) {
      var el = e.target.closest('[data-opt]');
      if (!el) return;
      session[el.getAttribute('data-opt')] = el.type === 'checkbox' ? el.checked : el.value;
      renderOptions();
      if (A.id) A.load(A.id);   // options can change the queries
    }
    function publishOptions() {
      if (!L.Settings.isAdmin()) return;
      if (!confirm('Save these document options for everyone?')) return;
      var master = Object.assign({}, L.Settings.getMaster() || {});
      master.doc = Object.assign({}, master.doc || {}, session);
      L.Settings.publishMaster(master);
      company = master.doc; session = {};
      renderOptions();
      A.debug('Document options saved for everyone', 'success');
    }
    function applyDebug(show) {
      if (!debugApi) { try { debugApi = L.Common.mountDebugDrawer(); } catch (_) { debugApi = null; } }
      if (!debugApi) return;
      if (show) { debugApi.show(); debugApi.expand(); } else debugApi.hide();
    }

    // ---- screen ----
    function mountDom() {
      if (!document.getElementById('fbd-app-css')) {
        var st = document.createElement('style'); st.id = 'fbd-app-css'; st.textContent = APP_CSS; document.head.appendChild(st);
      }
      var P = cfg.picker || {};
      var flagsHtml = (cfg.flags || []).map(function (f) {
        return '<label class="fbd-check" title="' + esc(f.title || f.label) + '"><input type="checkbox" id="' + esc(f.key) + 'Chk"> ' + esc(f.label) + '</label>';
      }).join('');
      var head =
        '<header><div><h1 id="docTitle">' + esc(cfg.title || '') + '</h1><p id="statusLine">Loading…</p></div>' +
        '<div class="hdr-actions">' +
        '<div class="fbd-pick fbd-browse">' +
        '<button type="button" id="prevBtn" title="Previous ' + esc(noun) + '">‹</button>' +
        '<input id="recInput" type="text" placeholder="' + esc(P.placeholder || 'Number…') + '" autocomplete="off" />' +
        '<button type="button" id="recBrowse" title="Browse (filter by status / period)">▾</button>' +
        '<button type="button" id="nextBtn" title="Next ' + esc(noun) + ' (within the picker’s filters)">›</button>' +
        '</div>' +
        '<button id="refreshBtn" class="hdr-btn fbd-browse" type="button" title="Reload the ' + esc(noun) + '">Refresh</button>' +
        '<button id="printBtn" class="hdr-btn" type="button" title="Print (or use the BI Report toolbar’s Print / Save / Email)">Print</button>' +
        '<button id="setBtn" class="hdr-btn" type="button" title="Document options">Settings</button>' +
        '</div></header>';
      var drawer =
        '<div id="setOverlay" class="fb-drawer">' +
        '<div class="fb-drawer-head"><h2>Document options</h2>' +
        '<button type="button" class="fb-drawer-close" id="setClose" aria-label="Close">&times;</button></div>' +
        '<div class="fb-drawer-body">' +
        '<div class="fbd-docset">' + flagsHtml +
        '<label class="fbd-check" title="Paper size, remembered for you. ‘Report setting’ = the Page_setup setting on this BI report.">Paper ' +
        '<select id="pageSel" class="fbd-select"><option value="" id="pageSettingOpt">Report setting</option>' +
        APP_PAPERS.map(function (p) { return '<option>' + p + '</option>'; }).join('') + '</select></label></div>' +
        '<p style="font-size:12px;color:#415157;margin:0 0 12px">Starting point: ' + esc(cfg.optionsIntro || 'the stock report') +
        '’s saved options (<span class="opt-src j">J</span>), else the jrxml default (<span class="opt-src">D</span>). ' +
        '<span class="opt-src c">C</span> = saved for everyone by an admin, <span class="opt-src s">S</span> = changed in this session only.</p>' +
        '<div id="optGrid" class="opt-grid"></div>' +
        '<div style="margin-top:14px;font-size:12px"><label class="fbd-check"><input type="checkbox" id="setShowDebug"> Show debug console</label></div>' +
        '</div>' +
        '<div class="fb-drawer-foot">' +
        '<button type="button" class="ds-btn" id="optReset">Discard session changes</button>' +
        '<button type="button" class="ds-btn ds-btn-admin" id="optPublish" style="display:none">Save for everyone</button>' +
        '<button type="button" class="ds-btn ds-btn-primary" id="setDone">Done</button></div></div>';
      var canvas = '<div id="docCanvas"><div id="docEmpty">Pick ' + (/^[aeiou]/i.test(noun) ? 'an ' : 'a ') + esc(noun) + ' to print.</div></div>';
      document.body.insertAdjacentHTML('afterbegin', head + drawer + canvas);
    }

    async function start() {
      try {
        mountDom();
        var close = function () { try { L.Common.closeDrawer('setOverlay'); } catch (_) {} };
        try { L.Common.registerDrawer({ id: 'setOverlay', triggerId: 'setBtn' }); } catch (_) {}
        $('setBtn').addEventListener('click', function () { try { L.Common.toggleDrawer('setOverlay'); } catch (_) {} });
        $('setClose').addEventListener('click', close);
        $('setDone').addEventListener('click', close);
        $('optGrid').addEventListener('change', onOptionChange);
        $('optReset').addEventListener('click', function () { session = {}; renderOptions(); if (A.id) A.load(A.id); });
        $('optPublish').addEventListener('click', publishOptions);
        $('setShowDebug').checked = !!resolve('showDebug', false);
        $('setShowDebug').addEventListener('change', function (e) { setUser('showDebug', e.target.checked); applyDebug(e.target.checked); });
        applyDebug(!!resolve('showDebug', false));
        try { $('optPublish').style.display = L.Settings.isAdmin() ? '' : 'none'; } catch (_) {}

        // Flags (report CHECK settings, switchable in the drawer).
        (cfg.flags || []).forEach(function (f) {
          A.flags[f.key] = param.bool(param.fromEl(f.setting), false);
          var box = $(f.key + 'Chk');
          box.checked = A.flags[f.key];
          box.addEventListener('change', async function () {
            A.flags[f.key] = box.checked;
            if (f.reloadEnv) { await loadEnv(); company = masterDoc(); }
            renderOptions();
            if (A.id) A.load(A.id);
          });
        });

        await loadEnv();
        company = masterDoc();
        renderOptions();
        A.debug('Edition ' + A.env.edition + ', multi-currency ' + A.env.multiCurrency + ', ' + Object.keys(presetVals).length + ' stock presets', 'info');

        var sp = settingPage(), spRaw = ($('set-print') || {}).textContent || '';
        $('pageSettingOpt').textContent = 'Report setting (' + pageLabel(sp) + ')';
        A.debug('Page_setup setting raw: ' + JSON.stringify(spRaw.trim()) + ' -> ' + pageLabel(sp) + (sp.warnings.length ? ' (' + sp.warnings.join('; ') + ')' : ''), 'info');
        pageOverride = String(resolve('paper', '') || '');
        if (pageOverride && APP_PAPERS.indexOf(pageOverride) < 0) pageOverride = '';
        $('pageSel').value = pageOverride;
        $('pageSel').addEventListener('change', function (e) { pageOverride = e.target.value; setUser('paper', pageOverride); A.rerender(); });
        $('printBtn').addEventListener('click', function () {
          if (!printWindow({ title: $('docTitle').textContent })) status('Print window was blocked — use the BI Report toolbar Print / Save instead');
        });

        // Which record: a host launch (fixed), else the setting (adopted once), the
        // user's last pick, or the newest.
        var startId = 0, launched = FBDoc.launch.get();
        if (launched) {
          A.debug('Launch from ' + (launched.host || 'host') + ': ' + JSON.stringify(launched), 'info');
          if (codes.indexOf(launched.module) < 0) A.debug('Launch module ' + launched.module + ' ignored: this report takes ' + codes.join('/'), 'warn');
          else if (launched.id) startId = launched.id;
          else if (launched.num) startId = await numToId(launched.num);
          if (startId) { A.launched = true; launchedFrom = launched.moduleName || codes[0]; }
        }
        if (A.launched) {
          document.body.classList.add('fbd-launched');
        } else {
          $('refreshBtn').addEventListener('click', function () { if (A.id) A.load(A.id); });
          $('prevBtn').addEventListener('click', function () { step(-1); });
          $('nextBtn').addEventListener('click', function () { step(1); });
          var P = cfg.picker || {};
          var saved = resolve('pickFilters', null) || {};
          var filters = [];
          try { filters = P.filters ? await P.filters(saved, A) : []; } catch (e) { A.debug('picker filters: ' + errText(e), 'warn'); }
          pick = picker({
            input: $('recInput'), button: $('recBrowse'), filters: filters,
            search: function (term, f) { return P.search ? P.search(term, f, A) : Promise.resolve([]); },
            onFilters: function (f) { setUser('pickFilters', f); },
            onPick: function (it) { A.load(it.value); },
            onEnter: async function (txt) { var id = await numToId(txt); if (id) A.load(id); else status('No ' + noun + ' ' + txt); }
          });
          var setting = param.int(param.fromEl(rec.setting), 0);
          var seen = String(resolve('seenSetting', ''));
          if (setting > 0 && String(setting) !== seen) { startId = setting; setUser('seenSetting', String(setting)); }
          else startId = parseInt(resolve('lastId', 0), 10) || setting;
          if (!startId) {
            if (rec.newest) startId = await rec.newest(A);
            else if (rec.table) { var r = await q('SELECT MAX(id) AS id FROM ' + rec.table); startId = r.length ? parseInt(r[0].id, 10) : 0; }
          }
        }
        if (startId) await A.load(startId);
        else status('Pick ' + (/^[aeiou]/i.test(noun) ? 'an ' : 'a ') + noun);
      } catch (e) {
        console.error('[FBDoc.app]', e);
        status('Init failed — ' + errText(e));
        A.debug('Init failed: ' + errText(e) + (e && e.stack ? ' | ' + e.stack : ''), 'error');
      }
    }
    function masterDoc() { try { var m = L.Settings.getMaster(); return (m && m.doc) || {}; } catch (_) { return {}; } }

    // Test hooks (harness).
    A.session = function () { return session; };
    A.setSession = function (o) { session = o || {}; renderOptions(); };
    global.FBDocApp = A;

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else setTimeout(start, 0);
    return A;
  }
  FBDoc.app = app;

  global.FBDoc = FBDoc;
  if (typeof module === 'object' && module.exports) module.exports = FBDoc;
})(typeof window !== 'undefined' ? window : globalThis);
