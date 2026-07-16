# Adorable Team Edition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-user POC into a multi-user, company-deployable service per `2026-07-16-team-edition-design.md`.

**Architecture:** Sandpack moves preview execution into each user's browser; the server becomes a stateless-ish API with Postgres (or disk fallback) storage, SSO-header identity, per-user quotas; runner is publish-build-only; everything ships as Docker Compose.

**Tech Stack:** adds `pg`; `@codesandbox/sandpack-client@2` via esm.sh in the client; postgres:16 + node:22-alpine images.

## Global Constraints
- Env: `DATABASE_URL` (optional), `AUTH_EMAIL_HEADER` default `cf-access-authenticated-user-email`, `DEV_USER` fallback, `DAILY_GENERATION_LIMIT` default 50, existing `OPENROUTER_API_KEY`/`OPENROUTER_MODEL`.
- All store functions are async; routes await them.
- Owner scoping: every project row/record carries `owner` (email); cross-user access → 404.
- Default project dependencies: `{"react":"^18.3.1","react-dom":"^18.3.1","lucide-react":"^0.454.0"}`.
- Plain commit messages, no attribution trailers.

### Task 1: Storage layer (`server/src/stores/`)
- Create `server/src/stores/diskStore.js` (move/adapt current store.js + usage in `data/_usage.json`), `server/src/stores/pgStore.js` (pg Pool, auto-schema), `server/src/storage.js` (picks by `DATABASE_URL`, exports the interface).
- Interface: `init()`, `listProjects(owner)`, `createProject({name,model,owner})`, `getProject(id, owner)`, `saveProject(project)`, `deleteProject(id, owner)`, `getUsage(email)`, `incrementUsage(email)`.
- Verify: server boots with no DATABASE_URL (disk); CRUD round-trip via curl with DEV_USER. Commit.

### Task 2: Auth + quotas
- `server/src/auth.js`: middleware sets `req.userEmail` from header (lowercased env name), else `DEV_USER`, else 401. Mount on `/api`.
- `GET /api/me` → `{ email }`.
- In generation start: `getUsage(email) >= DAILY_GENERATION_LIMIT` → SSE error "Daily limit of N generations reached — resets at midnight UTC."; else `incrementUsage`.
- All project routes owner-scoped; `startGeneration` records owner; stream endpoint 404s for other owners.
- Verify: two emails via curl header see disjoint lists; limit=1 blocks second generation. Commit.

### Task 3: Generation manifest + prompts
- Manifest: optional `dependencies` object merged into `project.dependencies` (defaults above); prompt updated: any npm package allowed if declared in `dependencies`; still Tailwind classes, still `src/App.jsx` default export; remove runner `activateProject` call from generation `done` path (preview is client-side now).
- Verify: generation returns files; project JSON includes dependencies. Commit.

### Task 4: Client — Sandpack preview + identity UI
- `client/index.html`: `<script type="module" src="/app.js">`.
- `client/app.js`: preview pane hosts an iframe managed by `loadSandpackClient` (esm.sh); files mapping `src/X`→`/X`, synthesized `/package.json` from `project.dependencies`, fixed `/index.js`; `externalResources: ["https://cdn.tailwindcss.com"]`; update via `updateSandbox` on done/restore; device toggle wraps iframe width; refresh recreates the client; topbar shows `me.email` and remaining daily quota; quota/auth errors render as chat error bubbles.
- Open-in-new-tab is removed (preview is per-browser now); Publish link stays.
- Verify (browser): create project → Sandpack preview renders; edit updates it; restore works; code/export/publish work. Commit.

### Task 5: Publish queue
- `server/src/publish.js`: module-level promise chain serializes builds; note in UI copy that published builds support only default deps.
- Verify: publish two projects back-to-back; both succeed sequentially. Commit.

### Task 6: Docker + deploy docs
- `Dockerfile` (node:22-alpine; copy server+runner+client; `npm ci` both; CMD `node server/src/index.js`), `.dockerignore`, `docker-compose.yml` (app+postgres+volume, env passthrough), `DEPLOY.md` (VM, Cloudflare Access recipe, oauth2-proxy recipe, backups, key rotation).
- Verify: `docker build` if Docker present, else lint-by-eye + note. Commit.

### Task 7: E2E verification
- Headless browser: full flow with Sandpack; multi-user isolation via curl; quota test; README update. Final commit + merge.

## Self-Review (done)
Spec coverage: Sandpack (T4), deps manifest (T3), identity (T2), Postgres+fallback (T1), quotas (T2), publish queue (T5), Docker/deploy (T6), verification (T7). Placeholders: none. Interface names consistent across tasks.
