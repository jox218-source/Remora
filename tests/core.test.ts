import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { Store, redact } from '../packages/remora/src/store.js';
import { Engine } from '../packages/remora/src/engine.js';
import { DemoProvider } from '../packages/remora/src/providers/demo.js';
import {
  validatePlan,
  type Plan,
  type RunRequest,
  type Project,
} from '../packages/remora/src/types.js';
import { manifest, safePath, git } from '../packages/remora/src/workspace.js';
import { createServer } from '../packages/remora/src/server.js';

async function until(check: () => boolean, label = 'condition', timeout = 10000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw new Error(`Timed out: ${label}`);
    await setTimeout(20);
  }
}
function fixture(provider = new DemoProvider()) {
  const dir = mkdtempSync(join(tmpdir(), 'remora-test-'));
  const home = join(dir, 'state'),
    root = join(dir, 'project');
  mkdirSync(root);
  writeFileSync(join(root, 'BRIEF.md'), 'Test project');
  const store = new Store(home),
    engine = new Engine(store, { demo: provider });
  engine.addAccount({ id: 'one', provider: 'demo' });
  engine.addAccount({ id: 'two', provider: 'demo' });
  const project = engine.createProject({
    root,
    name: 'Test',
    lead: 'one',
    workers: ['one', 'two'],
  });
  return {
    dir,
    home,
    root,
    store,
    engine,
    project,
    cleanup: async () => {
      await engine.close();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const plan: Plan = {
  summary: 'parallel tasks',
  tasks: ['first', 'second'].map((id, i) => ({
    id,
    title: id,
    instruction: `Write ${id}`,
    account: i ? 'two' : 'one',
    dependencies: [],
    acceptance: ['File exists'],
  })),
};

test('plan validation rejects duplicate IDs, unknown accounts, dependencies and cycles', () => {
  assert.equal(validatePlan(plan, ['one', 'two']).tasks.length, 2);
  assert.throws(
    () => validatePlan({ ...plan, tasks: [plan.tasks[0], plan.tasks[0]] }, ['one', 'two']),
    /unique/,
  );
  assert.throws(() => validatePlan(plan, ['one']), /eligible/);
  assert.throws(
    () =>
      validatePlan({ ...plan, tasks: [{ ...plan.tasks[0], dependencies: ['missing'] }] }, ['one']),
    /Unknown/,
  );
  assert.throws(
    () =>
      validatePlan({ ...plan, tasks: [{ ...plan.tasks[0], dependencies: ['first'] }] }, ['one']),
    /cycle/,
  );
});

test('two parallel workers retain their workspaces and finish review before acceptance', async () => {
  const f = fixture();
  try {
    await f.engine.plan(f.project.id, 'Test parallel work', plan);
    assert.throws(() => f.engine.start(f.project.id), /Approve/);
    f.engine.approve(f.project.id);
    f.engine.start(f.project.id);
    await until(
      () => f.engine.project(f.project.id).tasks.every((t) => t.status === 'running'),
      'parallel execution',
    );
    const concurrent = f.engine.project(f.project.id);
    assert.ok(concurrent.tasks.every((t) => t.workspace && t.baseline && t.session));
    assert.notEqual(concurrent.tasks[0].workspace, concurrent.tasks[1].workspace);
    await until(() => f.engine.project(f.project.id).state === 'ready', 'review completion');
    assert.equal(existsSync(join(f.root, 'deliverables', 'first.md')), false);
    f.engine.accept(f.project.id);
    assert.equal(f.engine.project(f.project.id).state, 'accepted');
    assert.match(readFileSync(join(f.root, 'deliverables', 'first.md'), 'utf8'), /simulated/);
  } finally {
    await f.cleanup();
  }
});

test('lead-generated demo plan, dependencies and result assembly work end to end', async () => {
  const f = fixture();
  try {
    await f.engine.plan(f.project.id, 'Write a simulated report');
    await until(() => f.engine.project(f.project.id).state === 'draft');
    f.engine.approve(f.project.id);
    f.engine.start(f.project.id);
    await until(() => f.engine.project(f.project.id).state === 'ready');
    const result = f.engine.results(f.project.id);
    assert.ok(result.files.some((file) => file.path === 'deliverables/report.md'));
    assert.equal(
      result.files.find((file) => file.path === 'deliverables/report.md')?.change,
      'added',
    );
    assert.match(
      result.files.find((file) => file.path === 'deliverables/report.md')?.diff ?? '',
      /\+This is a simulated/,
    );
    assert.equal(
      f.engine.project(f.project.id).tasks.every((task) => task.status === 'accepted'),
      true,
    );
  } finally {
    await f.cleanup();
  }
});

test('acceptance refuses changed source files without overwriting them', async () => {
  const f = fixture();
  try {
    await f.engine.plan(f.project.id, 'Test', plan);
    f.engine.approve(f.project.id);
    f.engine.start(f.project.id);
    await until(() => f.engine.project(f.project.id).state === 'ready');
    writeFileSync(join(f.root, 'BRIEF.md'), 'User edit');
    assert.throws(() => f.engine.accept(f.project.id), /changed/);
    assert.equal(readFileSync(join(f.root, 'BRIEF.md'), 'utf8'), 'User edit');
  } finally {
    await f.cleanup();
  }
});

test('pause permits active work to finish but does not dispatch review', async () => {
  const f = fixture();
  try {
    await f.engine.plan(f.project.id, 'Test', plan);
    f.engine.approve(f.project.id);
    f.engine.start(f.project.id);
    f.engine.pause(f.project.id);
    await until(() => f.engine.project(f.project.id).tasks.every((t) => t.status === 'review'));
    assert.equal(f.engine.project(f.project.id).state, 'paused');
    f.engine.start(f.project.id);
    await until(() => f.engine.project(f.project.id).state === 'ready');
  } finally {
    await f.cleanup();
  }
});

test('cancellation settles turns and preserves workspaces', async () => {
  const f = fixture();
  try {
    await f.engine.plan(f.project.id, 'Test', plan);
    f.engine.approve(f.project.id);
    f.engine.start(f.project.id);
    const workspace = f.engine.project(f.project.id).tasks[0].workspace!;
    f.engine.cancel(f.project.id);
    await until(() => !f.engine.busyAccount('one') && !f.engine.busyAccount('two'));
    assert.equal(f.engine.project(f.project.id).state, 'cancelled');
    assert.ok(existsSync(workspace));
  } finally {
    await f.cleanup();
  }
});

test('rejected task revisions preserve cumulative edits and stop after the configured limit', async () => {
  class Reject extends DemoProvider {
    override async run(run: RunRequest) {
      if (run.readOnly) return JSON.stringify({ approved: false, feedback: 'Revise output' });
      return super.run(run);
    }
  }
  const f = fixture(new Reject());
  try {
    await f.engine.plan(f.project.id, 'Test', { ...plan, tasks: [plan.tasks[0]] });
    f.engine.approve(f.project.id);
    f.engine.start(f.project.id);
    await until(() => f.engine.project(f.project.id).state === 'blocked');
    assert.equal(f.engine.project(f.project.id).tasks[0].revision, 2);
    assert.match(f.engine.project(f.project.id).error!, /Revision limit/);
  } finally {
    await f.cleanup();
  }
});

test('workspace assembly detects incompatible outputs and blocks traversal', async () => {
  const f = fixture();
  try {
    const p = f.project;
    f.engine.workspaces.prepare(p);
    p.tasks = plan.tasks.map((t) => ({ ...t, revision: 0, status: 'accepted' }));
    p.tasks.forEach((t, i) => {
      f.engine.workspaces.createTask(p, t);
      writeFileSync(join(t.workspace!, 'shared.md'), String(i));
    });
    assert.throws(() => f.engine.workspaces.stage(p), /Conflicting/);
    for (const path of ['../secrets', '/etc/passwd', 'C:/Windows', 'a/../../secret', 'a\\secret'])
      assert.throws(() => safePath(f.root, path));
    writeFileSync(join(f.root, '.env'), 'API_KEY=secret');
    assert.equal(Object.hasOwn(manifest(f.root), '.env'), false);
  } finally {
    await f.cleanup();
  }
});

test('Git outputs are isolated and accepted by fast-forward only', async () => {
  const f = fixture();
  try {
    git(f.root, ['init']);
    git(f.root, ['add', '.']);
    git(f.root, [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-m',
      'initial',
    ]);
    await f.engine.plan(f.project.id, 'Test', { ...plan, tasks: [plan.tasks[0]] });
    f.engine.approve(f.project.id);
    f.engine.start(f.project.id);
    await until(() => f.engine.project(f.project.id).state === 'ready');
    assert.match(f.engine.project(f.project.id).integrationBranch!, /^remora\//);
    assert.equal(existsSync(join(f.root, 'deliverables', 'first.md')), false);
    f.engine.accept(f.project.id);
    assert.equal(existsSync(join(f.root, 'deliverables', 'first.md')), true);
  } finally {
    await f.cleanup();
  }
});

test('recovery never silently reruns an uncertain task', async () => {
  const f = fixture();
  try {
    const project: Project = {
      ...f.project,
      state: 'running',
      tasks: [
        {
          ...plan.tasks[0],
          status: 'running',
          revision: 0,
          session: { account: 'one', threadId: 'unknown' },
        },
      ],
    };
    f.store.put('projects', project);
    await f.engine.recover();
    assert.equal(f.engine.project(project.id).state, 'blocked');
    assert.equal(f.engine.project(project.id).tasks[0].status, 'interrupted');
    assert.equal(f.engine.busyAccount('one'), false);
  } finally {
    await f.cleanup();
  }
});

test('local API rejects unauthenticated, cross-origin and invalid-host requests', async () => {
  const f = fixture(),
    token = 'a'.repeat(64);
  const app = await createServer(f.engine, token);
  const headers = { host: '127.0.0.1:7437' };
  try {
    assert.equal((await app.inject({ url: '/api/state', headers })).statusCode, 401);
    assert.equal(
      (
        await app.inject({
          url: '/api/state',
          headers: { ...headers, authorization: `Bearer ${token}`, origin: 'https://evil.example' },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          url: '/api/state',
          headers: { host: 'evil.example', authorization: `Bearer ${token}` },
        })
      ).statusCode,
      403,
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers,
      payload: { token },
    });
    assert.equal(response.statusCode, 200);
    const cookie = response.headers['set-cookie'] as string;
    assert.match(cookie, /HttpOnly/);
    const state = await app.inject({ url: '/api/state', headers: { ...headers, cookie } });
    assert.equal(state.statusCode, 200);
    assert.equal(state.json().accounts.length, 2);
    assert.equal(
      (await app.inject({ url: '/api/events?after=oops', headers: { ...headers, cookie } }))
        .statusCode,
      400,
    );
  } finally {
    await app.close();
    await f.cleanup();
  }
});

test('event logs redact common token and credential formats', () => {
  assert.equal(
    redact('api_key=top-secret-value sk-1234567890abcdef'),
    'api_key=[REDACTED] [REDACTED]',
  );
});

test('provider events retain the account that performed the action', async () => {
  const f = fixture();
  try {
    f.store.log('provider', 'Completed commandExecution', f.project.id, 'first', 'two');
    assert.equal(f.store.logs(f.project.id).at(-1)?.account, 'two');
  } finally {
    await f.cleanup();
  }
});

test('session approval is rejected when the provider did not advertise it', async () => {
  const f = fixture();
  try {
    const pending = f.engine.requestApproval(
      {
        projectId: f.project.id,
        account: f.engine.account('one'),
        cwd: f.root,
        prompt: 'test',
        readOnly: true,
        network: false,
        signal: new AbortController().signal,
        onSession() {},
        onEvent() {},
      },
      'item/commandExecution/requestApproval',
      { availableDecisions: ['accept', 'decline'] },
    );
    const approval = f.engine.snapshot().approvals[0];
    assert.ok(approval);
    assert.throws(() => f.engine.decide(approval.id, 'acceptForSession'), /did not offer/);
    f.engine.decide(approval.id, 'decline');
    await assert.doesNotReject(pending);
  } finally {
    await f.cleanup();
  }
});

test('Windows account aliases cannot collide or use reserved device names', async () => {
  const f = fixture();
  try {
    assert.throws(() => f.engine.addAccount({ id: 'ONE', provider: 'demo' }), /lowercase/);
    assert.throws(() => f.engine.addAccount({ id: 'con', provider: 'demo' }), /reserved/);
    assert.throws(() => f.engine.addAccount({ id: 'one', provider: 'demo' }), /already exists/);
  } finally {
    await f.cleanup();
  }
});

test('demo rejects collisions with real-provider aliases before running models', async () => {
  const f = fixture();
  try {
    f.engine.addAccount({ id: 'demo-one', provider: 'codex' });
    assert.throws(() => f.engine.demo(), /real provider/);
  } finally {
    await f.cleanup();
  }
});

test('recovery blocks dispatch while slow provider reconciliation is pending', async () => {
  class SlowRecover extends DemoProvider {
    calls = 0;
    override async reconcile() {
      await setTimeout(400);
      return { status: 'unknown' };
    }
    override async run(run: RunRequest) {
      this.calls++;
      return super.run(run);
    }
  }
  const provider = new SlowRecover(),
    f = fixture(provider);
  try {
    const p = {
      ...f.project,
      state: 'running' as const,
      tasks: plan.tasks.map((t, i) => ({
        ...t,
        status: i ? ('pending' as const) : ('running' as const),
        revision: 0,
        ...(i ? {} : { session: { account: 'one', threadId: 'unknown' } }),
      })),
    };
    f.store.put('projects', p);
    await f.engine.recover();
    assert.equal(provider.calls, 0);
    assert.equal(f.engine.project(p.id).state, 'blocked');
  } finally {
    await f.cleanup();
  }
});

test('late account refresh cannot resurrect a removed account', async () => {
  class SlowStatus extends DemoProvider {
    override async status(account: any) {
      await setTimeout(100);
      return super.status(account);
    }
  }
  const f = fixture(new SlowStatus());
  try {
    f.engine.addAccount({ id: 'unused', provider: 'demo' });
    const refresh = f.engine.refreshAccount('unused');
    await f.engine.removeAccount('unused');
    await refresh;
    assert.throws(() => f.engine.account('unused'), /not found/);
  } finally {
    await f.cleanup();
  }
});

test('concurrent account refreshes share one bounded provider status call', async () => {
  class CountStatus extends DemoProvider {
    calls = 0;
    override async status(account: any) {
      this.calls++;
      await setTimeout(50);
      return super.status(account);
    }
  }
  const provider = new CountStatus();
  const f = fixture(provider);
  try {
    await Promise.all([f.engine.refreshAccount('one'), f.engine.refreshAccount('one')]);
    assert.equal(provider.calls, 1);
  } finally {
    await f.cleanup();
  }
});

test('failed deferred refresh cannot resurrect removal or overwrite quarantine', async () => {
  class FailingStatus extends DemoProvider {
    override async status(_account: any): Promise<never> {
      await setTimeout(50);
      throw new Error('provider unavailable');
    }
  }
  const f = fixture(new FailingStatus());
  try {
    f.engine.addAccount({ id: 'refresh-remove', provider: 'demo' });
    const removed = f.engine.refreshAccount('refresh-remove');
    await setTimeout(5);
    await f.engine.removeAccount('refresh-remove');
    await removed;
    assert.throws(() => f.engine.account('refresh-remove'), /not found/);

    f.engine.addAccount({ id: 'refresh-quarantine', provider: 'demo' });
    const quarantined = f.engine.refreshAccount('refresh-quarantine');
    await setTimeout(5);
    const account = f.engine.account('refresh-quarantine');
    account.status = 'quarantined';
    f.store.put('accounts', account);
    await quarantined;
    assert.equal(f.engine.account('refresh-quarantine').status, 'quarantined');
  } finally {
    await f.cleanup();
  }
});

test('every terminated run removes its pending approval', async () => {
  const f = fixture();
  try {
    let settle: (() => void) | undefined;
    f.engine.providers.demo.run = async (run) => {
      void f.engine.requestApproval(run, 'item/commandExecution/requestApproval', {
        command: 'test',
      });
      await new Promise<void>((resolve) => {
        settle = resolve;
      });
      throw new Error('Simulated failed provider');
    };
    await f.engine.plan(f.project.id, 'Test', { ...plan, tasks: [plan.tasks[0]] });
    f.engine.approve(f.project.id);
    f.engine.start(f.project.id);
    await until(() => f.engine.approvals.size === 1);
    settle!();
    await until(() => f.engine.project(f.project.id).state === 'blocked');
    assert.equal(f.engine.approvals.size, 0);
  } finally {
    await f.cleanup();
  }
});

test('uncertain planning shutdown quarantines its account despite stale refresh or logout', async () => {
  const f = fixture();
  try {
    f.engine.providers.demo.status = async () => {
      await setTimeout(200);
      return { status: 'demo' };
    };
    f.engine.providers.demo.run = async () => {
      await setTimeout(20);
      throw new Error('Unconfirmed provider shutdown');
    };
    const refresh = f.engine.refreshAccount('one');
    await f.engine.plan(f.project.id, 'Test quarantine');
    await until(() => f.engine.project(f.project.id).state === 'blocked');
    await refresh;
    assert.equal(f.engine.account('one').status, 'quarantined');
    assert.equal(f.engine.busyAccount('one'), true);
    await assert.rejects(() => f.engine.logout('one'), /quarantined/);
    await assert.rejects(() => f.engine.recoverAccount('one', false), /confirmation/);
  } finally {
    await f.cleanup();
  }
});

test('a project folder nested inside another repository uses a snapshot', async () => {
  const f = fixture();
  try {
    git(f.dir, ['init']);
    await f.engine.plan(f.project.id, 'Nested project', plan);
    assert.equal(f.engine.project(f.project.id).state, 'draft');
    assert.equal(f.engine.project(f.project.id).baseCommit, undefined);
  } finally {
    await f.cleanup();
  }
});
