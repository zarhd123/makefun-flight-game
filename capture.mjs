// Capture the staged screenshot scenes in shots.json through the headless
// browser's DevTools protocol: serve game/, open each ?shot= scene at
// 1280x480, wait until the page sets window.__shotReady (the scene painted),
// then capture a real screenshot and convert it to a JPEG under the 256 KiB
// cap. Run from the repository root: `node capture.mjs`.
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const shots = JSON.parse(readFileSync(join(here, 'shots.json'), 'utf8'));
const CHROME = process.env.CHROME
  ?? join(process.env.HOME, '.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

const root = join(here, 'game');
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = join(root, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
console.log(`serving game/ on http://127.0.0.1:${port}`);

// One browser, driven over CDP.
const chrome = spawn(CHROME, [
  '--headless', '--disable-gpu', '--no-sandbox',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--hide-scrollbars', '--window-size=1280,480',
  '--remote-debugging-port=9333', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
chrome.stderr.on('data', () => {}); // keep the dbus noise out of the log

async function waitForDebugger() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9333/json/version');
      if (res.ok) return await res.json();
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('chrome did not open its debugger port');
}
await waitForDebugger();

async function newTab(url) {
  const res = await fetch(`http://127.0.0.1:9333/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`new tab failed: ${res.status}`);
  return res.json();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const events = [];
    ws.addEventListener('open', () => resolve({
      send(method, params) {
        return new Promise((res, rej) => {
          const mid = ++id;
          pending.set(mid, { res, rej });
          ws.send(JSON.stringify({ id: mid, method, params: params ?? {} }));
        });
      },
      close() { ws.close(); },
    }));
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      } else if (msg.method) {
        events.push(msg);
      }
    });
    ws.addEventListener('error', reject);
  });
}

async function capture(shot) {
  const url = `http://127.0.0.1:${port}/index.html${shot.query}`;
  const tab = await newTab(url);
  const cdp = await connect(tab.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 480, deviceScaleFactor: 1, mobile: false });
  const deadline = Date.now() + 90000;
  let ready = false;
  let lastError = '';
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 700));
    try {
      const r = await cdp.send('Runtime.evaluate', { expression: 'window.__shotReady === true', returnByValue: true });
      if (r.result && r.result.value === true) { ready = true; break; }
      const err = await cdp.send('Runtime.evaluate', { expression: 'window.__shotError || ""', returnByValue: true });
      if (err.result && err.result.value) lastError = err.result.value;
    } catch { /* tab still loading */ }
  }
  if (!ready) throw new Error(`scene ${shot.name} never became ready (${lastError})`);
  const shotRes = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const png = Buffer.from(shotRes.data, 'base64');
  const pngPath = join(here, 'screenshots', `.${shot.name}.png`);
  writeFileSync(pngPath, png);
  const out = join(here, 'screenshots', shot.name);
  let quality = 84;
  for (;;) {
    execFileSync('python3', ['-c',
      `from PIL import Image; im = Image.open(${JSON.stringify(pngPath)}).convert('RGB'); im.save(${JSON.stringify(out)}, 'JPEG', quality=${quality})`],
    { stdio: 'inherit' });
    const size = statSync(out).size;
    console.log(`  ${shot.name}: ${size} bytes at quality ${quality}`);
    if (size <= 262144 || quality <= 55) break;
    quality -= 8;
  }
  cdp.close();
  await fetch(`http://127.0.0.1:9333/json/close/${tab.id}`);
}

mkdirSync(join(here, 'screenshots'), { recursive: true });
try {
  for (const shot of shots) {
    console.log(`capturing ${shot.name} <- ${shot.query}`);
    await capture(shot);
  }
  console.log('done');
} finally {
  chrome.kill();
  server.close();
}
