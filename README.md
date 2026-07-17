# Adorable — a Lovable.com clone

Type a prompt → get a working multi-file React app → watch it render in a live, self-updating preview. Iterate through chat, browse the code, restore versions, export a zip, or publish a static build.

Two modes:

- **Local dev** (below): run it on your machine, identity is `DEV_USER`, projects stored as JSON on disk.
- **Team deployment**: Docker Compose (app + Postgres) behind your company SSO proxy — every colleague gets their own projects and daily generation quota, and previews run in each user's browser (no generated code executes on the server). See **[DEPLOY.md](DEPLOY.md)**.

## Setup

```bash
npm run install:all
```

Put your OpenRouter key in `pyserver/.env` (copy `pyserver/.env.example`):

```
OPENROUTER_API_KEY=sk-or-...
```

Then:

```bash
npm run dev
```

Open **http://localhost:3001**.

## How it works

```
Browser (builder UI, served at :3001)
 ├─ chat panel ──POST prompt──▶ FastAPI (pyserver/, :3001)
 │      ◀──SSE (stages/tokens/files)──┤
 │                                    │  LangGraph pipeline (via OpenRouter):
 │                                    │  plan() ─┬─▶ architect() ─▶ coder()
 │                                    │          └─▶ clarify() = interrupt(),
 │                                    │              resumes on your next message
 └─ preview iframe ◀── Sandpack bundles the files IN THE BROWSER
                       (per-user, concurrent, sandboxed)
```

- **pyserver/** — FastAPI + LangChain/LangGraph backend. Each prompt runs a staged agent pipeline: **plan()** (build plan, or a clarifying question via a checkpointed `interrupt()` that your next chat message resumes, or a plain chat reply), **architect()** (file layout + npm dependencies), **coder()** (full file contents, streamed). SSO-header identity, per-user projects + daily quotas, Postgres (`DATABASE_URL`) or disk persistence.
- **client/** — static builder UI (no build step): home screen + Lovable-style workspace (chat left, preview/code right). The preview is a Sandpack client: generated files + their npm `dependencies` bundle in your browser.
- **runner/** — pre-installed Vite + React app used **only** to `vite build` published projects (`/p/<id>/`). Bundling never executes generated app code, and project-declared npm packages are installed with `--ignore-scripts`.

## Features

- Prompt → multi-file React app (model returns `{"type":"code","files":[...]}`)
- Conversational mode: ambiguous prompts get a clarifying question instead of code
- Iterative edits (model returns only changed files)
- Live preview with device-width toggle, code view with file tree
- Version history with restore
- Export as zip, publish static build at `/p/<id>/`
- Model picker (any common model via OpenRouter)

## Current limitations

- A pending clarification (paused graph) lives in an in-memory checkpointer — it does not survive a server restart; just re-send the prompt. (Upgrade path: LangGraph's Postgres checkpointer.)
- Publish builds share one runner: two projects pinning conflicting versions of the same npm package overwrite each other sequentially.
- The Sandpack preview fetches npm packages from CodeSandbox's CDN, so users' browsers need internet access.
- Each generation costs ~N+2 model calls for an N-file app (plan + architect + one per file).
