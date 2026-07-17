# Adorable — Python/LangChain Backend Rewrite — Design Spec

**Date:** 2026-07-17
**Builds on:** team-edition spec. Approved scope: full replacement of the Node server with a Python backend; agentic pipeline plan() → architect() → coder() with human-in-the-loop clarification in plan() only.

## Decision

The backend becomes **FastAPI + LangChain/LangGraph** (user directive). The HTTP + SSE contract is preserved exactly, so the client (Sandpack preview, chat UI), SSO-header auth model, Postgres schema, and deployment story carry over. The Node `server/` is retired (kept in git history); `runner/` remains solely the publish build engine.

## Generation pipeline (LangGraph StateGraph)

State: `{owner, project_id, prompt, files, dependencies, history, plan, architecture, manifest, clarification_answer}`

- **plan()** — LLM turns the prompt (+ current files summary on edit turns, + chat history) into a build plan: features, scope, whether this is a code request or a question. Output JSON: `{needs_clarification, question?, is_chat?, chat_reply?, plan?}`. A question/chatty prompt short-circuits to a chat reply (parity with today's chat mode).
- **clarify()** — reached only when `needs_clarification`; calls LangGraph `interrupt(question)`. The graph checkpoints and pauses; the question is stored on the project (`pendingClarification`) and emitted as an assistant chat bubble. The user's next chat message **resumes** the graph (`Command(resume=answer)`) → back to plan() with the answer in state.
- **architect()** — plan → file design JSON: `{files: [{path, purpose}], dependencies: {...}}`. Paths under `src/`, `src/App.jsx` mandatory.
- **coder()** — architecture + plan → full file manifest `{files: [{path, content}], deleted: [], summary}`, streamed token-by-token; edit turns emit only changed files.
- Edges: START → plan → (clarify → plan | architect | chat-reply END) ; architect → coder → END.

Checkpointer: in-memory (`MemorySaver`), thread id = generation id. **v1 limitation:** a pending clarification does not survive a server restart — the user simply re-sends their prompt. (Postgres checkpointing is a known upgrade path.)

Models: unchanged OpenRouter list via `langchain-openai`'s `ChatOpenAI` with `base_url=https://openrouter.ai/api/v1`. All three nodes use the project's selected model. JSON is parsed tolerantly (first `{` … last `}`) with one corrective retry per node.

## SSE contract (unchanged events, richer stages)

`status` stages become `Planning…` / `Clarification needed` / `Designing architecture…` / `Writing code…`; `token` events stream from every node with the current file scraped from partial coder output; `chat`, `files`, `done`, `error` unchanged.

## HTTP contract (unchanged)

All existing endpoints keep paths, payloads, and semantics. One behavioral addition: `POST /api/projects/:id/messages` first checks `project.pendingClarification` — if set, the message resumes the paused graph instead of starting a new run (client needs no changes). Quotas count resumed runs as the same generation (no double charge).

## Structure

```
pyserver/
  requirements.txt        fastapi, uvicorn, langchain-openai, langgraph, python-dotenv, psycopg[binary]
  app/main.py             routes, SSE, static client + /p
  app/auth.py             header identity dependency (same envs)
  app/storage.py          + stores/disk.py, stores/pg.py (same JSON shape, same pg schema)
  app/agents/graph.py     StateGraph, nodes, interrupt wiring
  app/agents/prompts.py   plan/architect/coder system prompts
  app/generation.py       generation registry, event buffers, start/resume
  app/publish.py          serialized `npx vite build` (async lock)
```

Dev: root `npm run dev` now starts uvicorn (port 3001). Docker: `python:3.12-slim` + Node LTS installed for publish builds; compose unchanged otherwise (same DATABASE_URL, envs).

## Error handling
Per-node JSON retry then readable SSE error; OpenRouter/httpx errors surfaced verbatim; quota and auth behavior identical to team edition.

## Out of scope (v1)
Postgres checkpointer for paused graphs; per-node model selection; parallel coder fan-out per file; evaluation loops (validate/fix cycles).

## Verification
- API parity: me/models/CRUD/isolation/quota curls pass as before.
- Browser: normal prompt → staged ticker (Planning → Architecting → Coding) → Sandpack preview renders.
- HITL: ambiguous prompt → question bubble → reply in chat → same generation resumes → app renders.
- Edit turn, restore, export, publish still work. Docker compose build boots with `Storage: postgres`.
