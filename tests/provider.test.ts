import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout } from 'node:timers/promises';
import { CodexProvider } from '../packages/remora/src/providers/codex.js';
import type { RunRequest } from '../packages/remora/src/types.js';

test('Codex adapter isolates profiles, streams results, routes permissions, reconciles and cancels', async () => {
  const home = mkdtempSync(join(tmpdir(), 'remora-protocol-'));
  let approvals = 0;
  const provider = new CodexProvider(
    home,
    async () => {
      approvals++;
      return 'accept';
    },
    () => {},
    process.execPath,
    [resolve('tests/fixtures/codex.mjs')],
  );
  const one = { id: 'one', provider: 'codex' as const, status: 'connected' },
    two = { ...one, id: 'two' };
  const run: RunRequest = {
    projectId: 'p',
    account: one,
    cwd: home,
    prompt: 'test',
    readOnly: false,
    network: false,
    signal: new AbortController().signal,
    onSession() {},
    onEvent() {},
  };
  try {
    const statuses = await Promise.all([provider.status(one), provider.status(two)]);
    assert.notEqual(statuses[0].identity, statuses[1].identity);
    assert.ok(
      existsSync(join(home, 'profiles', 'one')) && existsSync(join(home, 'profiles', 'two')),
    );
    const result = await provider.run(run);
    assert.equal(result, 'Simulated protocol response');
    const permission = await provider.run({ ...run, prompt: 'APPROVAL' });
    assert.equal(permission, 'accept');
    assert.equal(approvals, 1);
    const recovered = await provider.reconcile({
      account: 'one',
      threadId: 'thread-1',
      turnId: 'turn-thread-1',
    });
    assert.equal(recovered.output, 'Recovered result');
    const priorPid = Number(readFileSync(join(home, 'profiles', 'one', 'fixture-pid.txt'), 'utf8'));
    await assert.rejects(
      () => provider.run({ ...run, prompt: 'START_ERROR' }),
      /uncertain turn start/,
    );
    assert.throws(() => process.kill(priorPid, 0), /ESRCH/);
    const controller = new AbortController();
    const blocked = provider.run({ ...run, prompt: 'HANG', signal: controller.signal });
    const rejection = assert.rejects(blocked, /cancelled/);
    await setTimeout(100);
    controller.abort();
    await rejection;
    assert.equal((await provider.status(one)).identity, 'one@example.invalid');
  } finally {
    await provider.close();
    rmSync(home, { recursive: true, force: true });
  }
});
