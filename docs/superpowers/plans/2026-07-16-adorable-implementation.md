# Adorable (Lovable Clone POC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local prompt-to-app builder: prompts become multi-file React apps rendered in a live self-updating preview, with chat iteration, versions, export, and publish.

**Architecture:** Express server (port 3001) serves the builder UI, calls OpenRouter for code generation streamed to the browser over SSE, and persists projects as JSON on disk. A single shared Vite+React "runner" (port 5199) receives the active project's files in its `src/` and provides the live preview via HMR.

**Tech Stack:** Node 22, Express 4, dotenv, archiver (zip), Vite 5 + React 18 + Tailwind (CDN) for the runner, vanilla JS/CSS client, OpenRouter chat completions API (streaming).

## Global Constraints

- No user accounts/login (spec: out of scope).
- Server port **3001**, runner port **5199** (strictPort).
- Config via `server/.env`: `OPENROUTER_API_KEY` (required), `OPENROUTER_MODEL` default `anthropic/claude-sonnet-4.5`.
- Generated file paths MUST start with `src/`, must not contain `..`, and must never be `src/main.jsx` (fixed runner entry).
- Generated apps may import only `react`, `react-dom`, and `lucide-react`; styling via Tailwind utility classes (CDN in runner).
- Vite watcher uses polling (project lives under OneDrive).
- All server data under `server/data/<projectId>/meta.json`; published builds under `server/published/<id>/`.
- Plain commit messages, no Claude attribution trailers.

---

### Task 1: Repo scaffold

**Files:**
- Create: `package.json` (root), `.gitignore`, `README.md`

**Interfaces:**
- Produces: `npm run dev` at root → starts server + runner concurrently. `npm run install:all` installs root+server+runner.

- [ ] **Step 1:** Root `package.json`:

```json
{
  "name": "adorable",
  "private": true,
  "scripts": {
    "install:all": "npm install && npm --prefix server install && npm --prefix runner install",
    "dev": "concurrently -n server,runner -c blue,magenta \"npm --prefix server run dev\" \"npm --prefix runner run dev\""
  },
  "devDependencies": { "concurrently": "^9.0.0" }
}
```

- [ ] **Step 2:** `.gitignore`: `node_modules/`, `server/.env`, `server/data/`, `server/published/`, `runner/dist/`, plus runner `src/` generated files are gitignored except `runner/src/main.jsx` and `runner/src/App.jsx` (welcome screen): use `runner/src/*`, `!runner/src/main.jsx`, `!runner/src/App.jsx`.
- [ ] **Step 3:** `README.md`: what it is, setup (`npm run install:all`, put key in `server/.env`, `npm run dev`, open http://localhost:3001), architecture sketch.
- [ ] **Step 4:** Commit `chore: scaffold repo`.

### Task 2: Runner (preview engine)

**Files:**
- Create: `runner/package.json`, `runner/vite.config.js`, `runner/index.html`, `runner/src/main.jsx`, `runner/src/App.jsx`

**Interfaces:**
- Produces: dev server at `http://localhost:5199` rendering `runner/src/App.jsx` (default export). Server task writes files into `runner/src/`.

- [ ] **Step 1:** `runner/package.json` deps: `react@^18`, `react-dom@^18`, `lucide-react`; dev: `vite@^5`, `@vitejs/plugin-react`. Script `dev`: `vite`.
- [ ] **Step 2:** `runner/vite.config.js`:

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5199,
    strictPort: true,
    watch: { usePolling: true, interval: 300 },
  },
});
```

- [ ] **Step 3:** `runner/index.html` — `<div id="root">`, Tailwind CDN `<script src="https://cdn.tailwindcss.com"></script>`, module script `/src/main.jsx`.
- [ ] **Step 4:** `runner/src/main.jsx` (FIXED, never overwritten):

```jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
createRoot(document.getElementById('root')).render(<App />);
```

- [ ] **Step 5:** `runner/src/App.jsx` — welcome placeholder ("No project active yet — create one from the builder").
- [ ] **Step 6:** Verify: `npm --prefix runner install && npm --prefix runner run dev` → GET http://localhost:5199 returns HTML; welcome renders.
- [ ] **Step 7:** Commit `feat: add shared Vite runner`.

### Task 3: Server core — projects store + CRUD

**Files:**
- Create: `server/package.json`, `server/.env.example`, `server/.env` (placeholder), `server/src/index.js`, `server/src/store.js`

**Interfaces:**
- Produces (store.js): `listProjects()`, `createProject({name, model})`, `getProject(id)`, `saveProject(p)`, `deleteProject(id)`. Project shape:

```js
{ id, name, model, createdAt, updatedAt,
  messages: [{ role: 'user'|'assistant', kind: 'chat'|'code'|'error', content, versionId?, ts }],
  files: { 'src/App.jsx': '...' },
  versions: [{ id, label, ts, files }],
  publishedAt: null }
```

- Produces (HTTP): `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`, `GET /api/models`, static `client/` at `/`, static `server/published` at `/p`.

- [ ] **Step 1:** `server/package.json`: deps `express@^4`, `dotenv`, `archiver`; script `dev`: `node src/index.js`.
- [ ] **Step 2:** `store.js` — dir-per-project `server/data/<id>/meta.json`, sync fs JSON read/write, id via `crypto.randomUUID().slice(0,8)`.
- [ ] **Step 3:** `index.js` — express json (limit 10mb), routes above; `GET /api/models` returns curated static list (Claude Sonnet 4.5 default-first, GPT-4o, Gemini 2.5 Flash, DeepSeek v3, Llama 3.3 70B).
- [ ] **Step 4:** Verify with curl: create/list/get/rename/delete round-trip.
- [ ] **Step 5:** Commit `feat: server core with project store`.

### Task 4: Generation pipeline (OpenRouter + SSE + runner sync)

**Files:**
- Create: `server/src/openrouter.js`, `server/src/prompts.js`, `server/src/generation.js`, `server/src/runnerSync.js`
- Modify: `server/src/index.js`

**Interfaces:**
- `openrouter.js`: `streamChat({model, messages, onToken}) -> fullText` (throws on HTTP error with upstream message).
- `prompts.js`: `SYSTEM_PROMPT` (see below), `buildMessages(project, userPrompt)` → includes current files serialized for edit turns.
- `generation.js`: `startGeneration(project, userPrompt) -> generationId`; in-memory Map of generations, each buffering events for SSE replay. Events: `status {stage}`, `token {text, file}`, `chat {message}`, `files {paths, summary}`, `done {versionId}`, `error {message}`.
- `runnerSync.js`: `activateProject(project)` — clears `runner/src/*` except `main.jsx`, writes `project.files`; validates paths per Global Constraints.
- HTTP: `POST /api/projects` (body `{prompt, model}`) → `{project, generationId}`; `POST /api/projects/:id/messages` (body `{prompt}`) → `{generationId}`; `GET /api/generations/:genId/stream` (SSE, replays buffered events); `POST /api/projects/:id/activate`.

**Model contract (SYSTEM_PROMPT core):** respond with ONE JSON object, no markdown fences:
- Build/edit: `{"type":"code","summary":"…","files":[{"path":"src/…","content":"…"}],"deleted":["src/…"]}` — first turn: complete app incl. `src/App.jsx` (default export); edit turns: changed/added files only.
- Ambiguous/question: `{"type":"chat","message":"…"}`.
- Only `react`, `react-dom`, `lucide-react` imports; Tailwind classes for styling; no fetch to external APIs unless asked; produce polished, modern UI.

- [ ] **Step 1:** Implement `openrouter.js` with fetch streaming (`text/event-stream` line parsing, accumulate `choices[0].delta.content`).
- [ ] **Step 2:** Implement `prompts.js`; edit turns serialize current files as `--- path ---\ncontent` blocks; include recent chat history (last 12 messages, content truncated).
- [ ] **Step 3:** Implement `generation.js`: parse JSON between first `{`/last `}`; on failure retry once with corrective user message `"Your previous reply was not valid JSON. Respond again with ONLY the JSON object."`; validate paths; merge files (apply `deleted`); push version snapshot `{id, label: prompt.slice(0,80), ts, files}`; append assistant message; save; `activateProject`; emit `done`. During stream, emit `token` events (throttled ~100ms) with current file path scraped from partial JSON via last `"path"\s*:\s*"([^"]+)"` match.
- [ ] **Step 4:** Wire routes in `index.js`. SSE: set headers, replay buffer, subscribe; end on `done`/`error`.
- [ ] **Step 5:** Verify with real key: `curl -N` the SSE stream for a "counter app" prompt → files written to `runner/src/`, preview renders.
- [ ] **Step 6:** Commit `feat: OpenRouter generation pipeline with SSE`.

### Task 5: Versions, export, publish

**Files:**
- Create: `server/src/publish.js`
- Modify: `server/src/index.js`

**Interfaces:**
- HTTP: `POST /api/projects/:id/restore` `{versionId}` → restores snapshot as new version, activates, returns project; `GET /api/projects/:id/export` → zip attachment (files + generated README); `POST /api/projects/:id/publish` → `{url: "/p/<id>/"}`.
- `publish.js`: `publishProject(project)` — activate files, run `npx vite build --base=/p/<id>/ --outDir <abs server/published/id> --emptyOutDir` in `runner/` (spawn with `shell: true` for Windows), reject with stderr tail on non-zero exit.

- [ ] **Step 1:** Implement restore (snapshot copy → new version entry + assistant chat message "Restored version …").
- [ ] **Step 2:** Implement export with `archiver` streaming to response.
- [ ] **Step 3:** Implement publish; serve `server/published` statically at `/p` (already from Task 3).
- [ ] **Step 4:** Verify: restore flips preview; zip downloads and contains files; `/p/<id>/` serves built app.
- [ ] **Step 5:** Commit `feat: versions, export, publish`.

### Task 6: Client UI (Lovable-style)

**Files:**
- Create: `client/index.html`, `client/styles.css`, `client/app.js`

**Interfaces:**
- Consumes every endpoint above. Preview iframe → `http://localhost:5199` (reload via `iframe.src` reset on `done`).

- [ ] **Step 1:** Home view — dark hero, gradient accent, big prompt textarea (Enter submits), model select (from `/api/models`), recent projects grid (open/delete).
- [ ] **Step 2:** Workspace view — top bar (back, renameable title, version dropdown, Export, Publish, published-URL link); left chat panel (history bubbles by kind, generation activity block showing stage + current file + streaming tail, input box); right panel tabs Preview/Code; Preview: device-width toggle (100% / 768px / 390px), refresh, open-in-new-tab; Code: file tree list + read-only `<pre>` viewer.
- [ ] **Step 3:** SSE wiring — EventSource per generation; render `status`/`token`/`chat`/`files`; on `done` refetch project + bump iframe; on `error` show error bubble.
- [ ] **Step 4:** Style pass — Lovable-ish: near-black background, subtle borders, rounded-xl cards, Inter font, pink/orange gradient accents.
- [ ] **Step 5:** Verify in browser: full flow clickable.
- [ ] **Step 6:** Commit `feat: builder UI`.

### Task 7: End-to-end verification

- [ ] **Step 1:** `npm run install:all`; confirm `server/.env` has real key (ask user if placeholder).
- [ ] **Step 2:** `npm run dev` (background); GET 3001 + 5199 OK.
- [ ] **Step 3:** Headless browser: create project ("todo app with dark UI") → preview shows todo app; follow-up "add a header with the app name and a clear-all button" → preview hot-updates; ambiguous prompt → chat-mode reply; Code tab shows files; restore version 1 → preview reverts; export zip (HTTP 200, valid zip); publish → `/p/<id>/` renders.
- [ ] **Step 4:** Fix issues found (systematic-debugging if nontrivial), commit fixes.
- [ ] **Step 5:** Final commit + summary to user.

## Self-Review (done)

- **Spec coverage:** home ✓(T6), workspace/chat/preview/code ✓(T6), streaming ✓(T4), edits diff-based ✓(T4 prompt contract), chat-mode replies ✓(T4), versions/restore ✓(T5), export ✓(T5), publish ✓(T5), device toggle ✓(T6), error handling ✓(T4 retry + error events, Vite overlay inherent), persistence ✓(T3), models endpoint ✓(T3). No gaps.
- **Placeholder scan:** none.
- **Type consistency:** project shape (T3) used by T4/T5/T6 consistently; event names match between T4 and T6.
