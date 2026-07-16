/* Adorable client — vanilla JS module, no build step.
   Preview runs entirely in this browser via Sandpack (no server-side execution). */
import { loadSandpackClient } from 'https://esm.sh/@codesandbox/sandpack-client@2';

const state = {
  view: 'home',
  me: null, // { email, dailyLimit, usedToday }
  models: [],
  defaultModel: '',
  projects: [],
  project: null,
  tab: 'preview',
  device: 'desktop',
  selectedFile: null,
  gen: null, // { stage, file, tail } while a generation is streaming
  publishing: false,
};

let sandpack = null; // active SandpackClient for the preview iframe

const app = document.getElementById('app');
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ago = (ts) => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ---------------- Sandpack preview ---------------- */

function sandpackFiles(project) {
  const files = {
    '/index.js': {
      code: `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
createRoot(document.getElementById("root")).render(<App />);`,
    },
    '/package.json': {
      code: JSON.stringify({ name: 'adorable-app', main: '/index.js', dependencies: project.dependencies || {} }, null, 2),
    },
  };
  for (const [p, content] of Object.entries(project.files)) {
    if (p.startsWith('src/')) files['/' + p.slice(4)] = { code: content };
  }
  return files;
}

async function mountPreview() {
  const iframe = document.getElementById('preview');
  if (!iframe || !state.project) return;
  destroyPreview();
  try {
    sandpack = await loadSandpackClient(
      iframe,
      { files: sandpackFiles(state.project), template: 'create-react-app' },
      { showOpenInCodeSandbox: false, externalResources: ['https://cdn.tailwindcss.com'] }
    );
  } catch (err) {
    console.error('Sandpack failed to start', err);
  }
}

function destroyPreview() {
  try { sandpack?.destroy(); } catch {}
  sandpack = null;
}

function refreshPreview() {
  if (sandpack && state.project) {
    sandpack.updateSandbox({ files: sandpackFiles(state.project), template: 'create-react-app' });
  } else {
    mountPreview();
  }
}

/* ---------------- home ---------------- */

const EXAMPLES = [
  'A pomodoro timer with session stats',
  'Kanban board with drag and drop',
  'Landing page for a coffee subscription',
  'Personal finance dashboard with charts',
  'Recipe box with search and favorites',
];

function renderHome() {
  document.title = 'Adorable — build something adorable';
  destroyPreview();
  app.innerHTML = `
    <div class="home">
      <nav class="topnav">
        <a class="logo" href="#"><span class="heart">🩷</span>Adorable</a>
        <span class="hint">${esc(state.me?.email || '')}</span>
      </nav>
      <section class="hero">
        <h1>Build something <em>adorable</em></h1>
        <p class="sub">Describe an app. Watch it come to life in a live preview.</p>
        <div class="prompt-shell">
          <div class="prompt-card">
            <textarea id="home-prompt" placeholder="An app that…" autofocus></textarea>
            <div class="prompt-foot">
              <select class="ctl" id="home-model">
                ${state.models.map((m) => `<option value="${esc(m.id)}" ${m.id === state.defaultModel ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
              </select>
              <button class="btn btn-primary" id="home-go">Create ↑</button>
            </div>
          </div>
        </div>
        <div class="chips">
          ${EXAMPLES.map((e) => `<button class="chip" data-example="${esc(e)}">${esc(e)}</button>`).join('')}
        </div>
      </section>
      <section class="recents">
        <h2>Recent projects</h2>
        ${state.projects.length
          ? `<div class="grid">${state.projects
              .map(
                (p) => `
              <div class="card" data-open="${p.id}">
                <div class="name">${esc(p.name)}</div>
                <div class="meta">${esc((p.model || '').split('/')[1] || p.model)} · ${ago(p.updatedAt)}${p.publishedAt ? ' · published' : ''}</div>
                <button class="del" data-del="${p.id}" title="Delete project">✕</button>
              </div>`
              )
              .join('')}</div>`
          : `<div class="empty">Nothing yet — your first app is one prompt away.</div>`}
      </section>
    </div>`;

  const promptEl = document.getElementById('home-prompt');
  const go = () => {
    const prompt = promptEl.value.trim();
    if (prompt) createProject(prompt, document.getElementById('home-model').value);
  };
  document.getElementById('home-go').onclick = go;
  promptEl.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); }
  };
  app.querySelectorAll('[data-example]').forEach((c) => (c.onclick = () => { promptEl.value = c.dataset.example; promptEl.focus(); }));
  app.querySelectorAll('[data-open]').forEach((c) =>
    (c.onclick = (e) => { if (!e.target.dataset.del) openProject(c.dataset.open); }));
  app.querySelectorAll('[data-del]').forEach((b) =>
    (b.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this project?')) return;
      await api(`/api/projects/${b.dataset.del}`, { method: 'DELETE' });
      state.projects = state.projects.filter((p) => p.id !== b.dataset.del);
      renderHome();
    }));
}

/* ---------------- workspace ---------------- */

function renderWorkspace() {
  const p = state.project;
  document.title = `${p.name} — Adorable`;
  const versions = [...p.versions].reverse();
  const quota = state.me ? `${state.me.usedToday}/${state.me.dailyLimit} today` : '';

  destroyPreview();
  app.innerHTML = `
    <div class="ws">
      <header class="ws-top">
        <button class="btn-ghost btn" id="back" title="Back to projects">←</button>
        <a class="logo" href="#" id="home-link"><span class="heart">🩷</span></a>
        <input class="title" id="title" value="${esc(p.name)}" spellcheck="false" />
        <span class="spacer"></span>
        <span class="hint" title="Signed in · generations used today">${esc(state.me?.email || '')} · ${esc(quota)}</span>
        ${p.publishedAt ? `<a class="pub-link" href="/p/${p.id}/" target="_blank">/p/${p.id}/ ↗</a>` : ''}
        <select class="ctl" id="history" title="Version history">
          <option value="">History (${versions.length})</option>
          ${versions.map((v) => `<option value="${v.id}">${esc(v.label)} · ${ago(v.ts)}</option>`).join('')}
        </select>
        <a class="btn" href="/api/projects/${p.id}/export" download>Export</a>
        <button class="btn btn-primary" id="publish" ${state.publishing ? 'disabled' : ''} title="Static build; supports the default dependencies only">${state.publishing ? 'Publishing…' : 'Publish'}</button>
      </header>
      <div class="ws-main">
        <aside class="chat">
          <div class="chat-log" id="chat-log">${renderMessages(p)}</div>
          <div class="chat-input">
            <div class="box">
              <textarea id="chat-prompt" placeholder="Describe a change…" ${state.gen ? 'disabled' : ''}></textarea>
              <div class="row">
                <span class="hint">Enter to send · Shift+Enter for a new line</span>
                <button class="btn btn-primary" id="send" ${state.gen ? 'disabled' : ''}>Send</button>
              </div>
            </div>
          </div>
        </aside>
        <main class="panel">
          <div class="panel-bar">
            <button class="tab ${state.tab === 'preview' ? 'active' : ''}" data-tab="preview">Preview</button>
            <button class="tab ${state.tab === 'code' ? 'active' : ''}" data-tab="code">Code</button>
            <span class="spacer"></span>
            ${state.tab === 'preview'
              ? `
              <button class="icon-btn ${state.device === 'desktop' ? 'active' : ''}" data-device="desktop" title="Desktop width">🖥</button>
              <button class="icon-btn ${state.device === 'tablet' ? 'active' : ''}" data-device="tablet" title="Tablet width">▯</button>
              <button class="icon-btn ${state.device === 'phone' ? 'active' : ''}" data-device="phone" title="Phone width">▮</button>
              <button class="icon-btn" id="reload" title="Reload preview">⟳</button>`
              : ''}
          </div>
          ${state.tab === 'preview'
            ? `<div class="preview-wrap ${state.device}"><iframe id="preview" title="Live preview"></iframe></div>`
            : renderCode(p)}
        </main>
      </div>
    </div>`;

  wireWorkspace(p);
  if (state.tab === 'preview' && Object.keys(p.files).length) mountPreview();
  const log = document.getElementById('chat-log');
  log.scrollTop = log.scrollHeight;
}

function renderMessages(p) {
  const msgs = p.messages
    .map((m) => {
      const cls = m.kind === 'error' ? 'error' : m.role === 'user' ? 'user' : 'assistant';
      const vtag = m.versionId ? `<span class="vtag">v · ${esc(m.versionId)}</span>` : '';
      return `<div class="bubble ${cls}">${esc(m.content)}${vtag}<time>${ago(m.ts)}</time></div>`;
    })
    .join('');
  return msgs + (state.gen ? tickerHtml() : '');
}

function tickerHtml() {
  const g = state.gen;
  return `
    <div class="ticker" id="ticker">
      <div class="stage"><span class="dot"></span><span id="t-stage">${esc(g.stage)}</span></div>
      ${g.file ? `<div class="file" id="t-file">✎ ${esc(g.file)}</div>` : '<div class="file" id="t-file"></div>'}
      <div class="tail" id="t-tail">${esc(g.tail)}</div>
    </div>`;
}

function renderCode(p) {
  const files = Object.keys(p.files).sort();
  if (!files.length) return `<div class="code-wrap"><div class="empty" style="padding:24px">No files yet.</div></div>`;
  if (!state.selectedFile || !p.files[state.selectedFile]) state.selectedFile = files.includes('src/App.jsx') ? 'src/App.jsx' : files[0];
  return `
    <div class="code-wrap">
      <nav class="filetree">
        ${files.map((f) => `<button class="${f === state.selectedFile ? 'active' : ''}" data-file="${esc(f)}">${esc(f)}</button>`).join('')}
      </nav>
      <pre class="code-view">${esc(p.files[state.selectedFile])}</pre>
    </div>`;
}

function wireWorkspace(p) {
  document.getElementById('back').onclick = goHome;
  document.getElementById('home-link').onclick = (e) => { e.preventDefault(); goHome(); };

  const title = document.getElementById('title');
  title.onchange = async () => {
    const updated = await api(`/api/projects/${p.id}`, { method: 'PATCH', body: { name: title.value } });
    state.project.name = updated.name;
    document.title = `${updated.name} — Adorable`;
  };

  document.getElementById('history').onchange = async (e) => {
    const versionId = e.target.value;
    if (!versionId) return;
    if (!confirm('Restore this version? The preview will update to match.')) { e.target.value = ''; return; }
    state.project = await api(`/api/projects/${p.id}/restore`, { method: 'POST', body: { versionId } });
    renderWorkspace();
  };

  document.getElementById('publish').onclick = async () => {
    state.publishing = true;
    renderWorkspace();
    try {
      const { url } = await api(`/api/projects/${p.id}/publish`, { method: 'POST' });
      state.project.publishedAt = Date.now();
      state.publishing = false;
      renderWorkspace();
      window.open(url, '_blank');
    } catch (err) {
      state.publishing = false;
      pushLocalError(`Publish failed: ${err.message}`);
    }
  };

  const promptEl = document.getElementById('chat-prompt');
  const send = () => {
    const prompt = promptEl.value.trim();
    if (prompt && !state.gen) sendMessage(prompt);
  };
  document.getElementById('send').onclick = send;
  promptEl.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };
  if (!state.gen) promptEl.focus();

  app.querySelectorAll('[data-tab]').forEach((t) => (t.onclick = () => { state.tab = t.dataset.tab; renderWorkspace(); }));
  app.querySelectorAll('[data-device]').forEach((d) => (d.onclick = () => { state.device = d.dataset.device; renderWorkspace(); }));
  const reload = document.getElementById('reload');
  if (reload) reload.onclick = refreshPreview;
  app.querySelectorAll('[data-file]').forEach((f) => (f.onclick = () => { state.selectedFile = f.dataset.file; renderWorkspace(); }));
}

function pushLocalError(message) {
  state.project.messages.push({ role: 'assistant', kind: 'error', content: message, ts: Date.now() });
  renderWorkspace();
}

/* ---------------- actions ---------------- */

async function loadHome() {
  try {
    const [me, { models, default: def }, projects] = await Promise.all([
      api('/api/me'),
      api('/api/models'),
      api('/api/projects'),
    ]);
    state.me = me;
    state.models = models;
    state.defaultModel = def;
    state.projects = projects;
    state.view = 'home';
    renderHome();
  } catch (err) {
    app.innerHTML = `<div class="home"><section class="hero"><h1>Adorable</h1><p class="sub">${esc(err.message)}</p></section></div>`;
  }
}

function goHome() {
  state.project = null;
  state.gen = null;
  loadHome();
}

async function openProject(id) {
  state.project = await api(`/api/projects/${id}`);
  state.view = 'workspace';
  state.tab = 'preview';
  state.selectedFile = null;
  renderWorkspace();
}

async function createProject(prompt, model) {
  const { project, generationId } = await api('/api/projects', { method: 'POST', body: { prompt, model } });
  state.project = project;
  state.project.messages.push({ role: 'user', kind: 'chat', content: prompt, ts: Date.now() });
  state.view = 'workspace';
  state.tab = 'preview';
  openStream(generationId);
  renderWorkspace();
}

async function sendMessage(prompt) {
  const p = state.project;
  p.messages.push({ role: 'user', kind: 'chat', content: prompt, ts: Date.now() });
  try {
    const { generationId } = await api(`/api/projects/${p.id}/messages`, { method: 'POST', body: { prompt } });
    openStream(generationId);
    renderWorkspace();
  } catch (err) {
    pushLocalError(err.message);
  }
}

function openStream(generationId) {
  state.gen = { stage: 'Starting…', file: null, tail: '' };
  const es = new EventSource(`/api/generations/${generationId}/stream`);

  const updateTicker = () => {
    const stage = document.getElementById('t-stage');
    if (!stage) return;
    stage.textContent = state.gen.stage;
    document.getElementById('t-file').textContent = state.gen.file ? `✎ ${state.gen.file}` : '';
    document.getElementById('t-tail').textContent = state.gen.tail;
    const log = document.getElementById('chat-log');
    log.scrollTop = log.scrollHeight;
  };

  es.addEventListener('status', (e) => {
    state.gen.stage = JSON.parse(e.data).stage;
    updateTicker();
  });
  es.addEventListener('token', (e) => {
    const d = JSON.parse(e.data);
    state.gen.stage = `Generating (${(d.chars / 1000).toFixed(1)}k chars)`;
    state.gen.file = d.file;
    state.gen.tail = d.text;
    updateTicker();
  });
  es.addEventListener('files', (e) => {
    const d = JSON.parse(e.data);
    state.gen.stage = `Wrote ${d.paths.length} file${d.paths.length === 1 ? '' : 's'}`;
    updateTicker();
  });
  es.addEventListener('chat', () => {}); // reflected in project.messages on done
  es.addEventListener('done', async () => {
    es.close();
    state.gen = null;
    const [project, me] = await Promise.all([api(`/api/projects/${state.project.id}`), api('/api/me')]);
    state.project = project;
    state.me = me;
    renderWorkspace();
  });
  es.addEventListener('error', (e) => {
    es.close();
    state.gen = null;
    let message = 'Generation failed.';
    try { message = JSON.parse(e.data).message || message; } catch {}
    pushLocalError(message);
  });
}

loadHome();
