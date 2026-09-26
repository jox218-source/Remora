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
  let approvalDecision: 'accept' | 'acceptForSession' = 'accept';
  const provider = new CodexProvider(
    home,
    async () => {
      approvals++;
      return approvalDecision;
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
    const models = await provider.models(one);
    assert.equal(models[0].model, 'fixture-model');
    assert.equal(models[0].supportedReasoningEfforts[0].effort, 'medium');
    assert.ok(
      existsSync(join(home, 'profiles', 'one')) && existsSync(join(home, 'profiles', 'two')),
    );
    const result = await provider.run(run);
    assert.equal(result, 'Simulated protocol response');
    await assert.rejects(
      () => provider.run({ ...run, account: { ...one, identity: 'other@example.invalid' } }),
      /identity changed/,
    );
    const permission = await provider.run({ ...run, prompt: 'APPROVAL' });
    assert.equal(permission, 'accept');
    assert.equal(approvals, 1);
    approvalDecision = 'acceptForSession';
    const sessionPermission = await provider.run({ ...run, prompt: 'APPROVAL' });
    assert.equal(sessionPermission, 'acceptForSession');
    assert.equal(approvals, 2);
    const filePermission = await provider.run({ ...run, prompt: 'FILE_APPROVAL' });
    assert.equal(filePermission, 'acceptForSession');
    assert.equal(approvals, 3);
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
    const activePid = Number(
      readFileSync(join(home, 'profiles', 'one', 'fixture-pid.txt'), 'utf8'),
    );
    const rejection = assert.rejects(blocked, /cancelled/);
    await setTimeout(100);
    controller.abort();
    await rejection;
    assert.throws(() => process.kill(activePid, 0), /ESRCH/);
    assert.equal((await provider.status(one)).identity, 'one@example.invalid');
    provider.status = async () => ({ status: 'connected', authType: 'apiKey' });
    await assert.rejects(
      () => provider.run({ ...run, account: { ...one, boundIdentity: 'one@example.invalid' } }),
      /identity changed/,
    );
  } finally {
    await provider.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('Codex adapter treats expired login and exhausted usage as unavailable in isolated profiles', async () => {
  const home = mkdtempSync(join(tmpdir(), 'remora-recovery-'));
  const provider = new CodexProvider(
    home,
    async () => 'decline',
    () => {},
    process.execPath,
    [resolve('tests/fixtures/codex.mjs')],
  );
  const expired = { id: 'expired-login', provider: 'codex' as const, status: 'connected' };
  const exhausted = { id: 'exhausted-usage', provider: 'codex' as const, status: 'connected' };
  const allowedPrimaryFull = {
    id: 'allowed-primary-full',
    provider: 'codex' as const,
    status: 'connected',
  };
  const base = (account: typeof expired): RunRequest => ({
    projectId: 'recovery',
    account,
    cwd: home,
    prompt: 'test',
    readOnly: true,
    network: false,
    signal: new AbortController().signal,
    onSession() {},
    onEvent() {},
  });
  try {
    const expiredStatus = await provider.status(expired);
    assert.equal(expiredStatus.status, 'signed-out');
    await assert.rejects(() => provider.run(base(expired)), /no longer connected/);

    const exhaustedStatus = await provider.status(exhausted);
    assert.equal(exhaustedStatus.status, 'connected');
    assert.equal((exhaustedStatus.usage as any).ordinaryUsageAllowed, false);
    await assert.rejects(() => provider.run(base(exhausted)), /usage allowance is exhausted/);

    const allowedStatus = await provider.status(allowedPrimaryFull);
    assert.equal((allowedStatus.usage as any).ordinaryUsageAllowed, true);
    assert.equal((allowedStatus.usage as any).rateLimits.primary.usedPercent, 100);
    assert.equal(await provider.run(base(allowedPrimaryFull)), 'Simulated protocol response');
  } finally {
    await provider.close();
    rmSync(home, { recursive: true, force: true });
  }
});
