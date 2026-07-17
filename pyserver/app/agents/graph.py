"""LangGraph pipeline: plan -> (clarify -> plan) | chat | architect -> coder.

The graph is compiled once with an in-memory checkpointer; each generation runs
under a thread_id. clarify() uses interrupt() so the graph pauses until the
user's next chat message resumes it with their answer.
"""
import json
import re
from typing import TypedDict

from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import StateGraph, START, END
from langgraph.types import interrupt

from ..config import OPENROUTER_API_KEY, OPENROUTER_BASE_URL
from .prompts import PLAN_PROMPT, ARCHITECT_PROMPT, CODER_PROMPT

HISTORY_LIMIT = 12
HISTORY_TRUNCATE = 2000
_PATH_RE = re.compile(r"^src/(?!main\.jsx$)[^\0]*$")


class BuildState(TypedDict, total=False):
    model: str
    prompt: str
    files: dict          # current project files {path: content}
    history: list        # prior chat messages [{role, content}]
    clarification_answer: str
    plan: str
    chat_reply: str
    clarify_question: str
    architecture: dict   # {"files": [...], "dependencies": {...}}
    manifest: dict       # {"files": [...], "deleted": [...], "summary": ...}


def valid_path(p) -> bool:
    return isinstance(p, str) and bool(_PATH_RE.match(p.replace("\\", "/"))) and ".." not in p


def _llm(model: str) -> ChatOpenAI:
    if not OPENROUTER_API_KEY or "your-key-here" in OPENROUTER_API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY is not set. Add it to server/.env or pyserver/.env")
    return ChatOpenAI(
        model=model,
        api_key=OPENROUTER_API_KEY,
        base_url=OPENROUTER_BASE_URL,
        temperature=0.4,
        streaming=True,
        default_headers={"HTTP-Referer": "http://localhost:3001", "X-Title": "Adorable"},
    )


def _extract_json(text: str) -> dict:
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("No JSON object in model response")
    return json.loads(text[start : end + 1])


def _call_json(state: BuildState, system: str, user: str) -> dict:
    """One LLM call expected to return JSON; single corrective retry on parse failure."""
    llm = _llm(state["model"])
    messages = [{"role": "system", "content": system}]
    for m in state.get("history", [])[-HISTORY_LIMIT:]:
        content = m["content"]
        if len(content) > HISTORY_TRUNCATE:
            content = content[:HISTORY_TRUNCATE] + "\n…(truncated)"
        messages.append({"role": "user" if m["role"] == "user" else "assistant", "content": content})
    messages.append({"role": "user", "content": user})

    raw = llm.invoke(messages).content
    try:
        return _extract_json(raw)
    except (ValueError, json.JSONDecodeError):
        retry = messages + [
            {"role": "assistant", "content": raw[:8000]},
            {"role": "user", "content": "Your previous reply was not valid JSON. Respond again with ONLY the JSON object, exactly per the format rules."},
        ]
        return _extract_json(llm.invoke(retry).content)


def _files_block(files: dict) -> str:
    if not files:
        return ""
    body = "\n\n".join(f"--- {p} ---\n{c}" for p, c in files.items())
    return f"Current project files:\n\n{body}\n\n"


def plan_node(state: BuildState) -> BuildState:
    user = _files_block(state.get("files", {}))
    user += f"User request: {state['prompt']}"
    if state.get("clarification_answer"):
        user += f"\n\nClarification answer from the user: {state['clarification_answer']}"
    result = _call_json(state, PLAN_PROMPT, user)

    mode = result.get("mode")
    if mode == "clarify" and not state.get("clarification_answer"):
        return {"clarify_question": result.get("question") or "Could you describe what you want in a bit more detail?"}
    if mode == "chat":
        return {"chat_reply": result.get("reply") or "…", "clarify_question": ""}
    plan = result.get("plan") or result.get("question") or state["prompt"]
    return {"plan": plan, "clarify_question": ""}


def clarify_node(state: BuildState) -> BuildState:
    answer = interrupt({"question": state["clarify_question"]})
    return {"clarification_answer": str(answer)}


def route_after_plan(state: BuildState) -> str:
    if state.get("clarify_question"):
        return "clarify"
    if state.get("chat_reply"):
        return END
    return "architect"


def architect_node(state: BuildState) -> BuildState:
    file_list = "\n".join(f"- {p}" for p in state.get("files", {})) or "(none — new project)"
    user = (
        f"Build plan:\n{state['plan']}\n\nExisting project files:\n{file_list}\n\n"
        "Design the architecture."
    )
    result = _call_json(state, ARCHITECT_PROMPT, user)
    files = [f for f in result.get("files", []) if isinstance(f, dict) and valid_path(f.get("path"))]
    if not files:
        raise ValueError("Architect produced no valid files")
    deps = result.get("dependencies") or {}
    return {"architecture": {"files": files, "dependencies": deps}}


def coder_node(state: BuildState) -> BuildState:
    arch = state["architecture"]
    arch_lines = "\n".join(f"- {f['path']}: {f.get('purpose', '')}" for f in arch["files"])
    deps_line = json.dumps(arch.get("dependencies") or {})
    user = _files_block(state.get("files", {}))
    user += (
        f"Build plan:\n{state['plan']}\n\n"
        f"Architecture (implement exactly these files):\n{arch_lines}\n\n"
        f"Extra npm dependencies you may import: {deps_line}\n\n"
        f"Original user request: {state['prompt']}"
    )
    manifest = _call_json(state, CODER_PROMPT, user)
    if not isinstance(manifest.get("files"), list):
        raise ValueError("Coder returned an unexpected manifest shape")
    manifest.setdefault("deleted", [])
    manifest["dependencies"] = arch.get("dependencies") or {}
    return {"manifest": manifest}


def build_graph():
    g = StateGraph(BuildState)
    g.add_node("plan", plan_node)
    g.add_node("clarify", clarify_node)
    g.add_node("architect", architect_node)
    g.add_node("coder", coder_node)
    g.add_edge(START, "plan")
    g.add_conditional_edges("plan", route_after_plan, {"clarify": "clarify", "architect": "architect", END: END})
    g.add_edge("clarify", "plan")
    g.add_edge("architect", "coder")
    g.add_edge("coder", END)
    return g.compile(checkpointer=MemorySaver())


graph = build_graph()

STAGE_LABELS = {
    "plan": "Planning…",
    "clarify": "Waiting for your answer",
    "architect": "Designing architecture…",
    "coder": "Writing code…",
}
