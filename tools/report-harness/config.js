// config.js — where the harness finds things. Every value can come from an
// environment variable or from harness.local.json beside this file (gitignored):
//
//   { "playwright": "C:/…/node_modules/playwright-core",   PLAYWRIGHT_PATH
//     "chrome": "C:/Program Files/Google/Chrome/Application/chrome.exe",   CHROME_PATH
//     "port": 8733,                                          HARNESS_PORT
//     "out": "C:/…/report-harness-out" }                     HARNESS_OUT
//
// Without them: playwright-core / playwright from node's normal lookup, the
// installed Chrome (channel "chrome"), port 8733, <tmp>/fb-report-harness.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
let local = {};
try { local = JSON.parse(fs.readFileSync(path.join(__dirname, 'harness.local.json'), 'utf8')); } catch (_) {}

const cfg = {
  REPO,
  port: +(process.env.HARNESS_PORT || local.port || 8733),
  out: process.env.HARNESS_OUT || local.out || path.join(os.tmpdir(), 'fb-report-harness'),
  chrome: process.env.CHROME_PATH || local.chrome || '',
  playwrightPath: process.env.PLAYWRIGHT_PATH || local.playwright || ''
};
fs.mkdirSync(cfg.out, { recursive: true });

/** The playwright module (chromium launcher). */
cfg.playwright = function () {
  const tries = [cfg.playwrightPath, 'playwright-core', 'playwright'].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch (_) {} }
  throw new Error('playwright not found: npm i -g playwright-core, or set PLAYWRIGHT_PATH / harness.local.json "playwright"');
};
/** Launch options for Chrome: the configured executable, else the installed Chrome. */
cfg.launchOptions = function () {
  return cfg.chrome ? { executablePath: cfg.chrome } : { channel: 'chrome' };
};
cfg.url = file => 'http://127.0.0.1:' + cfg.port + '/' + encodeURIComponent(path.basename(file));

module.exports = cfg;
