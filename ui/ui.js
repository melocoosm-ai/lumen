// Toolbar + tab strip renderer. All state lives in the main process; this file only renders it.
const $ = (id) => document.getElementById(id);
const tabsEl = $('tabs');
const omnibox = $('omnibox');
const lock = $('lock');
let state = { tabs: [], activeId: null };
let editing = false; // true while the user is typing in the omnibox

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

function closeIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'm4 4 8 8M12 4l-8 8');
  svg.appendChild(p);
  return svg;
}

function renderTabs() {
  tabsEl.replaceChildren(...state.tabs.map((t) => {
    const tab = el('div', 'tab' + (t.id === state.activeId ? ' active' : ''));
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(t.id === state.activeId));
    tab.title = t.title;

    let icon;
    if (t.loading) icon = el('div', 'spinner');
    else if (t.favicon) {
      icon = el('img', 'favicon');
      icon.src = t.favicon;
      icon.onerror = () => icon.replaceWith(el('div', 'favicon placeholder'));
    } else icon = el('div', 'favicon placeholder');

    const title = el('span', 'title');
    title.textContent = t.title;

    const close = el('button', 'close');
    close.title = 'Close tab (⌘W)';
    close.setAttribute('aria-label', `Close ${t.title}`);
    close.appendChild(closeIcon());
    close.addEventListener('click', (e) => { e.stopPropagation(); window.lumen.closeTab(t.id); });

    tab.append(icon, title, close);
    tab.addEventListener('mousedown', (e) => {
      if (e.button === 1) { e.preventDefault(); window.lumen.closeTab(t.id); }
      else if (e.button === 0) window.lumen.activateTab(t.id);
    });
    return tab;
  }));
}

function renderToolbar() {
  const t = state.tabs.find((x) => x.id === state.activeId);
  $('back').disabled = !t?.canGoBack;
  $('forward').disabled = !t?.canGoForward;
  $('reload').classList.toggle('loading', !!t?.loading);
  $('reload').title = t?.loading ? 'Stop' : 'Reload (⌘R)';
  if (!editing) omnibox.value = t?.url || '';
  const url = t?.url || '';
  lock.className = url.startsWith('https:') ? 'secure' : url.startsWith('http:') ? 'insecure' : '';
  lock.title = url.startsWith('https:') ? 'Connection is secure' : url.startsWith('http:') ? 'Not secure' : '';
}

function render(next) {
  const switched = next.activeId !== state.activeId;
  state = next;
  if (switched) editing = false;
  renderTabs();
  renderToolbar();
}

window.lumen.onState(render);
window.lumen.onFocusOmnibox(() => { omnibox.focus(); omnibox.select(); });
window.lumen.getState().then(render);

$('newtab').addEventListener('click', () => window.lumen.newTab());
$('back').addEventListener('click', () => window.lumen.back());
$('forward').addEventListener('click', () => window.lumen.forward());
$('reload').addEventListener('click', () => {
  const t = state.tabs.find((x) => x.id === state.activeId);
  t?.loading ? window.lumen.stop() : window.lumen.reload();
});

omnibox.addEventListener('input', () => { editing = true; });
omnibox.addEventListener('focus', () => requestAnimationFrame(() => omnibox.select()));
omnibox.addEventListener('blur', () => { editing = false; renderToolbar(); });
omnibox.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { editing = false; renderToolbar(); omnibox.select(); }
});
$('omnibox-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const value = omnibox.value;
  editing = false;
  omnibox.blur();
  window.lumen.go(value);
});
// Double-click on empty tab-strip space opens a new tab.
$('tabstrip').addEventListener('dblclick', (e) => {
  if (e.target.id === 'tabstrip' || e.target.id === 'tabs') window.lumen.newTab();
});
