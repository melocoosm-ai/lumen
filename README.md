# Lumen

A small tabbed web browser built on Electron's Chromium engine. Its process layout
follows what a REA inspection of a shipped Chromium browser bundle found:

| Observed in the Chromium bundle (REA) | Lumen equivalent |
| --- | --- |
| 360 KB launcher that `dlopen`s the browser framework and calls `ChromeMain` | Electron binary that loads `main.js` |
| One large framework holding the engine (V8, Blink, network, UI) | Electron's bundled Chromium framework |
| Separate helper apps for Renderer, GPU and utility processes; renderer/GPU get the `allow-jit` entitlement | Electron spawns the same helper processes |
| `resources.pak`, ICU data and V8 snapshots in framework resources | Bundled by Electron |
| Browser UI drawn by the browser process | Toolbar/tab strip is web UI in its own renderer (`ui/`) |

## Features

- Tab strip: new, close (button or middle-click), switch, ⌘1–9, Ctrl+Tab
- Address bar that tells URLs from searches (DuckDuckGo), with a security dot
- Back, forward, reload/stop, zoom, per-tab DevTools
- Links that open new windows become new tabs next to the opener
- Error page for unreachable sites; new-tab page; light and dark themes

Every tab runs in its own sandboxed renderer with context isolation and no Node
access. Only the toolbar renderer gets a fixed IPC API (`preload.js`).

## Run

```bash
npm install
npm start
```

`npm test` runs `tests/smoke.js`, which starts the real app and drives the toolbar.
