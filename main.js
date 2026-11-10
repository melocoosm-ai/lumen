// Lumen browser — main (browser) process.
//
// Architecture mirrors what REA observed in a Chromium-based app bundle:
//   * this process owns windows, tabs and navigation (the "browser" process),
//   * every tab is a separate sandboxed renderer (WebContentsView),
//   * the toolbar/tab strip is itself web UI in its own renderer, talking to
//     this process over a narrow IPC surface exposed by preload.js.
// Electron supplies the Chromium content layer, so GPU/renderer/utility
// helper processes are spawned the same way Chromium does it.

const path = require('node:path');
const { app, BaseWindow, WebContentsView, Menu, ipcMain, nativeTheme, shell } = require('electron');

const isMac = process.platform === 'darwin';
const TABSTRIP_HEIGHT = 38;

const CHROME_HEIGHT = 80; // tab strip (38) + toolbar (42)
const NEW_TAB_URL = `file://${path.join(__dirname, 'ui', 'newtab.html')}`;
const SEARCH_URL = 'https://duckduckgo.com/?q=';

let win;
let uiView;
const tabs = new Map(); // id -> { id, view, title, url, favicon, loading }
let order = [];
let activeId = null;
let nextId = 1;

// ---------- omnibox: decide between URL and search ----------
function resolveInput(input) {
  const text = input.trim();
  if (!text) return null;
  const hostWithPort = /^[a-z0-9.-]+:\d+(\/|$)/i.test(text); // "localhost:3000" is not a scheme
  if (!hostWithPort && /^[a-z][a-z0-9+.-]*:/i.test(text) && !/\s/.test(text)) {
    // Has a scheme. Only allow schemes a browser should open in a tab.
    return /^(https?|file|about|data):/i.test(text) ? text : SEARCH_URL + encodeURIComponent(text);
  }
  const looksLikeHost =
    !/\s/.test(text) &&
    (/^localhost(:\d+)?(\/|$)/i.test(text) ||
      /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(text) ||
      /^[^/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text));
  if (looksLikeHost) {
    const local = /^(localhost|127\.|\d{1,3}(\.\d{1,3}){3})/i.test(text);
    return (local ? 'http://' : 'https://') + text;
  }
  return SEARCH_URL + encodeURIComponent(text);
}

// ---------- state broadcast to the toolbar UI ----------
function displayUrl(url) {
  return url === NEW_TAB_URL ? '' : url;
}

function snapshot() {
  return {
    activeId,
    tabs: order.map((id) => {
      const t = tabs.get(id);
      const h = t.view.webContents.navigationHistory;
      return {
        id,
        title: t.title || 'New Tab',
        url: displayUrl(t.url),
        favicon: t.favicon,
        loading: t.loading,
        canGoBack: h.canGoBack(),
        canGoForward: h.canGoForward(),
      };
    }),
  };
}

function broadcast() {
  if (uiView && !uiView.webContents.isDestroyed()) uiView.webContents.send('state', snapshot());
}

function focusOmnibox() {
  uiView.webContents.focus();
  uiView.webContents.send('focus-omnibox');
}

// ---------- layout ----------
function layout() {
  const { width, height } = win.getContentBounds();
  uiView.setBounds({ x: 0, y: 0, width, height: CHROME_HEIGHT });
  for (const t of tabs.values()) {
    t.view.setBounds({ x: 0, y: CHROME_HEIGHT, width, height: Math.max(0, height - CHROME_HEIGHT) });
  }
}

// ---------- tabs ----------
function createTab(url = NEW_TAB_URL, { activate = true, afterId = activeId } = {}) {
  const id = nextId++;
  const view = new WebContentsView({
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const tab = { id, view, title: 'New Tab', url, favicon: null, loading: false };
  tabs.set(id, tab);
  const at = afterId ? order.indexOf(afterId) + 1 : order.length;
  order.splice(at || order.length, 0, id);

  const wc = view.webContents;
  wc.on('page-title-updated', (_e, title) => { tab.title = title; broadcast(); });
  wc.on('page-favicon-updated', (_e, icons) => { tab.favicon = icons[0] || null; broadcast(); });
  wc.on('did-start-loading', () => { tab.loading = true; broadcast(); });
  wc.on('did-stop-loading', () => { tab.loading = false; broadcast(); });
  const onNav = (_e, navUrl) => {
    tab.url = navUrl;
    if (navUrl === NEW_TAB_URL) { tab.title = 'New Tab'; tab.favicon = null; }
    broadcast();
  };
  wc.on('did-navigate', onNav);
  wc.on('did-navigate-in-page', onNav);
  wc.on('did-fail-load', (_e, code, desc, failedUrl, isMain) => {
    if (!isMain || code === -3) return; // -3 = aborted (e.g. user typed a new URL)
    tab.title = 'Can’t reach this page';
    wc.executeJavaScript(
      `document.documentElement.innerHTML = ${JSON.stringify(errorPage(failedUrl, desc))};`
    ).catch(() => {});
    broadcast();
  });
  // Links that want a new window open as a new tab instead.
  wc.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) createTab(target, { afterId: id });
    return { action: 'deny' };
  });

  win.contentView.addChildView(view);
  layout();
  wc.loadURL(url);
  if (activate) activateTab(id);
  else { view.setVisible(false); broadcast(); }
  return id;
}

function errorPage(url, desc) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<head><meta charset="utf-8"><style>
    body{font:15px -apple-system,system-ui,sans-serif;max-width:560px;margin:18vh auto;padding:0 24px;color:#3c4043}
    h1{font-size:22px;font-weight:600}code{background:#f1f3f4;padding:2px 6px;border-radius:4px}
    @media (prefers-color-scheme:dark){body{background:#202124;color:#e8eaed}code{background:#303134}}
  </style></head><body><h1>This page can’t be reached</h1>
  <p><code>${esc(url)}</code></p><p>${esc(desc)}</p></body>`;
}

function activateTab(id) {
  if (!tabs.has(id)) return;
  activeId = id;
  for (const t of tabs.values()) t.view.setVisible(t.id === id);
  const t = tabs.get(id);
  if (t.url === NEW_TAB_URL) focusOmnibox();
  else t.view.webContents.focus();
  broadcast();
}

function closeTab(id) {
  const t = tabs.get(id);
  if (!t) return;
  const idx = order.indexOf(id);
  order.splice(idx, 1);
  tabs.delete(id);
  win.contentView.removeChildView(t.view);
  t.view.webContents.close();
  if (order.length === 0) { win.close(); return; }
  if (activeId === id) activateTab(order[Math.min(idx, order.length - 1)]);
  else broadcast();
}

const active = () => tabs.get(activeId);

// ---------- IPC from the toolbar UI ----------
ipcMain.on('tab:new', () => createTab());
ipcMain.on('tab:close', (_e, id) => closeTab(id));
ipcMain.on('tab:activate', (_e, id) => activateTab(id));
ipcMain.on('nav:go', (_e, input) => {
  const url = resolveInput(String(input || ''));
  const t = active();
  if (!url || !t) return;
  t.view.webContents.loadURL(url);
  t.view.webContents.focus();
});
ipcMain.on('nav:back', () => active()?.view.webContents.navigationHistory.goBack());
ipcMain.on('nav:forward', () => active()?.view.webContents.navigationHistory.goForward());
ipcMain.on('nav:reload', () => active()?.view.webContents.reload());
ipcMain.on('nav:stop', () => active()?.view.webContents.stop());
ipcMain.handle('state:get', () => snapshot());

// ---------- menu and keyboard shortcuts ----------
function cycle(step) {
  const i = order.indexOf(activeId);
  activateTab(order[(i + step + order.length) % order.length]);
}

function buildMenu() {
  const tabNumbers = Array.from({ length: 9 }, (_, n) => ({
    label: n === 8 ? 'Last Tab' : `Tab ${n + 1}`,
    accelerator: `CmdOrCtrl+${n + 1}`,
    click: () => activateTab(n === 8 ? order[order.length - 1] : order[n]),
  }));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => createTab() },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => closeTab(activeId) },
        { type: 'separator' },
        { label: 'Open Location…', accelerator: 'CmdOrCtrl+L', click: focusOmnibox },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => active()?.view.webContents.reload() },
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: () => active()?.view.webContents.navigationHistory.goBack() },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: () => active()?.view.webContents.navigationHistory.goForward() },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => zoom(0.5) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => zoom(-0.5) },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => active()?.view.webContents.setZoomLevel(0) },
        { type: 'separator' },
        { label: 'Developer Tools', accelerator: 'Alt+CmdOrCtrl+I', click: () => active()?.view.webContents.toggleDevTools() },
      ],
    },
    {
      label: 'Tab',
      submenu: [
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => cycle(1) },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => cycle(-1) },
        { type: 'separator' },
        ...tabNumbers,
      ],
    },
    { role: 'windowMenu' },
  ]));
}

function zoom(delta) {
  const wc = active()?.view.webContents;
  if (wc) wc.setZoomLevel(wc.getZoomLevel() + delta);
}

// ---------- window ----------
// Colors of the Windows/Linux caption buttons, matched to the tab strip in ui/ui.css.
function titleBarOverlay() {
  return nativeTheme.shouldUseDarkColors
    ? { color: '#1b1d22', symbolColor: '#e8eaed', height: TABSTRIP_HEIGHT }
    : { color: '#dfe3e8', symbolColor: '#1f2328', height: TABSTRIP_HEIGHT };
}
nativeTheme.on('updated', () => {
  if (win && !isMac) win.setTitleBarOverlay(titleBarOverlay());
});

function urlFromArgs(argv) {
  return argv.find((a) => /^https?:\/\//i.test(a));
}

function createWindow() {
  win = new BaseWindow({
    width: 1280,
    height: 820,
    minWidth: 480,
    minHeight: 300,
    title: 'Lumen',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1d22' : '#dfe3e8',
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 13 } }
      // Windows/Linux: draw our own tab strip, but keep the system's minimize/maximize/close buttons.
      : { titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlay() }),
  });

  uiView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.contentView.addChildView(uiView);
  uiView.webContents.loadFile(path.join(__dirname, 'ui', 'index.html'));
  // The toolbar must never navigate away; send external links to the OS.
  uiView.webContents.on('will-navigate', (e, url) => { e.preventDefault(); shell.openExternal(url); });

  win.on('resize', layout);
  win.on('closed', () => { tabs.clear(); order = []; win = null; });

  uiView.webContents.once('did-finish-load', () => {
    createTab(urlFromArgs(process.argv) || NEW_TAB_URL);
  });
  layout();
}

app.setName('Lumen');

// One Lumen process per user: launching it again (e.g. from the Start menu or with a URL)
// focuses the existing window and opens the URL as a new tab. Tests run their own instance.
if (!process.env.LUMEN_TEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!win) { createWindow(); return; }
    if (win.isMinimized()) win.restore();
    win.focus();
    const url = urlFromArgs(argv);
    if (url) createTab(url);
  });
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});
app.on('window-all-closed', () => { if (!isMac) app.quit(); });

// Hooks for tests/smoke.js; not used by the app itself.
module.exports = {
  resolveInput,
  _test: { createTab, closeTab, activateTab, snapshot, ui: () => uiView, tab: (id) => tabs.get(id), win: () => win },
};
