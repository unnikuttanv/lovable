# Adorable — a Lovable.com clone (POC)

Type a prompt → get a working multi-file React app → watch it render in a live, self-updating preview. Iterate through chat, browse the code, restore versions, export a zip, or publish a static build.

No accounts/login — single-user local tool.

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
 └─ preview iframe ◀──HMR── Vite runner (runner/, :5199) ◀── files written to runner/src/
```

- **server/** — Express API. Calls OpenRouter (streaming), parses a JSON manifest of files, persists projects to `server/data/`, streams progress to the UI via SSE, writes the active project's files into the runner.
- **runner/** — one pre-installed Vite + React app. Generated files land in its `src/`; Vite HMR updates the preview instantly. `src/main.jsx` is fixed; generated apps must export a default component from `src/App.jsx`.
- **client/** — static builder UI (no build step): home screen + Lovable-style workspace (chat left, preview/code right).

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
