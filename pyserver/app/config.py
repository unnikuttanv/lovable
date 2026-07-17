"""Env + paths. Config comes from pyserver/.env (or real env vars in Docker)."""
import os
from pathlib import Path
from dotenv import load_dotenv

PYSERVER_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = PYSERVER_DIR.parent
CLIENT_DIR = REPO_DIR / "client"
RUNNER_DIR = REPO_DIR / "runner"
DATA_DIR = PYSERVER_DIR / "data"
PUBLISHED_DIR = PYSERVER_DIR / "published"

load_dotenv(PYSERVER_DIR / ".env")

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = os.getenv("OPENROUTER_MODEL", "anthropic/claude-sonnet-4.5")
DATABASE_URL = os.getenv("DATABASE_URL", "")
AUTH_EMAIL_HEADER = os.getenv("AUTH_EMAIL_HEADER", "cf-access-authenticated-user-email").lower()
DEV_USER = os.getenv("DEV_USER")
DAILY_GENERATION_LIMIT = int(os.getenv("DAILY_GENERATION_LIMIT", "50"))
PORT = int(os.getenv("PORT", "3001"))

DEFAULT_DEPENDENCIES = {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "lucide-react": "^0.454.0",
}

MODELS = [
    {"id": "anthropic/claude-sonnet-4.5", "name": "Claude Sonnet 4.5"},
    {"id": "anthropic/claude-haiku-4.5", "name": "Claude Haiku 4.5"},
    {"id": "openai/gpt-4o", "name": "GPT-4o"},
    {"id": "google/gemini-2.5-flash", "name": "Gemini 2.5 Flash"},
    {"id": "deepseek/deepseek-chat-v3-0324", "name": "DeepSeek V3"},
    {"id": "meta-llama/llama-3.3-70b-instruct", "name": "Llama 3.3 70B"},
]
