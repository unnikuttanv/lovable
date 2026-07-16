// Disk-backed project store: server/data/<id>/meta.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(__dirname, '..', 'data');

function metaPath(id) {
  return path.join(DATA_DIR, id, 'meta.json');
}

export function listProjects() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR)
    .map((id) => {
      try {
        const p = JSON.parse(fs.readFileSync(metaPath(id), 'utf8'));
        return { id: p.id, name: p.name, model: p.model, createdAt: p.createdAt, updatedAt: p.updatedAt, publishedAt: p.publishedAt };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createProject({ name, model }) {
  const id = crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  const project = {
    id,
    name: name || 'Untitled',
    model,
    createdAt: now,
    updatedAt: now,
    messages: [],
    files: {},
    versions: [],
    publishedAt: null,
  };
  saveProject(project);
  return project;
}

export function getProject(id) {
  const file = metaPath(id);
  if (!/^[a-z0-9-]+$/i.test(id) || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function saveProject(project) {
  project.updatedAt = Date.now();
  const dir = path.join(DATA_DIR, project.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(metaPath(project.id), JSON.stringify(project, null, 2));
}

export function deleteProject(id) {
  const dir = path.join(DATA_DIR, id);
  if (/^[a-z0-9-]+$/i.test(id) && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  }
  return false;
}
