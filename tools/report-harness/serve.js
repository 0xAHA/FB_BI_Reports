#!/usr/bin/env node
// serve.js — serve the built pages (config.js "out" folder) on http://127.0.0.1:<port>/.
//   node serve.js [folder]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const cfg = require('./config.js');

const root = path.resolve(process.argv[2] || cfg.out);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
http.createServer((q, s) => {
  const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  if (!p.startsWith(root)) { s.writeHead(403); s.end(); return; }
  fs.readFile(p, (e, d) => {
    if (e) { s.writeHead(404); s.end(); return; }
    s.writeHead(200, { 'content-type': TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    s.end(d);
  });
}).listen(cfg.port, '127.0.0.1', () => console.log('serving ' + root + ' on http://127.0.0.1:' + cfg.port + '/'));
