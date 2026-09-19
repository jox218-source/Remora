import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Workspaces, manifest, safePath } from '../packages/remora/src/workspace.js';
import type { Project, Task } from '../packages/remora/src/types.js';

const temp = async () => mkdtemp(join(tmpdir(), 'remora-workspace-'));
const task = (id: string, revision = 0): Task => ({
  id,
  title: id,
  instruction: id,
  account: 'worker',
  dependencies: [],
  acceptance: ['done'],
  status: 'pending',
  revision,
});
const project = (root: string): Project => ({
  id: 'project',
  name: 'project',
  root,
  goal: 'test',
  lead: 'lead',
  workers: ['worker'],
  state: 'idle',
  tasks: [],
  maxConcurrency: 4,
  maxRevisions: 2,
  network: false,
  createdAt: new Date().toISOString(),
});
const gitRun = (root: string, args: string[]) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
const initGit = async (root: string, file: string, content: string) => {
  await writeFile(join(root, file), content);
  gitRun(root, ['init', '-q']);
  gitRun(root, ['config', 'user.name', 'Remora tests']);
  gitRun(root, ['config', 'user.email', 'tests@localhost']);
  gitRun(root, ['add', file]);
  gitRun(root, ['commit', '-qm', 'initial']);
};

test('manifest rejects symlinks and safePath checks ancestors', async (t) => {
  const root = await temp();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'file.txt'), 'ok');
  try {
    await symlink(join(root, 'file.txt'), join(root, 'link.txt'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
    throw error;
  }
  assert.throws(() => manifest(root), /Symlinks are not supported/);
  await mkdir(join(root, 'dir'));
  await symlink(join(root, 'file.txt'), join(root, 'dir', 'link'));
  assert.throws(() => safePath(root, 'dir/link/out.txt'), /Symlink artifacts/);
});

test('revisions preserve earlier task output in a fresh workspace', async (t) => {
  const root = await temp();
  const home = await temp();
  t.after(() =>
    Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(home, { recursive: true, force: true }),
    ]),
  );
  await writeFile(join(root, 'input.txt'), 'input');
  const workspaces = new Workspaces(home);
  const p = project(root);
  workspaces.prepare(p);
  const first = task('worker-task');
  p.tasks = [first];
  const firstPath = workspaces.createTask(p, first);
  await writeFile(join(firstPath, 'first.txt'), 'first output');
  first.status = 'blocked';
  first.revision = 1;
  const secondPath = workspaces.createTask(p, first);
  assert.equal(await readFile(join(secondPath, 'first.txt'), 'utf8'), 'first output');
});

test('manifest counts files linearly and keeps regular content changes supported', async (t) => {
  const root = await temp();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'a.txt'), 'a');
  const before = manifest(root);
  await writeFile(join(root, 'a.txt'), 'changed');
  const after = manifest(root);
  assert.notEqual(before['a.txt'], after['a.txt']);
});

test('safePath rejects traversal and empty path segments', async () => {
  const root = await temp();
  await assert.rejects(
    async () => safePath(root, '../outside'),
    /Invalid artifact path|Path escapes/,
  );
  await rm(root, { recursive: true, force: true });
});

test('Git worker committed mode changes are rejected against the immutable base commit', async (t) => {
  const root = await temp();
  const home = await temp();
  t.after(() =>
    Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(home, { recursive: true, force: true }),
    ]),
  );
  await initGit(root, 'script.sh', '#!/bin/sh\nprintf ok\n');
  if (
    process.platform === 'win32' &&
    gitRun(root, ['config', '--get', 'core.filemode']) === 'false'
  )
    return t.skip('Git core.filemode is disabled on Windows');
  const workspaces = new Workspaces(home),
    p = project(root);
  workspaces.prepare(p);
  const worker = task('mode-task');
  p.tasks = [worker];
  const workspace = workspaces.createTask(p, worker);
  await chmod(join(workspace, 'script.sh'), 0o755);
  if (((await stat(join(workspace, 'script.sh'))).mode & 0o111) === 0)
    return t.skip('Filesystem did not apply executable mode');
  assert.throws(() => workspaces.changes(worker), /Executable-mode or symlink changes/);
});

test('committed Git symlinks are rejected during project preparation', async (t) => {
  const root = await temp();
  const home = await temp();
  t.after(() =>
    Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(home, { recursive: true, force: true }),
    ]),
  );
  await initGit(root, 'target.txt', 'target\n');
  try {
    await symlink('target.txt', join(root, 'link.txt'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM')
      return t.skip('Symlink creation requires elevated Windows privileges');
    throw error;
  }
  gitRun(root, ['add', 'link.txt']);
  gitRun(root, ['commit', '-qm', 'add symlink']);
  assert.throws(() => new Workspaces(home).prepare(project(root)), /Symlinks are not supported/);
});
