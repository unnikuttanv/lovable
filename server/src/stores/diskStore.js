// Dev-fallback store: server/data/<id>/meta.json + data/_usage.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DEPENDENCIES, today } from './shared.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const USAGE_FILE = path.join(DATA_DIR, '_usage.json');

const metaPath = (id) => path.join(DATA_DIR, id, 'meta.json');
const validId = (id) => /^[a-z0-9-]+$/i.test(id);

function readMeta(id) {
  try {
    return JSON.parse(fs.readFileSync(metaPath(id), 'utf8'));
  } catch {
    return null;
  }
}

export async function init() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export async function listProjects(owner) {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR)
    .filter((e) => !e.startsWith('_'))
    .map(readMeta)
    .filter((p) => p && (p.owner ?? null) === owner)
    .map((p) => ({ id: p.id, name: p.name, model: p.model, createdAt: p.createdAt, updatedAt: p.updatedAt, publishedAt: p.publishedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
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
  await saveProject(project);
  return project;
}

export async function getProject(id, owner) {
  if (!validId(id)) return null;
  const p = readMeta(id);
  if (!p || (owner !== undefined && (p.owner ?? null) !== owner)) return null;
  return p;
}

export async function saveProject(project) {
  project.updatedAt = Date.now();
  fs.mkdirSync(path.join(DATA_DIR, project.id), { recursive: true });
  fs.writeFileSync(metaPath(project.id), JSON.stringify(project, null, 2));
}

export async function deleteProject(id, owner) {
  const p = await getProject(id, owner);
  if (!p) return false;
  fs.rmSync(path.join(DATA_DIR, id), { recursive: true, force: true });
  return true;
}

function readUsage() {
  try {
    return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export async function getUsage(email) {
  return readUsage()[today()]?.[email] || 0;
}

export async function incrementUsage(email) {
  const all = readUsage();
  const day = today();
  all[day] = all[day] || {};
  all[day][email] = (all[day][email] || 0) + 1;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USAGE_FILE, JSON.stringify(all, null, 2));
}
