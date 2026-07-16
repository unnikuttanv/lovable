# Adorable Team Edition — Production Design Spec

**Date:** 2026-07-16
**Builds on:** 2026-07-16-adorable-design.md (POC). Approved scope: multi-user company deployment; Sandpack preview, SSO-header identity, Postgres, quotas, Docker.

## Goals

Colleagues open a company URL, SSO in, and each get their own projects with concurrent live previews. No generated code executes on the server. One OpenRouter key, per-user daily quotas.

## Changes from the POC

### 1. Preview: Sandpack (in-browser)
- The workspace preview becomes a Sandpack client (`@codesandbox/sandpack-client` via esm.sh, create-react-app template): generated files + a synthesized `package.json` are bundled in the user's browser. Tailwind injected via `externalResources`.
- File mapping: project path `src/X` → Sandpack `/X`. Fixed entry `/index.js` (imports `./App.jsx`). Relative imports between generated files keep working (uniform shift).
- Generated apps may now declare **any npm dependency**: manifest gains optional `"dependencies": {"pkg":"version"}`; stored per project (defaults: react 18, react-dom 18, lucide-react). System prompt updated accordingly.
- Every user previews their own project simultaneously; the server never runs generated code.
- The Vite runner remains **only** as the Publish build engine (`vite build` bundles but does not execute app code). Publish builds are serialized by an in-process queue. Note: published builds only support the POC dependency set (react/react-dom/lucide-react) since the runner has a fixed node_modules; the UI states this. Preview supports arbitrary deps.

### 2. Identity: trusted SSO header
- `AUTH_EMAIL_HEADER` env names the header carrying the authenticated email. Default `cf-access-authenticated-user-email` (Cloudflare Access); oauth2-proxy users set `x-auth-request-email`.
- If the header is absent: fall back to `DEV_USER` env; if neither, respond 401. The app must only be reachable through the proxy (documented in DEPLOY.md).
- `GET /api/me` → `{ email }`. Every project has `owner`; list/get/mutate are owner-scoped (404 for others' projects). SSE generation streams carry the owner and are checked.

### 3. Storage: Postgres with disk fallback
- `DATABASE_URL` set → Postgres store (`pg` pool). Schema auto-created at boot:
  - `projects(id text primary key, owner text not null, data jsonb not null, updated_at bigint)` + index on owner.
  - `usage(user_email text, day date, count int, primary key(user_email, day))`.
- No `DATABASE_URL` → existing JSON-on-disk store (dev fallback), usage kept in a JSON file.
- Store interface (async): `listProjects(owner)`, `createProject({name, model, owner})`, `getProject(id, owner)`, `saveProject(project)`, `deleteProject(id, owner)`, `getUsage(email)`, `incrementUsage(email)`.

### 4. Quotas
- `DAILY_GENERATION_LIMIT` (default 50) generations per user per day. Checked before calling the model; exceeding returns a readable SSE error shown in chat.

### 5. Packaging & deployment
- `Dockerfile`: node:22-alpine, installs server + runner deps, copies client, runs the server.
- `docker-compose.yml`: app + postgres:16 with volume; env passthrough for `OPENROUTER_API_KEY`, `AUTH_EMAIL_HEADER`, `DAILY_GENERATION_LIMIT`.
- `DEPLOY.md`: VM setup, Cloudflare Access recipe, oauth2-proxy (Google Workspace) recipe, key rotation, backups.

## Out of scope (v1)
Admin dashboard, cross-user project sharing, token-level cost metering, sandboxed server-side dev servers, model allow-listing per user.

## Error handling additions
- 401 when no identity; 404 on cross-user access; 429-style SSE error at quota; Postgres connection failure fails boot loudly.

## Verification
- Local (disk fallback, DEV_USER): create/edit project → Sandpack preview renders and updates; code tab, restore, export, publish still work.
- Multi-user isolation: two identities via header injection see disjoint project lists and cannot fetch each other's projects.
- Quota: with DAILY_GENERATION_LIMIT=1, second generation is refused with a clear message.
- Docker: compose build succeeds (runtime verified where Docker is available).
