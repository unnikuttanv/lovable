// Starts the FastAPI dev server using the project venv, on any OS.
// (npm scripts run through cmd.exe on Windows, which can't execute
// forward-slash paths — Node's spawn handles them fine.)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const python = process.platform === 'win32'
  ? 'pyserver/.venv/Scripts/python.exe'
  : 'pyserver/.venv/bin/python';

if (!existsSync(python)) {
  console.error(`Venv python not found at ${python} — run "npm run install:all" first.`);
  process.exit(1);
}

const child = spawn(
  python,
  ['-m', 'uvicorn', 'app.main:app', '--app-dir', 'pyserver', '--port', '3001'],
  { stdio: 'inherit' }
);
child.on('exit', (code) => process.exit(code ?? 0));
