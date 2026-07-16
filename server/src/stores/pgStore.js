// Postgres store — selected when DATABASE_URL is set.
import crypto from 'node:crypto';
import pg from 'pg';
import { DEFAULT_DEPENDENCIES, today } from './shared.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export async function init() {
  await pool.query(`
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
  `);
}

export async function listProjects(owner) {
  const { rows } = await pool.query(
    `SELECT data->>'id' AS id, data->>'name' AS name, data->>'model' AS model,
            (data->>'createdAt')::bigint AS "createdAt", updated_at AS "updatedAt",
            (data->>'publishedAt')::bigint AS "publishedAt"
     FROM projects WHERE owner = $1 ORDER BY updated_at DESC`,
    [owner]
  );
  return rows.map((r) => ({ ...r, createdAt: Number(r.createdAt), updatedAt: Number(r.updatedAt), publishedAt: r.publishedAt ? Number(r.publishedAt) : null }));
}

export async function createProject({ name, model, owner }) {
  const id = crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  const project = {
    id,
    owner,
    name: name || 'Untitled',
    model,
    createdAt: now,
    updatedAt: now,
    messages: [],
    files: {},
    dependencies: { ...DEFAULT_DEPENDENCIES },
    versions: [],
    publishedAt: null,
  };
  await pool.query('INSERT INTO projects (id, owner, data, updated_at) VALUES ($1, $2, $3, $4)', [id, owner, project, now]);
  return project;
}

export async function getProject(id, owner) {
  const params = owner !== undefined ? [id, owner] : [id];
  const where = owner !== undefined ? 'id = $1 AND owner = $2' : 'id = $1';
  const { rows } = await pool.query(`SELECT data FROM projects WHERE ${where}`, params);
  return rows[0]?.data || null;
}

export async function saveProject(project) {
  project.updatedAt = Date.now();
  await pool.query('UPDATE projects SET data = $2, updated_at = $3 WHERE id = $1', [project.id, project, project.updatedAt]);
}

export async function deleteProject(id, owner) {
  const { rowCount } = await pool.query('DELETE FROM projects WHERE id = $1 AND owner = $2', [id, owner]);
  return rowCount > 0;
}

export async function getUsage(email) {
  const { rows } = await pool.query('SELECT count FROM usage WHERE user_email = $1 AND day = $2', [email, today()]);
  return rows[0]?.count || 0;
}

export async function incrementUsage(email) {
  await pool.query(
    `INSERT INTO usage (user_email, day, count) VALUES ($1, $2, 1)
     ON CONFLICT (user_email, day) DO UPDATE SET count = usage.count + 1`,
    [email, today()]
  );
}
