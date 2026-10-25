"""Adorable API — FastAPI port of the Node server, same HTTP + SSE contract."""
import asyncio
import io
import json
import time
import uuid
import zipfile

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import storage
from .config import (
    AUTH_EMAIL_HEADER, CLIENT_DIR, DAILY_GENERATION_LIMIT, DEFAULT_MODEL,
    DEV_USER, MODELS, PUBLISHED_DIR,
)
from .generation import get_generation, start_generation
from .publish import publish_project

app = FastAPI(title="Adorable")


def user_email(request: Request) -> str:
    email = request.headers.get(AUTH_EMAIL_HEADER) or DEV_USER
    if not email:
        raise HTTPException(401, "No identity. Access this app through the SSO proxy (or set DEV_USER for local development).")
    return str(email).lower()


@app.exception_handler(HTTPException)
async def http_error(_request, exc):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


def _get_or_404(pid: str, owner: str) -> dict:
    project = storage.get_project(pid, owner)
    if not project:
        raise HTTPException(404, "not found")
    return project


@app.get("/api/me")
def me(owner: str = Depends(user_email)):
    return {"email": owner, "dailyLimit": DAILY_GENERATION_LIMIT, "usedToday": storage.get_usage(owner)}


@app.get("/api/models")
def models():
    return {"models": MODELS, "default": DEFAULT_MODEL}


@app.get("/api/projects")
def list_projects(owner: str = Depends(user_email)):
    return storage.list_projects(owner)


@app.post("/api/projects")
async def create_project(request: Request, owner: str = Depends(user_email)):
    body = await request.json()
    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(400, "prompt is required")
    project = storage.create_project(prompt[:40], body.get("model") or DEFAULT_MODEL, owner)
    generation_id = start_generation(project, prompt, owner)
    return {"project": project, "generationId": generation_id}


@app.get("/api/projects/{pid}")
def get_project(pid: str, owner: str = Depends(user_email)):
    return _get_or_404(pid, owner)


@app.patch("/api/projects/{pid}")
async def rename_project(pid: str, request: Request, owner: str = Depends(user_email)):
    project = _get_or_404(pid, owner)
    body = await request.json()
    name = (body.get("name") or "").strip()
    if name:
        project["name"] = name[:60]
    storage.save_project(project)
    return project


@app.delete("/api/projects/{pid}")
def delete_project(pid: str, owner: str = Depends(user_email)):
    return {"deleted": storage.delete_project(pid, owner)}


@app.post("/api/projects/{pid}/messages")
async def send_message(pid: str, request: Request, owner: str = Depends(user_email)):
    project = _get_or_404(pid, owner)
    body = await request.json()
    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(400, "prompt is required")

    pending = project.get("pendingClarification")
    resume_thread = pending.get("threadId") if pending else None
    generation_id = start_generation(project, prompt, owner, resume_thread=resume_thread)
    return {"generationId": generation_id}


@app.get("/api/generations/{gen_id}/stream")
async def stream_generation(gen_id: str, owner: str = Depends(user_email)):
    gen = get_generation(gen_id, owner)
    if not gen:
        raise HTTPException(404, "not found")

    async def events():
        sent = 0
        while True:
            with gen.lock:
                pending = gen.events[sent:]
                finished = gen.finished
            for entry in pending:
                sent += 1
                yield f"event: {entry['event']}\ndata: {json.dumps(entry['data'])}\n\n"
            if finished and sent >= len(gen.events):
                return
            await asyncio.sleep(0.15)

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "Connection": "keep-alive"})


@app.post("/api/projects/{pid}/restore")
async def restore_version(pid: str, request: Request, owner: str = Depends(user_email)):
    project = _get_or_404(pid, owner)
    body = await request.json()
    version = next((v for v in project["versions"] if v["id"] == body.get("versionId")), None)
    if not version:
        raise HTTPException(404, "version not found")

    project["files"] = dict(version["files"])
    restored = {
        "id": uuid.uuid4().hex[:8],
        "label": f"Restore: {version['label']}"[:80],
        "ts": int(time.time() * 1000),
        "files": dict(version["files"]),
    }
    project["versions"].append(restored)
    project["messages"].append({
        "role": "assistant", "kind": "code",
        "content": f'Restored version "{version["label"]}"',
        "versionId": restored["id"], "ts": restored["ts"],
    })
    storage.save_project(project)
    return project


@app.get("/api/projects/{pid}/export")
def export_project(pid: str, owner: str = Depends(user_email)):
    project = _get_or_404(pid, owner)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for path, content in project["files"].items():
            zf.writestr(path, content)
        zf.writestr("package.json", json.dumps(
            {"name": project["name"], "private": True, "dependencies": project.get("dependencies", {})}, indent=2))
        zf.writestr("README.md",
                    f"# {project['name']}\n\nGenerated with Adorable.\n\nReact + Tailwind app. "
                    "Entry component: src/App.jsx (default export). Dependencies are listed in package.json.\n")
    return Response(buffer.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{pid}.zip"'})


@app.post("/api/projects/{pid}/publish")
async def publish(pid: str, owner: str = Depends(user_email)):
    project = _get_or_404(pid, owner)
    try:
        url = await asyncio.to_thread(publish_project, project)
    except Exception as err:
        raise HTTPException(500, str(err))
    project["publishedAt"] = int(time.time() * 1000)
    storage.save_project(project)
    return {"url": url}


PUBLISHED_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/p", StaticFiles(directory=PUBLISHED_DIR, html=True), name="published")
app.mount("/", StaticFiles(directory=CLIENT_DIR, html=True), name="client")

storage.init()
print(f"Storage: {storage.STORE_KIND}")
