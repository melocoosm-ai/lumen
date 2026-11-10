// End-to-end smoke test. Run with: npx electron tests/smoke.js <screenshot-dir>
// Starts the real app, drives the toolbar UI like a user, checks state, saves screenshots.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app } = require('electron');
// Headless/CI shells often have no GPU; software compositing keeps capturePage working.
app.disableHardwareAcceleration();
process.env.LUMEN_TEST = '1'; // run alongside a normal Lumen window instead of handing off to it
const lumen = require('../main.js');

const outDir = process.argv.find((a, i) => i > 1 && !a.startsWith('-') && !a.endsWith('.js')) || __dirname;
fs.mkdirSync(outDir, { recursive: true });
const t = lumen._test;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await sleep(100); }
  throw new Error('timed out waiting for condition');
}
async function shot(name) {
  await sleep(400);
  try {
    const ui = await t.ui().webContents.capturePage();
    const page = await t.tab(t.snapshot().activeId).view.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `${name}-toolbar.png`), ui.toPNG());
    fs.writeFileSync(path.join(outDir, `${name}-page.png`), page.toPNG());
  } catch (err) {
    console.log(`--  screenshot ${name} skipped (${err.message}); no display in this session`);
  }
}
const ui = (js) => t.ui().webContents.executeJavaScript(js);

// Never leave a hung error dialog behind if anything throws.
process.on('uncaughtException', (err) => { console.error('FAIL', err); app.exit(1); });
setTimeout(() => { console.error('FAIL global timeout'); app.exit(1); }, 120000).unref();

// 1. Omnibox URL-vs-search rules
assert.equal(lumen.resolveInput('example.com'), 'https://example.com');
assert.equal(lumen.resolveInput('localhost:3000/x'), 'http://localhost:3000/x');
assert.equal(lumen.resolveInput('https://a.b/c?d'), 'https://a.b/c?d');
assert.match(lumen.resolveInput('how do browsers work'), /^https:\/\/duckduckgo\.com\/\?q=how%20do/);
assert.match(lumen.resolveInput('javascript:alert(1)'), /duckduckgo/);
console.log('ok  omnibox resolution');

app.whenReady().then(async () => {
  try {
    await until(() => t.snapshot().tabs.length === 1);
    let s = t.snapshot();
    assert.equal(s.tabs[0].url, '', 'first tab is the new-tab page');
    await shot('1-newtab');
    console.log('ok  window opens with one new tab');

    // Window controls: macOS traffic lights on the left; Windows/Linux caption buttons on the right.
    const layout = await ui(`(() => { const s = getComputedStyle(document.getElementById('tabstrip'));
      return { platform: document.documentElement.dataset.platform, left: s.paddingLeft, right: s.paddingRight,
               hint: document.getElementById('newtab').title }; })()`);
    assert.equal(layout.platform, process.platform);
    if (process.platform === 'darwin') {
      assert.deepEqual([layout.left, layout.right, layout.hint], ['80px', '8px', 'New tab (⌘T)']);
    } else {
      assert.deepEqual([layout.left, layout.right, layout.hint], ['8px', '146px', 'New tab (Ctrl+T)']);
    }
    console.log(`ok  ${process.platform} window-control layout and shortcut hints`);

    // 2. Type a URL into the omnibox and submit, like a user.
    await ui(`(() => { const o = document.getElementById('omnibox'); o.value = 'example.com';
      o.dispatchEvent(new Event('input')); document.getElementById('omnibox-form').requestSubmit(); })()`);
    await until(() => { const a = t.snapshot().tabs[0]; return a.url.startsWith('https://example.com') && !a.loading; });
    s = t.snapshot();
    assert.match(s.tabs[0].title, /Example Domain/);
    assert.equal(await ui(`document.getElementById('omnibox').value`), 'https://example.com/');
    await shot('2-example');
    console.log('ok  navigation from omnibox:', s.tabs[0].title);

    // 3. Search query.
    await ui(`(() => { const o = document.getElementById('omnibox'); o.value = 'electron webcontentsview';
      document.getElementById('omnibox-form').requestSubmit(); })()`);
    await until(() => t.snapshot().tabs[0].url.includes('duckduckgo.com'));
    console.log('ok  search goes to', new URL(t.snapshot().tabs[0].url).host);

    // 4. Back button.
    await until(() => t.snapshot().tabs[0].canGoBack);
    await ui(`document.getElementById('back').click()`);
    await until(() => t.snapshot().tabs[0].url.startsWith('https://example.com'));
    assert.ok(t.snapshot().tabs[0].canGoForward);
    console.log('ok  back/forward history');

    // 5. New tab via the + button, then switch tabs by clicking the strip.
    await ui(`document.getElementById('newtab').click()`);
    await until(() => t.snapshot().tabs.length === 2);
    s = t.snapshot();
    assert.equal(s.activeId, s.tabs[1].id);
    assert.equal(await ui(`document.activeElement.id`), 'omnibox', 'new tab focuses omnibox');
    assert.equal(await ui(`document.querySelectorAll('.tab').length`), 2);
    await ui(`document.querySelectorAll('.tab')[0].dispatchEvent(new MouseEvent('mousedown', {button: 0, bubbles: true}))`);
    await until(() => t.snapshot().activeId === s.tabs[0].id);
    assert.equal(await ui(`document.getElementById('omnibox').value`), 'https://example.com/');
    console.log('ok  new tab + tab switching');

    // 6. window.open / target=_blank opens a background-adjacent tab, not a window.
    await t.tab(s.tabs[0].id).view.webContents.executeJavaScript(`window.open('https://example.org'); 1`, true);
    await until(() => t.snapshot().tabs.length === 3);
    assert.match(t.snapshot().tabs[1].url, /example\.org/);
    console.log('ok  window.open becomes a tab next to its opener');
    await shot('3-tabs');

    // 7. Close tab via its × button.
    await ui(`document.querySelectorAll('.tab .close')[2].click()`);
    await until(() => t.snapshot().tabs.length === 2);
    console.log('ok  close tab');

    // 8. Failed load shows an error page.
    await ui(`(() => { const o = document.getElementById('omnibox'); o.value = 'https://nonexistent.invalid';
      document.getElementById('omnibox-form').requestSubmit(); })()`);
    await until(() => t.snapshot().tabs.find((x) => x.id === t.snapshot().activeId).title.includes('reach'));
    await shot('4-error');
    console.log('ok  error page for unreachable host');

    // 9. Tab pages are sandboxed: no Node or bridge API exposed.
    const leaked = await t.tab(t.snapshot().activeId).view.webContents
      .executeJavaScript(`[typeof require, typeof process, typeof window.lumen].join(',')`);
    assert.equal(leaked, 'undefined,undefined,undefined');
    console.log('ok  web pages get no Node/IPC access');

    console.log('\nALL PASSED');
    app.exit(0);
  } catch (err) {
    console.error('FAIL', err);
    app.exit(1);
  }
});
