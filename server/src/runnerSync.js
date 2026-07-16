// Writes the active project's files into runner/src so Vite HMR picks them up.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const RUNNER_DIR = path.resolve(__dirname, '..', '..', 'runner');
const RUNNER_SRC = path.join(RUNNER_DIR, 'src');
const FIXED_FILES = new Set(['main.jsx']);

export function validateFilePath(p) {
  if (typeof p !== 'string') return false;
  const normalized = p.replaceAll('\\', '/');
  if (!normalized.startsWith('src/')) return false;
  if (normalized.includes('..')) return false;
  if (normalized === 'src/main.jsx') return false;
  return true;
}

export function activateProject(project) {
  // clear everything under runner/src except fixed files
  for (const entry of fs.readdirSync(RUNNER_SRC)) {
    if (FIXED_FILES.has(entry)) continue;
    fs.rmSync(path.join(RUNNER_SRC, entry), { recursive: true, force: true });
  }
  for (const [filePath, content] of Object.entries(project.files)) {
    if (!validateFilePath(filePath)) continue;
    const rel = filePath.replaceAll('\\', '/').slice('src/'.length);
    const abs = path.join(RUNNER_SRC, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}
