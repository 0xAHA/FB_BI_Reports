#!/usr/bin/env node
// Builds a Report Builder app page from a report definition file.
//
//   node tools/report-builder/gen-page.js <definition.json> [out.htm]
//
// The definition file: { name, key, folder, launch?, description, spec }
//   name         the app's Fishbowl record name
//   key          its storage-key prefix (FB_REPORT.key, 31 characters max)
//   folder       the fb-folder tag (where it sits in the App Library)
//   launch       optional fb-launch content (which modules' Apps menus list it)
//   description  one sentence
//   spec         the report spec (fb-report-spec v1)
//
// The page holds no SQL: fb-report compiles the spec against fb-model when it runs.
// The plugin's publisher (Phase 3) writes the same page; keep the two in step.
'use strict';
const fs = require('fs');
const path = require('path');

function attr(s) {
    // Attribute text: HTML-escaped, and $ / % as entities so Fishbowl never sees a setting token or directive.
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
        .replace(/\$/g, '&#36;').replace(/%/g, '&#37;');
}
function jsString(s) {
    return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\u0000-\u001f]/g, '') + "'";
}
/** The spec as JSON that is safe inside <script> and against Fishbowl's text substitution. */
function embed(spec) {
    return JSON.stringify(spec, null, 2)
        .replace(/</g, '\\u003c').replace(/\$/g, '\\u0024').replace(/%/g, '\\u0025')
        .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function page(def) {
    const spec = def.spec;
    if (!spec || spec.kind !== 'fb-report-spec') throw new Error('The definition has no fb-report-spec.');
    if (!def.name || !def.key) throw new Error('The definition needs a name and a key.');
    if (def.key.length > 31) throw new Error('The key is longer than 31 characters.');
    const charts = (spec.steps || []).some(s => s.type === 'chart');
    const lines = [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '    <meta charset="UTF-8">'
    ];
    if (def.launch) lines.push('    <meta name="fb-launch" content="' + attr(def.launch) + '">');
    lines.push(
        '    <meta name="fb-folder" content="' + attr(def.folder || 'Custom') + '">',
        '    <meta name="fb-origin" content="custom">',
        '    <meta name="fb-builder" content="1">',
        '    <meta name="description" content="' + attr(def.description || spec.description || '') + '">',
        '    <script>',
        '        // A Report Builder report: everything below comes from its definition (the JSON',
        '        // block in the body). fb-report compiles it against the fb-model catalog each run.',
        '        window.FB_REPORT = {',
        '            key:   ' + jsString(def.key) + ',',
        '            name:  ' + jsString(def.name) + ',',
        "            build: 'UNSTAMPED'     // @fb-build",
        '        };',
        '    </script>',
        '    <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '    <title>' + attr(spec.title || def.name) + '</title>',
        '    <script>',
        '        {% Script fb-lib %}',
        '    </script>',
        '    <script>',
        '        {% Script fb-doc %}',
        '    </script>');
    if (charts) lines.push('    <script>', '        {% Script fb-echarts %}', '    </script>', '    <script>', '        {% Script fb-chart %}', '    </script>');
    lines.push(
        '    <script>',
        '        {% Script fb-model %}',
        '    </script>',
        '    <script>',
        '        {% Script fb-report %}',
        '    </script>',
        '    <style>',
        '        {% Style fb-styles %}',
        '    </style>',
        '    <style>',
        '        {% Style fb-doc-fonts %}',
        '    </style>',
        '</head>',
        '<body class="rpt-page">',
        '<div id="fbr"></div>',
        '<script type="application/json" id="fb-report-spec">',
        embed(spec),
        '</script>',
        '<script>FBReport.boot();</script>',
        '</body>',
        '</html>',
        '');
    return lines.join('\n');
}

if (require.main === module) {
    const [src, outArg] = process.argv.slice(2);
    if (!src) {
        console.error('usage: node tools/report-builder/gen-page.js <definition.json> [out.htm]');
        process.exit(1);
    }
    const def = JSON.parse(fs.readFileSync(src, 'utf8'));
    const out = outArg || src.replace(/\.json$/i, '.htm');
    fs.writeFileSync(out, page(def));
    console.log('wrote ' + path.relative(process.cwd(), out));
}

module.exports = { page, embed };
