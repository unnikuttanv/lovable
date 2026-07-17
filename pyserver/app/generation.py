"""Generation lifecycle: runs the LangGraph pipeline in a worker thread, buffers
SSE events for replay, applies the resulting manifest to the project, and manages
pause/resume for human-in-the-loop clarifications."""
import re
import threading
import time
import uuid

from langgraph.types import Command

from .agents.graph import graph, STAGE_LABELS, valid_path
from .config import DAILY_GENERATION_LIMIT
from . import storage

_PKG_RE = re.compile(r"^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$")
_VER_RE = re.compile(r"^[A-Za-z0-9.+_\-~^><=* ]{1,64}$")

generations: dict[str, "Generation"] = {}


class Generation:
    def __init__(self, owner):
        self.owner = owner
        self.events: list[dict] = []
        self.finished = False
        self.lock = threading.Lock()

    def emit(self, event, data):
        with self.lock:
            self.events.append({"event": event, "data": data})
            if event in ("done", "error"):
                self.finished = True


def get_generation(gen_id, owner):
    gen = generations.get(gen_id)
    if not gen or gen.owner != owner:
        return None
    return gen


def _schedule_cleanup(gen_id):
    timer = threading.Timer(600, lambda: generations.pop(gen_id, None))
    timer.daemon = True
    timer.start()


def start_generation(project, prompt, owner, resume_thread=None):
    """Start a new pipeline run, or resume a paused one when resume_thread is set."""
    gen_id = uuid.uuid4().hex[:12]
    gen = Generation(owner)
    generations[gen_id] = gen
    thread_id = resume_thread or gen_id

    worker = threading.Thread(
        target=_run_safe, args=(gen, project["id"], prompt, owner, thread_id, bool(resume_thread)), daemon=True
    )
    worker.start()
    _schedule_cleanup(gen_id)
    return gen_id


def _run_safe(gen, project_id, prompt, owner, thread_id, is_resume):
    try:
        _run(gen, project_id, prompt, owner, thread_id, is_resume)
    except Exception as err:  # surfaced to the user as a chat error bubble
        gen.emit("error", {"message": str(err)})


def _run(gen, project_id, prompt, owner, thread_id, is_resume):
    project = storage.get_project(project_id, owner)
    if not project:
        raise RuntimeError("Project not found")

    if not is_resume:
        used = storage.get_usage(owner)
        if used >= DAILY_GENERATION_LIMIT:
            raise RuntimeError(
                f"Daily limit of {DAILY_GENERATION_LIMIT} generations reached — resets at midnight UTC."
            )
        storage.increment_usage(owner)

    project["messages"].append({"role": "user", "kind": "chat", "content": prompt, "ts": _now()})
    project["pendingClarification"] = None
    storage.save_project(project)

    config = {"configurable": {"thread_id": thread_id}}
    if is_resume:
        graph_input = Command(resume=prompt)
    else:
        graph_input = {
            "model": project["model"],
            "prompt": prompt,
            "files": project["files"],
            "history": [
                {"role": m["role"], "content": m["content"]}
                for m in project["messages"][:-1]
                if m.get("kind") != "error"
            ],
        }

    gen.emit("status", {"stage": "Planning…"})
    acc = ""
    last_token = 0.0
    current_node = "plan"
    current_file = None  # set by the coder's per-task custom events

    for mode, chunk in graph.stream(graph_input, config, stream_mode=["messages", "updates", "custom"]):
        if mode == "custom" and isinstance(chunk, dict) and chunk.get("file"):
            current_file = f"{chunk['file']} ({chunk.get('index')}/{chunk.get('total')})"
            acc = ""
            gen.emit("status", {"stage": f"Writing {current_file}"})
        elif mode == "messages":
            msg, meta = chunk
            node = meta.get("langgraph_node") or current_node
            if node != current_node:
                current_node = node
                acc = ""
                if node != "coder":  # coder stages come from its per-file custom events
                    gen.emit("status", {"stage": STAGE_LABELS.get(node, node)})
            text = msg.content if isinstance(msg.content, str) else ""
            if not text:
                continue
            acc += text
            now = time.monotonic()
            if now - last_token >= 0.1:
                last_token = now
                file_label = current_file if current_node == "coder" else None
                gen.emit("token", {"text": acc[-400:], "file": file_label, "chars": len(acc)})
        elif mode == "updates" and "__interrupt__" in chunk:
            question = _interrupt_question(chunk["__interrupt__"])
            _pause_for_clarification(gen, project_id, owner, thread_id, question)
            return

    state = graph.get_state(config).values
    _finish(gen, project_id, owner, state)


def _interrupt_question(interrupts):
    try:
        value = interrupts[0].value
        return value.get("question") if isinstance(value, dict) else str(value)
    except (IndexError, AttributeError):
        return "Could you describe what you want in a bit more detail?"


def _pause_for_clarification(gen, project_id, owner, thread_id, question):
    project = storage.get_project(project_id, owner)
    project["pendingClarification"] = {"threadId": thread_id, "question": question}
    project["messages"].append({"role": "assistant", "kind": "chat", "content": question, "ts": _now()})
    storage.save_project(project)
    gen.emit("chat", {"message": question})
    gen.emit("done", {"versionId": None, "awaitingClarification": True})


def _finish(gen, project_id, owner, state):
    project = storage.get_project(project_id, owner)

    if state.get("chat_reply"):
        project["messages"].append({"role": "assistant", "kind": "chat", "content": state["chat_reply"], "ts": _now()})
        storage.save_project(project)
        gen.emit("chat", {"message": state["chat_reply"]})
        gen.emit("done", {"versionId": None})
        return

    manifest = state.get("manifest")
    if not manifest:
        raise RuntimeError("Pipeline finished without producing code")

    gen.emit("status", {"stage": "Writing files"})
    invalid = [f.get("path") for f in manifest["files"] if not valid_path(f.get("path"))]
    if invalid:
        raise RuntimeError("Coder produced invalid file paths: " + ", ".join(map(str, invalid)))

    for f in manifest["files"]:
        project["files"][f["path"].replace("\\", "/")] = str(f.get("content") or "")
    for deleted in manifest.get("deleted", []):
        if valid_path(deleted):
            project["files"].pop(deleted.replace("\\", "/"), None)
    for pkg, ver in (manifest.get("dependencies") or {}).items():
        if _PKG_RE.match(pkg) and _VER_RE.match(str(ver)):
            project.setdefault("dependencies", {})[pkg] = str(ver)
    if "src/App.jsx" not in project["files"]:
        raise RuntimeError("Generated project is missing src/App.jsx")

    version = {
        "id": uuid.uuid4().hex[:8],
        "label": state["prompt"][:80],
        "ts": _now(),
        "files": dict(project["files"]),
    }
    project["versions"].append(version)
    project["messages"].append({
        "role": "assistant",
        "kind": "code",
        "content": manifest.get("summary") or "Updated the app.",
        "versionId": version["id"],
        "ts": _now(),
    })
    storage.save_project(project)

    gen.emit("files", {"paths": [f["path"] for f in manifest["files"]], "summary": manifest.get("summary")})
    gen.emit("done", {"versionId": version["id"]})


def _now():
    return int(time.time() * 1000)
