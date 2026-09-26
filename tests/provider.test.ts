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

test('Codex adapter advertises and serves authenticated Remora dynamic project tools', async () => {
  const home = mkdtempSync(join(tmpdir(), 'remora-dynamic-tools-'));
  const sent: unknown[] = [];
  const projectMessage = {
    id: '00000000-0000-4000-8000-000000000001',
    projectId: 'project-1',
    idempotencyKey: 'fixture-dynamic-1',
    sender: { kind: 'agent' as const, id: 'one', role: 'worker' as const },
    recipients: [{ account: 'two', status: 'queued' as const }],
    content: 'Fixture dynamic message',
    kind: 'update' as const,
    createdAt: new Date().toISOString(),
  };
  const provider = new CodexProvider(
    home,
    async () => 'decline',
    () => {},
    process.execPath,
    [resolve('tests/fixtures/codex.mjs')],
  );
  const account = { id: 'one', provider: 'codex' as const, status: 'connected' };
  const base = (prompt: string): RunRequest => ({
    projectId: 'project-1',
    taskId: 'task-1',
    account,
    cwd: home,
    prompt,
    readOnly: true,
    network: false,
    signal: new AbortController().signal,
    onSession() {},
    onEvent() {},
    sendProjectMessage(input) {
      sent.push(input);
      return projectMessage;
    },
    readProjectMessages() {
      return [projectMessage];
    },
  });
  try {
    assert.equal(await provider.run(base('DYNAMIC_SEND')), 'Dynamic tool response acknowledged');
    const started = JSON.parse(
      readFileSync(join(home, 'profiles', 'one', 'thread-start.json'), 'utf8'),
    );
    assert.deepEqual(
      started.dynamicTools.map((tool: { name: string }) => tool.name),
      ['remora_send_project_message', 'remora_read_project_messages'],
    );
    assert.deepEqual(sent, [
      {
        recipients: ['two'],
        content: 'Fixture dynamic message',
        kind: 'update',
        idempotencyKey: 'fixture-dynamic-1',
      },
    ]);
    const toolResult = JSON.parse(
      readFileSync(join(home, 'profiles', 'one', 'tool-result.json'), 'utf8'),
    );
    assert.equal(toolResult.success, true);
    assert.match(toolResult.contentItems[0].text, /messageId/);
    assert.equal(await provider.run(base('DYNAMIC_READ')), 'Dynamic tool response acknowledged');
    assert.equal(sent.length, 1);
    assert.equal(
      await provider.run(base('DYNAMIC_DUPLICATE')),
      'Dynamic tool response acknowledged',
    );
    assert.equal(sent.length, 2);
  } finally {
    await provider.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('Codex adapter rejects spoofed dynamic project tool fields and unknown scope', async () => {
  const home = mkdtempSync(join(tmpdir(), 'remora-dynamic-reject-'));
  let sent = 0;
  const provider = new CodexProvider(
    home,
    async () => 'decline',
    () => {},
    process.execPath,
    [resolve('tests/fixtures/codex.mjs')],
  );
  const account = { id: 'one', provider: 'codex' as const, status: 'connected' };
  try {
    const result = await provider.run({
      projectId: 'project-1',
      taskId: 'task-1',
      account,
      cwd: home,
      prompt: 'DYNAMIC_BAD_ARGS',
      readOnly: true,
      network: false,
      signal: new AbortController().signal,
      onSession() {},
      onEvent() {},
      sendProjectMessage() {
        sent++;
        throw new Error('must not be called');
      },
      readProjectMessages() {
        return [];
      },
    });
    assert.equal(result, 'Dynamic tool response failed');
    assert.equal(sent, 0);
    const toolResult = JSON.parse(
      readFileSync(join(home, 'profiles', 'one', 'tool-result.json'), 'utf8'),
    );
    assert.equal(toolResult.success, false);
  } finally {
    await provider.close();
    rmSync(home, { recursive: true, force: true });
  }
});
