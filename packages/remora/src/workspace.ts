import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  lstatSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join, resolve, relative, dirname, isAbsolute, sep } from 'node:path';
import type { Project, Task } from './types.js';
import { createTwoFilesPatch } from 'diff';

const ignored = new Set([
  '.git',
  '.remora',
  'node_modules',
  'dist',
  'coverage',
  '.cache',
  '.ssh',
  '.aws',
  '.codex',
  '.claude',
  '.grok',
]);
const sensitive =
  /^(?:\.env(?:\..*)?|auth\.json|credentials(?:\..*)?|.*\.(?:pem|key|p12|pfx)|id_rsa|id_ed25519)$/i;
export const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
export function safePath(root: string, path: string): string {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes('\\') ||
    path.includes(':') ||
    path.split('/').some((p) => p === '..' || p === '.' || p === '')
  )
    throw new Error('Invalid artifact path');
  const full = resolve(root, path),
    rel = relative(resolve(root), full);
  if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel))
    throw new Error('Path escapes workspace');
  let current = resolve(root);
  const isSymlink = (candidate: string) => {
    try {
      return lstatSync(candidate).isSymbolicLink();
    } catch {
      return false;
    }
  };
  if (isSymlink(current)) throw new Error('Symlink workspace is not supported');
  for (const part of path.split('/')) {
    current = join(current, part);
    if (isSymlink(current)) throw new Error('Symlink artifacts are not supported');
  }
  return full;
}
export function manifest(root: string): Record<string, string> {
  const entries: Record<string, string> = {};
  let bytes = 0,
    count = 0;
  const walk = (directory: string, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw new Error(`Symlinks are not supported in workspaces: ${entry.name}`);
      if (ignored.has(entry.name) || sensitive.test(entry.name)) continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(directory, entry.name), path);
      else if (entry.isFile()) {
        if (
          ++count > 20000 ||
          (bytes += lstatSync(join(directory, entry.name)).size) > 200 * 1024 * 1024
        )
          throw new Error('Workspace exceeds the alpha limit (200 MB / 20,000 files)');
        entries[path] = hash(readFileSync(join(directory, entry.name)));
      }
    }
  };
  walk(root);
  return entries;
}
export function copyManifest(source: string, target: string, files: Record<string, string>) {
  mkdirSync(target, { recursive: true });
  for (const file of Object.keys(files)) {
    const destination = safePath(target, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(safePath(source, file), destination);
  }
}
export function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
  }).trim();
}
export class Workspaces {
  constructor(readonly home: string) {}
  directory(project: Project, name: string) {
    return join(this.home, 'work', project.id, name);
  }
  prepare(project: Project) {
    if (project.baseline) return;
    const native = realpathSync.native;
    const canonical = (path: string) =>
      process.platform === 'win32' ? native(path).toLowerCase() : native(path);
    const root = native(project.root);
    if (
      root === canonical(this.home) ||
      (relative(root, canonical(this.home)).split(sep)[0] !== '..' &&
        !isAbsolute(relative(root, canonical(this.home))))
    )
      throw new Error('Project cannot contain the Remora data directory');
    let repo: string | undefined;
    if (existsSync(join(root, '.git'))) {
      try {
        repo = git(root, ['rev-parse', '--show-toplevel']);
      } catch {
        throw new Error('The project Git metadata is invalid');
      }
    }
    if (repo) {
      if (canonical(repo) !== canonical(root)) throw new Error('Choose the Git repository root');
      if (git(root, ['status', '--porcelain']))
        throw new Error('Commit or move existing changes and untracked files before planning');
      project.baseCommit = git(root, ['rev-parse', 'HEAD']);
    }
    project.baseline = manifest(root);
    copyManifest(root, this.directory(project, 'input'), project.baseline);
  }
  createTask(project: Project, task: Task): string {
    const destination = this.directory(
      project,
      `${task.id}-r${task.revision}-${randomUUID().slice(0, 8)}`,
    );
    if (existsSync(destination))
      throw new Error(
        'Task workspace already exists; recover the previous attempt before retrying',
      );
    mkdirSync(dirname(destination), { recursive: true });
    if (project.baseCommit)
      git(project.root, ['worktree', 'add', '--detach', destination, project.baseCommit]);
    else copyManifest(this.directory(project, 'input'), destination, project.baseline!);
    // Dependency artifacts are part of this task's input, not a shared writable folder.
    const applied = new Map<string, string | undefined>();
    const visited = new Set<string>();
    const include = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      const dep = project.tasks.find((t) => t.id === id)!;
      dep.dependencies.forEach(include);
      this.overlay(dep, destination, applied);
    };
    task.dependencies.forEach(include);
    const baseline = manifest(destination);
    // Retain the original input baseline so accepted revisions contain the entire change.
    if (task.workspace && task.baseline) this.overlay(task, destination, new Map());
    task.baseline = baseline;
    if (project.baseCommit) task.gitBase = project.baseCommit;
    task.workspace = destination;
    return destination;
  }
  changes(task: Task): { path: string; digest?: string }[] {
    if (task.gitBase && existsSync(join(task.workspace!, '.git'))) {
      const summary = git(task.workspace!, ['diff', '--summary', task.gitBase]);
      if (/mode change|(?:create|delete) mode (?:100755|120000)|120000/.test(summary))
        throw new Error(
          'Executable-mode or symlink changes need manual Git integration in this alpha; no results were applied',
        );
      if (process.platform !== 'win32') {
        const untracked = git(task.workspace!, ['ls-files', '--others', '--exclude-standard'])
          .split(/\r?\n/)
          .filter(Boolean);
        for (const file of untracked)
          if ((statSync(safePath(task.workspace!, file)).mode & 0o111) !== 0)
            throw new Error(
              'New executable files need manual Git integration in this alpha; no results were applied',
            );
      }
    }
    const current = manifest(task.workspace!);
    const baseline = task.baseline!;
    return [...new Set([...Object.keys(baseline), ...Object.keys(current)])]
      .filter((path) => baseline[path] !== current[path])
      .map((path) => ({ path, digest: current[path] }));
  }
  private overlay(task: Task, destination: string, applied: Map<string, string | undefined>) {
    for (const { path, digest } of this.changes(task)) {
      const target = safePath(destination, path);
      const actual =
        existsSync(target) && lstatSync(target).isFile() ? hash(readFileSync(target)) : undefined;
      if (applied.has(path) && actual !== task.baseline![path] && actual !== digest)
        throw new Error(`Conflicting worker outputs: ${path}`);
      applied.set(path, digest);
      if (digest === undefined) {
        if (existsSync(target)) rmSync(target);
      } else {
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(safePath(task.workspace!, path), target);
      }
    }
  }
  stage(project: Project) {
    const suffix = randomUUID().slice(0, 8);
    const destination = this.directory(project, `staging-${suffix}`);
    if (existsSync(destination))
      throw new Error('Staging already exists; inspect the prior assembly before recovery');
    if (project.baseCommit) {
      project.integrationBranch = `remora/${project.id}-${suffix}`;
      git(project.root, [
        'worktree',
        'add',
        '-b',
        project.integrationBranch,
        destination,
        project.baseCommit,
      ]);
    } else copyManifest(this.directory(project, 'input'), destination, project.baseline!);
    const visited = new Set<string>(),
      applied = new Map<string, string | undefined>();
    const assemble = (task: Task) => {
      if (visited.has(task.id)) return;
      task.dependencies.forEach((id) => assemble(project.tasks.find((t) => t.id === id)!));
      this.overlay(task, destination, applied);
      visited.add(task.id);
    };
    project.tasks.forEach(assemble);
    project.staging = destination;
    if (project.baseCommit) {
      git(destination, ['add', '-A']);
      if (git(destination, ['status', '--porcelain']))
        git(destination, [
          '-c',
          'user.name=Remora',
          '-c',
          'user.email=remora@localhost',
          'commit',
          '-m',
          `Remora: ${project.name}`,
        ]);
    }
  }
  results(project: Project) {
    if (!project.staging)
      return { files: [], staging: undefined, integrationBranch: project.integrationBranch };
    const files = manifest(project.staging);
    const paths = [...new Set([...Object.keys(project.baseline!), ...Object.keys(files)])];
    return {
      staging: project.staging,
      integrationBranch: project.integrationBranch,
      files: paths.map((path) => {
        const data = files[path] ? readFileSync(safePath(project.staging!, path)) : Buffer.alloc(0);
        const before = project.baseline![path]
          ? readFileSync(safePath(this.directory(project, 'input'), path))
          : Buffer.alloc(0);
        const change = !files[path]
          ? 'deleted'
          : !project.baseline![path]
            ? 'added'
            : files[path] !== project.baseline![path]
              ? 'modified'
              : 'unchanged';
        const text = data.length < 100000 && !data.includes(0) ? data.toString('utf8') : undefined;
        const diff =
          change !== 'unchanged' &&
          text !== undefined &&
          before.length < 100000 &&
          !before.includes(0)
            ? createTwoFilesPatch(
                `a/${path}`,
                `b/${path}`,
                before.toString('utf8'),
                text,
                undefined,
                undefined,
                { context: 3 },
              )
            : undefined;
        return { path, size: data.length, text, change, diff };
      }),
    };
  }
  accept(project: Project) {
    if (project.state !== 'ready' || !project.staging)
      throw new Error('Only reviewed, ready results can be accepted');
    const before = manifest(project.root);
    if (
      JSON.stringify(Object.entries(before).sort()) !==
      JSON.stringify(Object.entries(project.baseline!).sort())
    )
      throw new Error('Project files changed since planning; resolve conflicts before acceptance');
    if (project.baseCommit) {
      if (
        git(project.root, ['rev-parse', 'HEAD']) !== project.baseCommit ||
        git(project.root, ['status', '--porcelain'])
      )
        throw new Error('Git HEAD or working tree changed since planning');
      git(project.root, ['merge', '--ff-only', project.integrationBranch!]);
    } else {
      const after = manifest(project.staging);
      const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
        (path) => before[path] !== after[path],
      );
      const journal = this.directory(project, 'acceptance-journal.json');
      if (existsSync(journal))
        throw new Error(
          'An interrupted acceptance journal exists; recover files from the input snapshot before retrying',
        );
      paths.forEach((path) => {
        safePath(project.root, path);
        safePath(project.staging!, path);
      });
      writeFileSync(journal, JSON.stringify({ state: 'applying', paths, before }, null, 2));
      try {
        for (const path of paths) {
          const destination = safePath(project.root, path);
          if (!after[path]) {
            if (existsSync(destination)) rmSync(destination);
          } else {
            mkdirSync(dirname(destination), { recursive: true });
            copyFileSync(safePath(project.staging, path), destination);
          }
        }
        rmSync(journal);
      } catch (error) {
        for (const path of paths) {
          const destination = safePath(project.root, path);
          if (before[path]) {
            mkdirSync(dirname(destination), { recursive: true });
            copyFileSync(safePath(this.directory(project, 'input'), path), destination);
          } else if (existsSync(destination)) rmSync(destination);
        }
        rmSync(journal);
        throw error;
      }
    }
  }
}
