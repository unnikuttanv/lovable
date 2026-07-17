"""LangGraph pipeline: plan -> (clarify -> plan) | chat | architect -> coder.

coder-buddy-style refinements: agents exchange pydantic models (states.py), the
architect emits an ordered task queue, and the coder implements ONE file per LLM
call returning raw code (no JSON escaping to go wrong). Per-file progress is
pushed through LangGraph's custom stream channel.
"""
import json
import re
from typing import Optional, TypedDict

from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.config import get_stream_writer
from langgraph.graph import StateGraph, START, END
from langgraph.types import interrupt
from pydantic import BaseModel, ValidationError

from ..config import OPENROUTER_API_KEY, OPENROUTER_BASE_URL
from .prompts import PLAN_PROMPT, ARCHITECT_PROMPT, CODER_FILE_PROMPT
from .states import PlanResult, TaskPlan

HISTORY_LIMIT = 12
HISTORY_TRUNCATE = 2000
_PATH_RE = re.compile(r"^src/(?!main\.jsx$)[^\0]*$")
_FENCE_RE = re.compile(r"^\s*```[\w.+-]*\s*\n|\n?```\s*$")


class BuildState(TypedDict, total=False):
    model: str
    prompt: str
    files: dict          # current project files {path: content}
    history: list        # prior chat messages [{role, content}]
    clarification_answer: str
    plan: str
    chat_reply: str
    clarify_question: str
    task_plan: dict      # TaskPlan.model_dump()
    manifest: dict       # {"files": [...], "deleted": [...], "dependencies": ..., "summary": ...}


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


def _base_messages(state: BuildState, system: str) -> list:
    messages = [{"role": "system", "content": system}]
    for m in state.get("history", [])[-HISTORY_LIMIT:]:
        content = m["content"]
        if len(content) > HISTORY_TRUNCATE:
            content = content[:HISTORY_TRUNCATE] + "\n…(truncated)"
        messages.append({"role": "user" if m["role"] == "user" else "assistant", "content": content})
    return messages


def _extract_json(text: str) -> dict:
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("No JSON object in model response")
    return json.loads(text[start : end + 1])


def _call_validated(state: BuildState, system: str, user: str, model_cls: type[BaseModel]) -> BaseModel:
    """LLM call whose reply must validate against a pydantic model.
    One corrective retry carrying the exact parse/validation error back to the model."""
    llm = _llm(state["model"])
    messages = _base_messages(state, system) + [{"role": "user", "content": user}]
    raw = llm.invoke(messages).content
    try:
        return model_cls.model_validate(_extract_json(raw))
    except (ValueError, json.JSONDecodeError, ValidationError) as err:
        retry = messages + [
            {"role": "assistant", "content": raw[:8000]},
            {"role": "user", "content": f"Your previous reply was invalid: {err}\nRespond again with ONLY the corrected JSON object, exactly per the format rules."},
        ]
        return model_cls.model_validate(_extract_json(llm.invoke(retry).content))


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
    result: PlanResult = _call_validated(state, PLAN_PROMPT, user, PlanResult)

    if result.mode == "clarify" and not state.get("clarification_answer"):
        return {"clarify_question": result.question or "Could you describe what you want in a bit more detail?"}
    if result.mode == "chat":
        return {"chat_reply": result.reply or "…", "clarify_question": ""}
    return {"plan": result.plan or state["prompt"], "clarify_question": ""}


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
        "Design the task queue."
    )
    task_plan: TaskPlan = _call_validated(state, ARCHITECT_PROMPT, user, TaskPlan)
    return {"task_plan": task_plan.model_dump()}


def coder_node(state: BuildState) -> BuildState:
    """One focused LLM call per task; the reply is the file's raw content."""
    task_plan = TaskPlan.model_validate(state["task_plan"])
    writer = get_stream_writer()
    llm = _llm(state["model"])

    queue_text = "\n".join(f"{i + 1}. {t.path} — {t.description}" for i, t in enumerate(task_plan.tasks))
    deps_line = json.dumps(task_plan.dependencies)
    working_files = dict(state.get("files", {}))
    written = []

    for i, task in enumerate(task_plan.tasks):
        writer({"file": task.path, "index": i + 1, "total": len(task_plan.tasks)})
        user = _files_block(working_files)
        user += (
            f"Build plan:\n{state['plan']}\n\n"
            f"Full task queue (context):\n{queue_text}\n\n"
            f"Declared extra npm dependencies: {deps_line}\n\n"
            f"YOUR TASK — write the complete content of {task.path}:\n{task.description}"
        )
        messages = _base_messages(state, CODER_FILE_PROMPT) + [{"role": "user", "content": user}]
        content = llm.invoke(messages).content
        content = _FENCE_RE.sub("", content).strip("\n") + "\n"
        working_files[task.path] = content
        written.append({"path": task.path, "content": content})

    return {
        "manifest": {
            "files": written,
            "deleted": [d for d in task_plan.deleted if valid_path(d)],
            "dependencies": task_plan.dependencies,
            "summary": task_plan.summary,
        }
    }


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
