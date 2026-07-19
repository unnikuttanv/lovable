# Adorable — Project Scope / Statement of Work

**Project:** "Adorable", a functional clone of [lovable.dev](https://lovable.dev) built as an MVP
**Repository:** this repo · **Detailed designs:** [docs/superpowers/specs/](docs/superpowers/specs/)
**Status:** MVP delivered and verified end-to-end (2026-07-17)

## 1. Project overview

Lovable.dev turns natural-language prompts into working web applications with a live preview, chat-based iteration, and one-click publishing. This project delivers the same core loop as a self-hostable MVP for internal company use: a colleague types a prompt, an agentic AI pipeline plans → architects → codes a multi-file React app, a live preview renders it instantly in the browser, and the app can be iterated through chat, versioned, exported, or published to a URL.

The guiding scope decision (agreed at kickoff): **everything real Lovable does except user accounts/login**, with identity instead supplied by the company SSO proxy.

## 2. Objectives

1. Prove the prompt-to-app loop end-to-end with production-grade structure (not a throwaway demo).
2. Make it safely multi-user for ~50+ colleagues behind company SSO, with cost controls.
3. Keep the AI pipeline simple enough to understand and explain (plan/architect/coder agents with typed contracts).
4. Ship as a one-command Docker Compose deployment.

## 3. In scope — delivered

### Core builder loop (Lovable parity)

| Capability | Lovable.dev | This MVP |
|---|---|---|
| Prompt → working app | ✅ | ✅ Multi-file React + Tailwind, any npm dependency |
| Agentic generation | ✅ (hidden) | ✅ Visible pipeline: plan() → architect() → coder(), LangGraph |
| Clarifying questions (chat) | ✅ | ✅ Human-in-the-loop interrupt: ambiguous prompts pause and resume on your answer |
| Live preview | ✅ cloud sandbox | ✅ In-browser (Sandpack) — per-user, concurrent, zero server-side code execution |
| Chat-based edits | ✅ | ✅ Diff-style: only changed files are regenerated |
| Streaming build activity | ✅ | ✅ Per-file ticker ("Writing src/App.jsx (2/6)") |
| Code viewer | ✅ | ✅ File tree + read-only viewer |
| Version history + restore | ✅ | ✅ Snapshot per generation, one-click restore |
| Publish to URL | ✅ hosted | ✅ Static build served at `/p/<id>/` (company-internal) |
| Export code | ✅ GitHub | ✅ Zip download with package.json |
| Model selection | — | ✅ Any common model via OpenRouter (Claude, GPT, Gemini, DeepSeek, Llama) |
| Responsive preview toggle | ✅ | ✅ Desktop / tablet / phone widths |

### Multi-user platform (replaces Lovable's accounts)

- **Identity:** trusted SSO-proxy header (Cloudflare Access default; oauth2-proxy/Tailscale supported); per-user project isolation (owner-scoped API, 404 across users).
- **Cost control:** one company OpenRouter key, per-user daily generation quota (default 50), usage shown in the UI.
- **Storage:** Postgres (auto-schema) in production; JSON-on-disk fallback for local dev.
- **Packaging:** Dockerfile + docker-compose (app + Postgres); deployment recipes in [DEPLOY.md](DEPLOY.md).
- **Security model:** generated code never executes on the server (preview bundles in the user's browser; publish only bundles, with `--ignore-scripts` npm installs and argv-only subprocesses; command-injection hardening verified).

### Acceptance evidence

All flows verified in a real browser during development: create → preview, edit → hot update, clarify → resume, restore, export, publish (including extra npm deps), multi-user isolation, quota enforcement, Dockerized boot against Postgres.

## 4. Assumptions & constraints

- Generated apps are **client-side single-page React apps** (localStorage persistence, mock/seed data); the platform does not provision backends for them.
- Users' browsers need internet access (Sandpack resolves npm packages from CodeSandbox's CDN).
- The app must only be reachable through the SSO proxy — identity headers are trusted.
- LLM spend scales at ~N+2 model calls per generation for an N-file app.

## 5. Out of scope (MVP) — and why

| Lovable.dev capability | Why deferred |
|---|---|
| User accounts, billing, credit plans | Explicit kickoff decision — SSO replaces accounts; billing is irrelevant internally |
| Backend integrations (Supabase: auth, database, storage, edge functions) | Biggest single scope item at Lovable; generated apps here are front-end only |
| GitHub two-way sync | Export-as-zip covers the MVP need |
| Custom domains + public CDN hosting | Publishing is company-internal by design |
| Visual element editing (click an element, edit it) | High UI effort, orthogonal to the core loop |
| Image/screenshot-to-app prompts, Figma import | Multimodal input pipeline not started |
| Templates, community gallery, project remixing | Community features presume a public product |
| Real-time team collaboration (multiplayer editing) | Projects are single-owner in the MVP |
| Security scanning of generated code | Mitigated instead by the no-server-execution architecture |
| Admin dashboard, token-level cost metering | Quotas + OpenRouter dashboard suffice for now |

## 6. Next stages (proposed roadmap)

**Phase 2 — reliability & quality of the core loop**
1. **Self-healing builds:** bundle-check generated code (esbuild) and auto-fix compile errors before showing the preview — removes the "red error screen" failure mode. (Highest value/effort ratio.)
2. **Durable clarifications:** LangGraph Postgres checkpointer so paused questions survive restarts.
3. Per-project publish environments (isolated node_modules) to remove version-clobbering.
4. Pin Sandpack assets / self-host the bundler for offline or locked-down networks.

**Phase 3 — Lovable feature depth**
5. Backend provisioning for generated apps (Supabase or company Postgres): auth, data, storage.
6. GitHub sync (repo per project, commits per version).
7. Visual element editing and image-based prompting.
8. Templates and project remixing within the company.

**Phase 4 — platform maturity**
9. Admin dashboard: per-user spend, model allow-lists, project analytics.
10. Team/shared projects with roles; real-time collaboration.
11. Custom domain publishing if apps ever need to leave the intranet.

## 7. Deliverables checklist (all in this repo)

- [x] `pyserver/` — FastAPI + LangChain/LangGraph backend (agents, SSE streaming, storage, quotas)
- [x] `client/` — Lovable-style builder UI (home, chat workspace, Sandpack preview, code view)
- [x] `runner/` — publish build engine
- [x] `Dockerfile`, `docker-compose.yml`, [DEPLOY.md](DEPLOY.md) — production deployment with SSO recipes
- [x] [README.md](README.md) — setup, architecture, current limitations
- [x] `docs/superpowers/` — design specs and implementation plans for every stage (historical stages stamped as superseded)
