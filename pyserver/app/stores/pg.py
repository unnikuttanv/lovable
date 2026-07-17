"""Postgres store — same schema as the Node backend (projects + usage tables)."""
import json
import time
import uuid

from psycopg_pool import ConnectionPool

from ..config import DATABASE_URL, DEFAULT_DEPENDENCIES

pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=10, open=False)


def init():
    pool.open()
    with pool.connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS projects (
              id text PRIMARY KEY,
              owner text NOT NULL,
              data jsonb NOT NULL,
              updated_at bigint NOT NULL
            );
            CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects(owner);
            CREATE TABLE IF NOT EXISTS usage (
              user_email text NOT NULL,
              day date NOT NULL,
              count int NOT NULL DEFAULT 0,
              PRIMARY KEY (user_email, day)
            );
            """
        )


def list_projects(owner):
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT data FROM projects WHERE owner = %s ORDER BY updated_at DESC", (owner,)
        ).fetchall()
    return [
        {k: row[0].get(k) for k in ("id", "name", "model", "createdAt", "updatedAt", "publishedAt")}
        for row in rows
    ]


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
    with pool.connection() as conn:
        conn.execute(
            "INSERT INTO projects (id, owner, data, updated_at) VALUES (%s, %s, %s, %s)",
            (pid, owner, json.dumps(project), now),
        )
    return project


def get_project(pid, owner=...):
    with pool.connection() as conn:
        if owner is ...:
            row = conn.execute("SELECT data FROM projects WHERE id = %s", (pid,)).fetchone()
        else:
            row = conn.execute(
                "SELECT data FROM projects WHERE id = %s AND owner = %s", (pid, owner)
            ).fetchone()
    return row[0] if row else None


def save_project(project):
    project["updatedAt"] = int(time.time() * 1000)
    with pool.connection() as conn:
        conn.execute(
            "UPDATE projects SET data = %s, updated_at = %s WHERE id = %s",
            (json.dumps(project), project["updatedAt"], project["id"]),
        )


def delete_project(pid, owner):
    with pool.connection() as conn:
        cur = conn.execute("DELETE FROM projects WHERE id = %s AND owner = %s", (pid, owner))
        return cur.rowcount > 0


def get_usage(email):
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT count FROM usage WHERE user_email = %s AND day = CURRENT_DATE", (email,)
        ).fetchone()
    return row[0] if row else 0


def increment_usage(email):
    with pool.connection() as conn:
        conn.execute(
            """
            INSERT INTO usage (user_email, day, count) VALUES (%s, CURRENT_DATE, 1)
            ON CONFLICT (user_email, day) DO UPDATE SET count = usage.count + 1
            """,
            (email,),
        )
