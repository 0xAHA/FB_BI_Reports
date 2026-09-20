// Which screenshot belongs where, read out of the Word file.
//
// Position in word/media/ is NOT the answer: Word numbers those parts in the
// order images were first embedded — the order they were pasted — so a
// document filled in over several sittings has them out of order, and the same
// picture used twice appears once. The document body is the only truth.
//
// Nor are the "[ SCREENSHOT ]" captions, because filling the guide in means
// replacing most of them with the picture. What survives either way is the
// heading a picture sits under, so that is what each image is reported
// against, in document order.
//
// Usage: node read-docx-figures.js <path to .docx> [outDir]

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const docx = process.argv[2];
const outDir = process.argv[3];
if (!docx) { console.error('usage: read-docx-figures.js <docx> [outDir]'); process.exit(1); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-'));
execFileSync('powershell', ['-NoProfile', '-Command',
  `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
  `[IO.Compression.ZipFile]::ExtractToDirectory('${docx.replace(/'/g, "''")}','${tmp}')`]);

const body = fs.readFileSync(path.join(tmp, 'word', 'document.xml'), 'utf8');
const rels = fs.readFileSync(path.join(tmp, 'word', '_rels', 'document.xml.rels'), 'utf8');

const media = {};
for (const m of rels.matchAll(/Id="([^"]+)"[^>]*Target="media\/([^"]+)"/g)) media[m[1]] = m[2];

// Split on paragraph OPEN tags only: <w:p> or <w:p attr...>, never <w:pPr>.
const paras = body.split(/<w:p(?=[ >])/).slice(1);

const found = [];
let heading = '(front matter)';
let lastText = '';

for (const p of paras) {
  const text = [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join('').trim();
  const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? '';

  if (/^Heading/i.test(style) && text) { heading = text; lastText = ''; }

  for (const e of p.matchAll(/r:embed="([^"]+)"/g)) {
    const file = media[e[1]];
    if (file) found.push({ n: found.length + 1, file, heading, near: lastText.slice(0, 70) });
  }

  if (text && !/^Heading/i.test(style)) lastText = text;
}

console.log(found.length + ' image(s), in document order\n');
console.log('  #  media          under heading'.padEnd(58) + 'preceding text');
console.log('  ' + '-'.repeat(96));
for (const f of found) {
  console.log('  ' + String(f.n).padStart(2) + '  ' + f.file.padEnd(14) +
              f.heading.slice(0, 40).padEnd(42) + f.near);
}

const orphans = [...body.matchAll(/\[\s*SCREENSHOT\s*\]/gi)].length;
if (orphans) console.log('\n' + orphans + ' placeholder(s) still unfilled.');

if (outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = found.map(f => {
    const name = 'fig' + String(f.n).padStart(2, '0') + path.extname(f.file);
    fs.copyFileSync(path.join(tmp, 'word', 'media', f.file), path.join(outDir, name));
    return { n: f.n, file: name, source: f.file, heading: f.heading, near: f.near };
  });
  fs.writeFileSync(path.join(outDir, 'figures.json'), JSON.stringify(manifest, null, 2));
  console.log('\nwrote ' + manifest.length + ' image(s) to ' + outDir);
}

fs.rmSync(tmp, { recursive: true, force: true });
