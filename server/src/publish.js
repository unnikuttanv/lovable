// Publishes a project: writes its files to the runner, runs `vite build`,
// output lands in server/published/<id>/ (served at /p/<id>/).
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { activateProject, RUNNER_DIR } from './runnerSync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PUBLISHED_DIR = path.resolve(__dirname, '..', 'published');

export function publishProject(project) {
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
