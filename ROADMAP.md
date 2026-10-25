# Roadmap

What's next for Adorable, roughly in priority order. Effort estimates are rough.

## Now — reliability & quality of the core loop

- [ ] **Test suite** (~6 h): pytest for `pyserver/` — API routes, owner-scoped project isolation, quota enforcement, storage backends (disk + Postgres), and the LangGraph pipeline with a mocked LLM. Add a GitHub Actions workflow to run it on every push.
- [ ] **Self-healing builds** (~6 h): bundle-check generated code with esbuild before showing the preview and feed compile errors back to the coder agent for an automatic fix pass — removes the "red error screen" failure mode.
- [ ] **Durable clarifications** (~3 h): swap the in-memory `MemorySaver` for LangGraph's Postgres checkpointer so a paused clarifying question survives a server restart.
- [ ] **Isolated publish environments** (~4 h): per-project `node_modules` for the publish runner so two projects pinning different versions of the same npm package can't overwrite each other.
- [ ] **Offline-capable preview** (~3 h): pin / self-host the Sandpack bundler assets so the preview works on locked-down networks.

## Next — feature depth

- [ ] **GitHub sync** (~6 h): one repo per project, one commit per version, alongside the existing zip export.
- [ ] **Backend provisioning for generated apps** (~10 h): optional Supabase or Postgres-backed auth/data/storage for generated apps instead of localStorage only.
- [ ] **Image / screenshot-to-app prompts** (~5 h): multimodal input to the plan step.
- [ ] **Visual element editing** (~8 h): click an element in the preview and edit it via chat.
- [ ] **Templates and project remixing** (~4 h).

## Later — platform maturity

- [ ] Admin dashboard: per-user spend, model allow-lists, project analytics.
- [ ] Shared projects with roles; real-time collaboration.
- [ ] Custom-domain publishing.

## Docs

- [ ] Architecture walkthrough with a sequence diagram of one generation (prompt → plan → architect → coder → SSE → Sandpack).
- [ ] Contributor guide (local setup, running tests, code layout).
