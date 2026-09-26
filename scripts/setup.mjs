import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function checkNode(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  if (major !== 24 || minor < 15)
    throw new Error(
      `Remora requires Node.js >=24.15.0 <25; found ${version}. Install or select a supported Node.js 24 release and try again.`,
    );
}

export function npmCommand() {
  return process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
}

export function runNpm(args) {
  const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd', ...args] : args;
  const result = spawnSync(npmCommand(), commandArgs, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: false,
  });
  if (result.error) throw new Error(`Could not start npm: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(`npm ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
}

export function dependenciesPresent() {
  return (
    existsSync(resolve(root, 'node_modules/.package-lock.json')) &&
    existsSync(resolve(root, 'node_modules/tsx')) &&
    existsSync(resolve(root, 'node_modules/fastify')) &&
    existsSync(resolve(root, 'node_modules/typescript')) &&
    existsSync(resolve(root, 'node_modules/vite'))
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    checkNode();
    console.log('Installing the locked npm dependencies...');
    runNpm(['ci']);
    console.log('Dependencies are ready.');
  } catch (error) {
    console.error(`Remora setup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
