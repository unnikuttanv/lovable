// Creates the Python venv (if missing) and installs pyserver requirements, on any OS.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const win = process.platform === 'win32';
const venvPython = win ? 'pyserver/.venv/Scripts/python.exe' : 'pyserver/.venv/bin/python';

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.error(result.error?.message ?? `exited with code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(venvPython)) {
  run(win ? 'python' : 'python3', ['-m', 'venv', 'pyserver/.venv']);
}
run(venvPython, ['-m', 'pip', 'install', '-r', 'pyserver/requirements.txt']);
console.log('\nSetup complete. Put your OpenRouter key in pyserver/.env (copy pyserver/.env.example), then: npm run dev');
