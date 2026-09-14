// Fishbowl BI export wrapper.
//
// A Fishbowl BI export is a JSON array holding exactly one object, serialized
// by Jackson's DefaultPrettyPrinter. Reproducing it byte-for-byte matters:
// these files are meant to diff cleanly against a fresh export from the
// client, and a formatting difference would make every line look changed.
//
// The format, established from fb-lib-Script.json, fb-styles-Style.json and
// "- Sales - Sales Order Summary-Page.json":
//   * no BOM
//   * opens `[ {` and closes `} ]`, with NO trailing newline
//   * CRLF between entries, two-space indent
//   * `"key" : value` — a space on BOTH sides of the colon (Jackson's style,
//     which JSON.stringify does not produce)
//   * key order: name, description, data, active, note, type
//   * `data` is the file's raw text with CRLF line endings, JSON-escaped
//   * BMP non-ASCII (em dash, arrows, box drawing) stays RAW UTF-8; only
//     astral characters (emoji) are escaped, as a \uXXXX surrogate pair
const SURROGATES = /[\uD800-\uDFFF]/g;

/* Jackson escapes surrogate halves; JSON.stringify emits them raw. Everything
   else the two agree on, so post-process only that range. */
function jstr(s) {
  return JSON.stringify(s).replace(SURROGATES, function (c) {
    return '\\u' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
  });
}

/* type is 'Page' | 'Script' | 'Style'. */
function wrap(name, description, data, type) {
  // The client exports with CRLF throughout; normalise first so an LF source
  // file and a CRLF one produce identical output. A stray BOM is dropped —
  // Fishbowl's own exports never carry one inside `data`.
  var d = String(data).replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  return '[ {\r\n' +
    '  "name" : ' + jstr(name) + ',\r\n' +
    '  "description" : ' + jstr(description) + ',\r\n' +
    '  "data" : ' + jstr(d) + ',\r\n' +
    '  "active" : true,\r\n' +
    '  "note" : "",\r\n' +
    '  "type" : ' + jstr(type) + '\r\n' +
    '} ]';
}

/* The filename Fishbowl itself writes: "<name>-<type>.json". */
function fileNameFor(name, type) { return name + '-' + type + '.json'; }

module.exports = { wrap, jstr, fileNameFor };
