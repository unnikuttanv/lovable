# Adorable — a Lovable.com clone

Type a prompt → get a working multi-file React app → watch it render in a live, self-updating preview. Iterate through chat, browse the code, restore versions, export a zip, or publish a static build.

Two modes:

- **Local dev** (below): run it on your machine, identity is `DEV_USER`, projects stored as JSON on disk.
- **Team deployment**: Docker Compose (app + Postgres) behind your company SSO proxy — every colleague gets their own projects and daily generation quota, and previews run in each user's browser (no generated code executes on the server). See **[DEPLOY.md](DEPLOY.md)**.

## Setup

```bash
npm run install:all
```

Put your OpenRouter key in `server/.env`:

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
 ├─ chat panel ──POST prompt──▶ Express API (server/, :3001)
 │      ◀──SSE stream (status/tokens/files)──┤
 │                                           │ calls OpenRouter → JSON file manifest
 │                                           ▼
 └─ preview iframe ◀── Sandpack bundles the files IN THE BROWSER
                       (per-user, concurrent, sandboxed)
```

- **server/** — Express API. SSO-header identity, per-user projects + daily quotas, calls OpenRouter (streaming), parses a JSON manifest of files, persists to Postgres (`DATABASE_URL`) or disk, streams progress via SSE.
- **client/** — static builder UI (no build step): home screen + Lovable-style workspace (chat left, preview/code right). The preview is a Sandpack client: generated files + their npm `dependencies` bundle in your browser.
- **runner/** — pre-installed Vite + React app used **only** to `vite build` published projects (`/p/<id>/`). Bundling never executes generated app code.

## Features

- Prompt → multi-file React app (model returns `{"type":"code","files":[...]}`)
- Conversational mode: ambiguous prompts get a clarifying question instead of code
- Iterative edits (model returns only changed files)
- Live preview with device-width toggle, code view with file tree
- Version history with restore
- Export as zip, publish static build at `/p/<id>/`
- Model picker (any common model via OpenRouter)

## POC tradeoffs

- Generated apps may only import `react`, `react-dom`, `lucide-react`; styling via Tailwind utility classes (Tailwind Play CDN script, self-hosted copy in `runner/public/`).
- Projects are JSON on disk; generations are in-memory during streaming.
- One preview at a time (shared runner) — switching projects swaps files.
