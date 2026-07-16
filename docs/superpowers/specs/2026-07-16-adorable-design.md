# Adorable — a Lovable.com clone (POC) — Design Spec

**Date:** 2026-07-16
**Status:** Approved scope: "everything real Lovable does, minus user accounts/login."

## Purpose

A local web app that turns natural-language prompts into working multi-file React apps and shows them in a live, self-updating preview — the core Lovable experience. Single-user, no auth.

## User-visible features

1. **Home screen** — Lovable-style hero with a large prompt box ("Build something…"), model picker, and a grid of recent projects (name, last-updated). Submitting the prompt creates a project and jumps into the workspace.
2. **Workspace** — split view:
   - **Left: chat panel.** Full message history for the project, prompt input for follow-up edits, live generation activity (streaming status: which file is being written, token stream tail), errors shown as chat messages.
   - **Right: preview/code panel.** Tabs:
     - **Preview** — iframe of the running app with hot updates; device-width toggle (desktop / tablet / phone); refresh button; open-in-new-tab.
     - **Code** — file tree of the generated project + read-only file viewer.
   - Top bar: project name (renameable), version history dropdown (restore any snapshot), Export (.zip download), Publish button.
3. **Iterative edits** — follow-up prompts modify the existing app. The model returns only changed/added files (plus optional deletions), merged into the project.
3a. **Conversational replies** — when a prompt is ambiguous (or is a question rather than a build request), the model may respond with a plain chat message / clarifying question instead of code. Response schema: `{"type":"chat","message":"…"}` vs `{"type":"code","files":[…],"deleted":[…],"summary":"…"}`. The user's answer continues the thread with full history as context.
4. **Version history** — every generation stores a full file snapshot with the prompt as its label; any version can be restored (restore creates a new snapshot).
5. **Publish** — builds the current project (`vite build`) and serves the static output at `http://localhost:3001/p/<projectId>/`; the URL is shown in the UI.
6. **Export** — download the project files as a zip.

## Architecture

Three parts in one repo, orchestrated by a root `npm run dev` (concurrently):

### `runner/` — shared preview engine (port 5199)
- One pre-installed Vite + React app. Tailwind available to generated apps via CDN script in `index.html` (no build config).
- Fixed, non-generatable files: `index.html`, `src/main.jsx` (imports `./App.jsx`).
- The server writes the **active project's** files into `runner/src/`; Vite HMR updates the iframe instantly. File watching uses polling (OneDrive-safe).
- Compile/runtime errors appear via Vite's error overlay inside the iframe.

### `server/` — Express API + static host (port 3001)
- Serves `client/` at `/`, published builds at `/p/<id>/`.
- **Generation:** calls OpenRouter chat completions (streaming) with a system prompt requiring a JSON manifest: `{"files":[{"path":"src/App.jsx","content":"…"}], "deleted":[], "summary":"…"}`. First generation returns the full app; edits return only changes. `src/App.jsx` must exist with a default export. Paths restricted to `src/`.
- **Streaming to client:** SSE per generation — events: `status`, `token` (tail of stream + currently-written file path parsed from partial JSON), `files`, `done`, `error`.
- **Robustness:** JSON extracted between first `{` and last `}`; on parse failure, one automatic retry appending a "return only valid JSON" corrective message; then a readable chat error. API/network errors surface in chat; server never crashes on generation failure.
- **Persistence:** `server/data/<projectId>/meta.json` (name, model, chat history, versions with full file snapshots, current files). Plain JSON on disk, no DB.
- **Endpoints:**
  - `GET /api/projects` · `POST /api/projects` (prompt, model) · `GET /api/projects/:id` · `PATCH /api/projects/:id` (rename) · `DELETE /api/projects/:id`
  - `POST /api/projects/:id/messages` (follow-up prompt) — response is the SSE stream id; `GET /api/generations/:genId/stream` (SSE)
  - `POST /api/projects/:id/activate` (write files into runner)
  - `POST /api/projects/:id/restore` (versionId)
  - `GET /api/projects/:id/export` (zip) · `POST /api/projects/:id/publish`
  - `GET /api/models` (static curated list)
- **Config:** `server/.env` — `OPENROUTER_API_KEY` (required), `OPENROUTER_MODEL` default `anthropic/claude-sonnet-4.5`.

### `client/` — builder UI (static, no build step)
- Vanilla JS + hand-written CSS, dark Lovable-like styling. Served by Express.
- Views: Home, Workspace. State kept in a small store; talks to the API + SSE.

## Error handling summary
- Invalid model JSON → retry once → chat error message.
- OpenRouter/API errors (bad key, rate limit) → chat error with the upstream message.
- Runner build errors → Vite overlay in preview (user can prompt "fix the error"; the current files are always sent as context).
- Publish build failure → error toast with stderr tail.

## Explicitly out of scope
User accounts/login, teams, custom domains, GitHub sync, Supabase integrations, real deployment, element-level visual editing.

## Verification
End-to-end with headless browser: create project from prompt → preview renders → follow-up edit hot-updates preview → code view shows files → restore a version → export zip → publish and load `/p/<id>/`.
