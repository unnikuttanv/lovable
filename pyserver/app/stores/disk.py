"""Dev-fallback store: server/data/<id>/meta.json + data/_usage.json (same layout as Node)."""
import json
import re
import shutil
import time
import uuid
from datetime import date

from ..config import DATA_DIR, DEFAULT_DEPENDENCIES

USAGE_FILE = DATA_DIR / "_usage.json"
_ID_RE = re.compile(r"^[a-z0-9-]+$", re.I)


def _meta_path(pid):
    return DATA_DIR / pid / "meta.json"


def _read_meta(pid):
    try:
        return json.loads(_meta_path(pid).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def init():
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def list_projects(owner):
    if not DATA_DIR.exists():
        return []
    out = []
    for entry in DATA_DIR.iterdir():
        if entry.name.startswith("_"):
            continue
        p = _read_meta(entry.name)
        if p and p.get("owner") == owner:
            out.append({k: p.get(k) for k in ("id", "name", "model", "createdAt", "updatedAt", "publishedAt")})
    return sorted(out, key=lambda p: p["updatedAt"], reverse=True)


def create_project(name, model, owner):
    pid = uuid.uuid4().hex[:8]
    now = int(time.time() * 1000)
    project = {
        "id": pid,
        "owner": owner,
        "name": name or "Untitled",
        "model": model,
        "createdAt": now,
        "updatedAt": now,
        "messages": [],
        "files": {},
        "dependencies": dict(DEFAULT_DEPENDENCIES),
        "versions": [],
        "publishedAt": None,
    }
    save_project(project)
    return project


def get_project(pid, owner=...):
    if not _ID_RE.match(pid or ""):
        return None
    p = _read_meta(pid)
    if not p:
        return None
    if owner is not ... and p.get("owner") != owner:
        return None
    return p


def save_project(project):
    project["updatedAt"] = int(time.time() * 1000)
    (DATA_DIR / project["id"]).mkdir(parents=True, exist_ok=True)
    _meta_path(project["id"]).write_text(json.dumps(project, indent=2), encoding="utf-8")


def delete_project(pid, owner):
    if get_project(pid, owner) is None:
        return False
    shutil.rmtree(DATA_DIR / pid, ignore_errors=True)
    return True


def _read_usage():
    try:
        return json.loads(USAGE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def get_usage(email):
    return _read_usage().get(date.today().isoformat(), {}).get(email, 0)


def increment_usage(email):
    all_usage = _read_usage()
    day = date.today().isoformat()
    all_usage.setdefault(day, {})
    all_usage[day][email] = all_usage[day].get(email, 0) + 1
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    USAGE_FILE.write_text(json.dumps(all_usage, indent=2), encoding="utf-8")
