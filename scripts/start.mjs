import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkNode, dependenciesPresent, runNpm } from './setup.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

try {
  checkNode();
  if (!dependenciesPresent()) {
    console.log('Dependencies are missing; running npm ci from package-lock.json.');
    runNpm(['ci']);
  }
  console.log('Building Remora and the dashboard...');
  runNpm(['run', 'build']);
  console.log('Starting Remora in the foreground. Press Ctrl+C to stop it.');
  const child = spawn(
    process.execPath,
    ['packages/remora/dist/cli.js', 'up', ...process.argv.slice(2)],
    {
      cwd: root,
      stdio: 'inherit',
      windowsHide: false,
    },
  );
  child.once('error', (error) => {
    console.error(`Could not start Remora: ${error.message}`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    if (signal) process.exitCode = 1;
    else if (code !== 0) process.exitCode = code ?? 1;
  });
} catch (error) {
  console.error(`Remora startup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
