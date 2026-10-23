// Cyberdeck Editor – Hauptprozess: Fenster, Vault-Zugriff (nur hier!), Index, Watcher, Updates, Test-Hooks.
'use strict';
const { app, BaseWindow, WebContentsView, ipcMain, dialog, protocol, net, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { Vault } = require('./vault');

if (process.env.EDITOR_USERDATA) app.setPath('userData', path.resolve(process.env.EDITOR_USERDATA));
protocol.registerSchemesAsPrivileged([{ scheme: 'cde', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const SRC = __dirname;
let win = null;
let view = null;
let vault = null;
let settings = {};
let updater = null;
let closing = false;
let uiReady = false;

// ───────────── Einstellungen (userData/settings.json)
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() { try { settings = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) || {}; } catch { settings = {}; } }
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    const tmp = settingsFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
    fs.renameSync(tmp, settingsFile());
  } catch (e) { console.error('settings', e.message); }
}

const send = (ch, d) => { if (view && !view.webContents.isDestroyed()) view.webContents.send(ch, d); };

// ───────────── Vault
async function openVault(dir) {
  const st = fs.statSync(dir);
  if (!st.isDirectory()) throw new Error('Kein Ordner: ' + dir);
  if (vault) await vault.close();
  vault = new Vault(dir);
  await vault.scan();
  await vault.watch((ev) => send('fs', ev));
  settings.lastVault = vault.root;
  saveSettings();
  if (win) win.setTitle(`${vault.name} – Cyberdeck Editor`);
  const snap = vault.snapshot();
  send('vault', snap);
  return snap;
}
const need = () => { if (!vault) throw new Error('Kein Vault geöffnet'); return vault; };

// ───────────── Updates (wie Cyberdeck Netrunner: nur im gepackten Build)
function setupUpdates() {
  send('versions', { app: app.getVersion(), chromium: process.versions.chrome, electron: process.versions.electron });
  if (!app.isPackaged || process.env.EDITOR_NO_UPDATE) { send('update', { state: 'dev', text: 'DEV-BUILD // KEINE UPDATES' }); return; }
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
    updater.autoDownload = true;
    updater.on('checking-for-update', () => send('update', { state: 'checking', text: 'SUCHE UPDATE …' }));
    updater.on('update-not-available', () => send('update', { state: 'ok', text: 'AKTUELL' }));
    updater.on('download-progress', (p) => send('update', { state: 'loading', text: `LADE UPDATE ${Math.round(p.percent)} %` }));
    updater.on('update-downloaded', (u) => send('update', { state: 'ready', text: `v${u.version} BEREIT // NEUSTART` }));
    updater.on('error', (e) => send('update', { state: 'error', text: 'UPDATE-FEHLER', detail: String(e.message || e) }));
    updater.checkForUpdates().catch(() => {});
    setInterval(() => updater.checkForUpdates().catch(() => {}), 6 * 3600 * 1000);
  } catch (e) {
    send('update', { state: 'error', text: 'UPDATER FEHLT', detail: e.message });
  }
}

// ───────────── IPC (nur vom eigenen UI, Ergebnisse als {ok, v | error})
function handle(ch, fn) {
  ipcMain.handle(ch, async (e, ...args) => {
    if (!view || e.sender !== view.webContents) return { ok: false, error: 'Unbekannter Absender' };
    try { return { ok: true, v: await fn(...args) }; } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });
}
function setupIpc() {
  handle('vault:choose', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Vault öffnen', properties: ['openDirectory', 'createDirectory'], defaultPath: settings.lastVault || app.getPath('documents') });
    if (r.canceled || !r.filePaths[0]) return null;
    return openVault(r.filePaths[0]);
  });
  handle('vault:current', () => (vault ? vault.snapshot() : null));
  handle('note:read', (rel) => need().read(rel));
  handle('note:write', (rel, text) => need().write(rel, text));
  handle('note:create', (dir, name, text) => need().createNote(dir, name, text || ''));
  handle('note:createAt', (target) => need().createAt(target));
  handle('folder:create', (dir, name) => need().createFolder(dir, name));
  handle('entry:rename', (rel, name) => need().rename(rel, name));
  handle('entry:delete', (rel) => need().remove(rel));
  handle('index:snapshot', () => need().snapshot());
  handle('index:graph', () => need().graph());
  handle('index:links', (rel) => need().links(rel));
  handle('search', (q) => need().search(q));
  handle('open-external', (url) => { if (/^(https?|mailto):/i.test(String(url))) shell.openExternal(String(url)); return true; });
  handle('open-file', (rel) => { const p = need().abs(rel); return shell.openPath(p); });
  handle('show-in-folder', (rel) => { const v = need(); shell.showItemInFolder(rel ? v.abs(rel) : v.root); return true; });
  ipcMain.on('win', (e, what) => {
    if (!win || e.sender !== view.webContents) return;
    if (what === 'min') win.minimize();
    else if (what === 'max') (win.isMaximized() ? win.unmaximize() : win.maximize());
    else if (what === 'close') win.close();
    else if (what === 'closed-ok') { closing = true; win.close(); }
  });
  ipcMain.on('install-update', () => { if (updater) updater.quitAndInstall(); });
  ipcMain.on('ui-ready', () => {
    uiReady = true;
    setupUpdates();
    if (vault) send('vault', vault.snapshot());
  });
}

// ───────────── Interne Seiten + Vault-Bilder ueber cde://
function setupProtocol() {
  protocol.handle('cde', async (req) => {
    const u = new URL(req.url);
    let p = null;
    try {
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      if (u.host === 'app') {
        const r = rel || 'index.html';
        if (!/^(index\.html|style\.css|dist\/[\w./-]+|fonts\/[\w.-]+)$/.test(r) || r.includes('..')) throw new Error('nope');
        p = path.join(SRC, r);
      } else if (u.host === 'vault' && vault) p = vault.abs(rel);
    } catch { p = null; }
    if (!p) return new Response('Nicht gefunden', { status: 404 });
    return net.fetch(pathToFileURL(p).toString());
  });
}

// ───────────── Fenster (rahmenlos, eigene Titelleiste)
function createWindow() {
  const icon = path.join(SRC, '..', 'build', 'icon.png');
  win = new BaseWindow({
    width: 1440, height: 900, minWidth: 820, minHeight: 520,
    frame: false, backgroundColor: '#07020A', title: 'Cyberdeck Editor',
    ...(fs.existsSync(icon) ? { icon } : {}),
  });
  view = new WebContentsView({
    webPreferences: { preload: path.join(SRC, 'preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  view.setBackgroundColor('#07020A');
  win.contentView.addChildView(view);
  const layout = () => { const [w, h] = win.getContentSize(); view.setBounds({ x: 0, y: 0, width: w, height: h }); };
  layout();
  win.on('resize', layout);
  win.on('maximize', () => send('maximized', true));
  win.on('unmaximize', () => send('maximized', false));
  const wc = view.webContents;
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  wc.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && !app.isPackaged) wc.toggleDevTools();
  });
  // Vor dem Schliessen ungespeicherte Aenderungen sichern lassen
  win.on('close', (e) => {
    if (closing || !uiReady || process.env.EDITOR_TEST) return;
    e.preventDefault();
    send('flush-and-close');
    setTimeout(() => { closing = true; if (win) win.close(); }, 2000);
  });
  win.on('closed', () => { win = null; view = null; app.quit(); });
  wc.loadURL('cde://app/index.html');
  return wc;
}

// ───────────── Test-Hooks (headless): EDITOR_TEST=skript.js | EDITOR_SHOT=datei.png (+EDITOR_WAIT ms)
async function runHooks(wc) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ev = (code) => wc.executeJavaScript(`(async () => { ${code} })()`, true);
  const waitFor = async (code, ms = 15000) => {
    const t0 = Date.now();
    for (;;) {
      try { const v = await ev(`return (${code})`); if (v) return v; } catch { /* weiter */ }
      if (Date.now() - t0 > ms) throw new Error('Timeout: ' + code);
      await sleep(100);
    }
  };
  if (process.env.EDITOR_SHOT) {
    await waitFor('window.cde && window.cde.ready', 30000).catch(() => {});
    await sleep(Number(process.env.EDITOR_WAIT || 2500));
    const img = await wc.capturePage();
    fs.writeFileSync(path.resolve(process.env.EDITOR_SHOT), img.toPNG());
    const info = await ev('return window.cde ? cde.info() : null').catch((e) => ({ error: e.message }));
    fs.writeFileSync(path.resolve(process.env.EDITOR_SHOT) + '.json', JSON.stringify({ packaged: app.isPackaged, version: app.getVersion(), info }, null, 2));
    app.exit(0);
    return;
  }
  if (process.env.EDITOR_TEST) {
    const out = path.resolve(process.env.EDITOR_OUT || path.join(app.getPath('temp'), 'cde-test'));
    fs.mkdirSync(out, { recursive: true });
    const shot = async (name) => { const img = await wc.capturePage(); const f = path.join(out, name + '.png'); fs.writeFileSync(f, img.toPNG()); return f; };
    let result;
    try {
      await waitFor('window.cde && window.cde.ready', 30000);
      result = await require(path.resolve(process.env.EDITOR_TEST))({ ev, shot, sleep, waitFor, out, wc, getVault: () => vault, openVault, fs, path });
    } catch (e) { result = { fatal: String(e && e.stack || e) }; }
    fs.writeFileSync(path.join(out, path.basename(process.env.EDITOR_TEST, '.js') + '.json'), JSON.stringify(result, null, 2));
    if (vault) await vault.close();
    app.exit(0);
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  loadSettings();
  setupProtocol();
  setupIpc();
  const start = process.env.EDITOR_VAULT || settings.lastVault;
  if (start && fs.existsSync(start)) { try { await openVault(start); } catch (e) { console.error('vault', e.message); } }
  const wc = createWindow();
  if (process.env.EDITOR_TEST || process.env.EDITOR_SHOT) runHooks(wc);
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (vault) vault.close(); });
