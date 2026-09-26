#!/usr/bin/env node
import { Command } from 'commander';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve, join, basename } from 'node:path';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  openSync,
  closeSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { Store } from './store.js';
import { Engine } from './engine.js';
import { createServer } from './server.js';

const program = new Command()
  .name('remora')
  .description('Local orchestration for multiple AI accounts')
  .version('0.1.0-alpha.1')
  .option(
    '--home <path>',
    'Local state directory',
    process.env.REMORA_HOME ?? join(homedir(), '.remora'),
  )
  .option('--json', 'Machine-readable JSON output');
const home = () => resolve(program.opts().home);
function output(value: unknown) {
  console.log(JSON.stringify(value, null, program.opts().json ? undefined : 2));
}
function runtime(): { port: number; token: string; pid: number } {
  const path = join(home(), 'runtime.json');
  if (!existsSync(path))
    throw new Error('Remora is not running. Run remora up in another terminal first.');
  const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<{
    port: number;
    token: string;
    pid: number;
  }>;
  const { port, token, pid } = value;
  if (
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    typeof token !== 'string' ||
    typeof pid !== 'number' ||
    !Number.isInteger(pid) ||
    pid <= 0
  )
    throw new Error(`Invalid Remora runtime record in ${path}`);
  return { port, token, pid };
}
async function api(path: string, body?: unknown): Promise<any> {
  const state = runtime();
  const response = await fetch(`http://127.0.0.1:${state.port}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${state.token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json()) as any;
  if (!response.ok) throw new Error(data.error ?? 'Request failed');
  return data;
}
program
  .command('up')
  .description('Run the local service and dashboard (foreground)')
  .option('--port <port>', 'Loopback port', '7437')
  .action(async (options) => {
    const port = Number(options.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error('Port must be between 1024 and 65535');
    mkdirSync(home(), { recursive: true, mode: 0o700 });
    const lock = join(home(), 'service.lock');
    if (existsSync(lock)) {
      const pid = Number(readFileSync(lock, 'utf8'));
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
      }
      if (alive)
        throw new Error(
          'A Remora service already owns this home directory. Use remora status or remora stop from the same home.',
        );
      rmSync(lock);
    }
    const fd = openSync(lock, 'wx', 0o600);
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    const store = new Store(home()),
      engine = new Engine(store),
      token = randomBytes(32).toString('hex');
    let app: Awaited<ReturnType<typeof createServer>> | undefined;
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      await app?.close();
      await engine.close();
      store.close();
      if (existsSync(join(home(), 'runtime.json'))) rmSync(join(home(), 'runtime.json'));
      if (existsSync(lock)) rmSync(lock);
    };
    try {
      await engine.recover();
      app = await createServer(engine, token, port, stop);
      try {
        await app.listen({ host: '127.0.0.1', port });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE')
          throw new Error(
            `Port ${port} is already in use. Choose another port with --port; Remora did not stop the other process.`,
          );
        throw error;
      }
      writeFileSync(
        join(home(), 'runtime.json'),
        JSON.stringify({ port, token, pid: process.pid }),
        { mode: 0o600 },
      );
      output({
        dashboard: `http://127.0.0.1:${port}/#token=${token}`,
        home: home(),
        status: 'running',
      });
      process.once('SIGINT', () => {
        void stop();
      });
      process.once('SIGTERM', () => {
        void stop();
      });
    } catch (error) {
      await stop();
      throw error;
    }
  });
program
  .command('stop')
  .description('Request a graceful stop from the Remora service for this home')
  .action(async () => {
    const state = runtime();
    const lock = join(home(), 'service.lock');
    if (!existsSync(lock) || Number(readFileSync(lock, 'utf8')) !== state.pid)
      throw new Error('The runtime record is not owned by the service lock for this home');
    try {
      process.kill(state.pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH')
        throw new Error('Remora is not running; its runtime record is stale.');
      throw error;
    }
    const response = await fetch(`http://127.0.0.1:${state.port}/api/shutdown`, {
      method: 'POST',
      headers: {
        Host: `127.0.0.1:${state.port}`,
        Authorization: `Bearer ${state.token}`,
      },
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(data.error ?? 'Remora rejected the shutdown request');
    const deadline = Date.now() + 5000;
    while (existsSync(join(home(), 'runtime.json')) && Date.now() < deadline) await setTimeout(50);
    if (existsSync(join(home(), 'runtime.json')))
      throw new Error(
        'Shutdown was requested but the service is still running; press Ctrl+C in its terminal.',
      );
    output({ home: home(), status: 'stopped' });
  });
program
  .command('doctor')
  .description('Inspect local prerequisites without using AI credentials')
  .action(() => {
    const checks: Record<string, string> = {
      node: process.version,
      platform: process.platform,
      home: home(),
    };
    for (const name of ['git', 'codex']) {
      try {
        checks[name] = execFileSync(
          name === 'codex' ? (process.env.REMORA_CODEX_BIN ?? name) : name,
          ['--version'],
          { encoding: 'utf8', windowsHide: true, timeout: 10000 },
        ).trim();
      } catch {
        checks[name] = 'not found';
      }
    }
    checks.liveValidation = 'Not performed by doctor; see docs/testing.md';
    output(checks);
  });
const accounts = program
  .command('accounts')
  .description('Manage isolated provider account profiles');
accounts
  .command('add <alias>')
  .option('--provider <provider>', 'codex or demo', 'codex')
  .option('--model <model>', 'Provider model identifier')
  .action(async (id, options) => output(await api('/accounts', { id, ...options })));
accounts.command('list').action(async () => output((await api('/state')).accounts));
accounts
  .command('recover <alias>')
  .requiredOption(
    '--confirm-stopped',
    'Confirm you stopped all provider processes belonging to this quarantined profile',
  )
  .action(async (id, options) =>
    output(
      await api(`/accounts/${encodeURIComponent(id)}/recover`, {
        confirmedStopped: options.confirmStopped,
      }),
    ),
  );
for (const action of ['login', 'refresh', 'logout', 'remove'])
  accounts
    .command(`${action} <alias>`)
    .action(async (id) => output(await api(`/accounts/${encodeURIComponent(id)}/${action}`, {})));
program
  .command('init [path]')
  .description('Register a trusted local project')
  .requiredOption('--lead <account>', 'Lead and reviewer account')
  .requiredOption('--workers <accounts>', 'Comma-separated worker account aliases')
  .option('--name <name>', 'Project display name')
  .option('--network', 'Allow worker network access', false)
  .option(
    '--sandbox-only',
    'Run provider turns inside the task sandbox without escalation prompts',
    false,
  )
  .option('--concurrency <number>', 'Maximum active project turns', '4')
  .action(async (path = '.', options) => {
    const root = resolve(path);
    output(
      await api('/projects', {
        root,
        name: options.name ?? basename(root),
        lead: options.lead,
        workers: options.workers.split(',').map((v: string) => v.trim()),
        network: options.network,
        approvalPolicy: options.sandboxOnly ? 'never' : 'on-request',
        maxConcurrency: Number(options.concurrency),
      }),
    );
  });
program
  .command('demo')
  .description('Create an offline demonstration project (no model calls)')
  .action(async () => output(await api('/demo', {})));
program
  .command('plan <projectId>')
  .requiredOption('--goal <text>', 'Project goal')
  .option('--file <path>', 'Import a JSON task plan instead of invoking the lead')
  .action(async (id, options) =>
    output(
      await api(`/projects/${id}/plan`, {
        goal: options.goal,
        ...(options.file ? { plan: JSON.parse(readFileSync(resolve(options.file), 'utf8')) } : {}),
      }),
    ),
  );
for (const action of ['approve', 'run', 'pause', 'resume', 'cancel'])
  program
    .command(`${action} <projectId>`)
    .action(async (id) => output(await api(`/projects/${id}/${action}`, {})));
program
  .command('retry <projectId>')
  .requiredOption('--task <taskId>', 'Explicitly retry one blocked/interrupted task')
  .action(async (id, options) =>
    output(await api(`/projects/${id}/retry`, { taskId: options.task })),
  );
program.command('status [projectId]').action(async (id) => {
  let state: any;
  try {
    state = await api('/state');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Remora is not running.')) {
      output({ home: home(), status: 'stopped' });
      return;
    }
    if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) {
      try {
        process.kill(runtime().pid, 0);
      } catch (processError) {
        if ((processError as NodeJS.ErrnoException).code === 'ESRCH') {
          output({ home: home(), status: 'stopped', detail: 'stale runtime record' });
          return;
        }
      }
      throw new Error('The Remora service did not respond on its recorded local port.');
    }
    throw error;
  }
  output(
    id
      ? {
          project: state.projects.find((p: any) => p.id === id),
          approvals: state.approvals.filter((a: any) => a.projectId === id),
        }
      : state,
  );
});
program
  .command('messages <projectId>')
  .description('List durable project conversation messages and per-recipient delivery')
  .option('--after <messageId>', 'Only messages after this stable message id')
  .action(async (id, options) =>
    output(
      await api(
        `/projects/${encodeURIComponent(id)}/messages${options.after ? `?after=${encodeURIComponent(options.after)}` : ''}`,
      ),
    ),
  );
program
  .command('message <projectId>')
  .description('Send a bounded project message; unsupported adapters leave it queued')
  .requiredOption('--to <accounts>', 'Comma-separated project member aliases')
  .requiredOption('--text <text>', 'Message text')
  .option('--kind <kind>', 'update, question, answer, or blocker', 'update')
  .option('--reply-to <messageId>', 'Stable message id being answered')
  .option('--idempotency-key <key>', 'Retry key to prevent duplicate delivery')
  .action(async (id, options) =>
    output(
      await api(`/projects/${encodeURIComponent(id)}/messages`, {
        recipients: options.to.split(',').map((value: string) => value.trim()),
        content: options.text,
        kind: options.kind,
        ...(options.replyTo ? { replyTo: options.replyTo } : {}),
        ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      }),
    ),
  );
program
  .command('permission <approvalId>')
  .requiredOption('--decision <decision>', 'accept, acceptForSession, or decline')
  .action(async (id, options) =>
    output(await api(`/approvals/${id}`, { decision: options.decision })),
  );
program
  .command('results <projectId>')
  .option('--accept', 'Apply reviewed results into the original project')
  .action(async (id, options) =>
    output(
      await api(
        `/projects/${id}/${options.accept ? 'accept' : 'results'}`,
        options.accept ? {} : undefined,
      ),
    ),
  );
program
  .command('logs [projectId]')
  .option('--follow', 'Stream newline-delimited events')
  .action(async (id, options) => {
    let after = 0;
    do {
      const events = await api(
        `/events?after=${after}${id ? `&projectId=${encodeURIComponent(id)}` : ''}`,
      );
      for (const event of events) {
        output(event);
        after = event.id;
      }
      if (options.follow) await setTimeout(1000);
    } while (options.follow);
  });
program.parseAsync().catch((error) => {
  console.error(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
});
