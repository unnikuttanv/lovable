"""Publish: write project files into the runner, `npx vite build`, serve at /p/<id>/.
Builds are serialized (shared runner src/); bundling does not execute app code.
Extra npm dependencies a project declares are installed into the runner on demand
with --ignore-scripts, so no package lifecycle code runs either."""
import re
import shutil
import subprocess
import threading

from .config import RUNNER_DIR, PUBLISHED_DIR

_lock = threading.Lock()
_FIXED = {"main.jsx"}
RUNNER_SRC = RUNNER_DIR / "src"

# LLM-derived strings must never reach a shell. Specs are strictly validated AND
# passed as argv — on Windows npm resolves to npm.cmd, which cmd.exe still parses,
# so the regexes are the primary defense, argv the second layer.
_SPEC_RE = re.compile(r"^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$")
_VER_RE = re.compile(r"^[A-Za-z0-9.+_\-~^><=* ]{1,64}$")
_NPM = shutil.which("npm") or "npm"
_NPX = shutil.which("npx") or "npx"


def _activate(project):
    for entry in RUNNER_SRC.iterdir():
        if entry.name in _FIXED:
            continue
        shutil.rmtree(entry, ignore_errors=True) if entry.is_dir() else entry.unlink(missing_ok=True)
    for path, content in project["files"].items():
        rel = path.replace("\\", "/")
        if not rel.startswith("src/") or ".." in rel or rel == "src/main.jsx":
            continue
        target = RUNNER_SRC / rel[4:]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")


def _ensure_dependencies(project):
    """Install any project-declared npm packages the runner doesn't have yet.
    Different projects pinning conflicting versions of the same package will
    overwrite each other sequentially — acceptable for a small self-hosted deployment."""
    deps = project.get("dependencies") or {}
    missing = {
        pkg: ver for pkg, ver in deps.items()
        if not (RUNNER_DIR / "node_modules" / pkg / "package.json").exists()
    }
    if not missing:
        return
    args = [_NPM, "install", "--no-save", "--ignore-scripts", "--"]
    for pkg, ver in missing.items():
        if not _SPEC_RE.match(pkg) or not _VER_RE.match(str(ver)):
            raise RuntimeError(f"Invalid dependency spec: {pkg}@{ver}")
        args.append(f"{pkg}@{ver}")
    result = subprocess.run(
        args,
        cwd=RUNNER_DIR,
        shell=False,
        capture_output=True,
        text=True,
        timeout=300,
    )
    if result.returncode != 0:
        raise RuntimeError("Dependency install failed: " + (result.stderr or result.stdout)[-1000:])


def publish_project(project) -> str:
    pid = project["id"]
    if not re.match(r"^[a-z0-9-]+$", pid):
        raise RuntimeError("Invalid project id")
    with _lock:
        _ensure_dependencies(project)
        _activate(project)
        out_dir = PUBLISHED_DIR / pid
        result = subprocess.run(
            [_NPX, "vite", "build", f"--base=/p/{pid}/", "--outDir", str(out_dir), "--emptyOutDir"],
            cwd=RUNNER_DIR,
            shell=False,
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode != 0:
            raise RuntimeError("Build failed: " + (result.stderr or result.stdout)[-1500:])
        return f"/p/{project['id']}/"
