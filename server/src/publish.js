// Publishes a project: writes its files into the runner, runs `vite build`,
// output lands in server/published/<id>/ (served at /p/<id>/).
// Builds are serialized — the runner src/ directory is shared — and bundling
// does not execute generated app code.
// Limitation: published builds resolve only the runner's preinstalled deps
// (react, react-dom, lucide-react). The Sandpack preview supports any dep.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { activateProject, RUNNER_DIR } from './runnerSync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PUBLISHED_DIR = path.resolve(__dirname, '..', 'published');

let queue = Promise.resolve();

export function publishProject(project) {
  const job = queue.then(() => build(project));
  queue = job.catch(() => {}); // a failed build must not poison the queue
  return job;
}

function build(project) {
  activateProject(project);
  const outDir = path.join(PUBLISHED_DIR, project.id);
  const args = ['vite', 'build', `--base=/p/${project.id}/`, '--outDir', outDir, '--emptyOutDir'];

  return new Promise((resolve, reject) => {
    const child = spawn('npx', args, { cwd: RUNNER_DIR, shell: true });
    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ url: `/p/${project.id}/` });
      else reject(new Error('Build failed: ' + (stderr || stdout).slice(-1500)));
    });
  });
}
