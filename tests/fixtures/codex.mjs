import { createInterface } from 'node:readline';
import { basename } from 'node:path';
import { setTimeout } from 'node:timers';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
writeFileSync(join(process.env.CODEX_HOME, 'fixture-pid.txt'), String(process.pid));
let sequence = 0;
const waiting = new Map();
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const complete = (threadId, text = 'Simulated protocol response') => {
  send({
    method: 'item/completed',
    params: { threadId, item: { id: 'item-1', type: 'agentMessage', phase: 'final_answer', text } },
  });
  send({
    method: 'turn/completed',
    params: { threadId, turn: { id: `turn-${threadId}`, status: 'completed' } },
  });
};
const profile = basename(process.env.CODEX_HOME);
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (!m.method) {
    const thread = waiting.get(m.id);
    if (thread) {
      waiting.delete(m.id);
      if (thread.kind === 'tool') {
        writeFileSync(join(process.env.CODEX_HOME, 'tool-result.json'), JSON.stringify(m.result));
        complete(
          thread.thread,
          m.result?.success ? 'Dynamic tool response acknowledged' : 'Dynamic tool response failed',
        );
      } else complete(thread, m.result.decision);
    }
    return;
  }
  const respond = (result) => send({ id: m.id, result });
  if (m.method === 'initialize') respond({ userAgent: 'remora-test-fixture' });
  else if (m.method === 'account/read')
    respond(
      profile === 'expired-login'
        ? { account: null }
        : { account: { type: 'chatgpt', email: `${profile}@example.invalid` } },
    );
  else if (m.method === 'account/rateLimits/read')
    respond(
      profile === 'exhausted-usage'
        ? {
            ordinaryUsageAllowed: false,
            rateLimits: {
              primary: {
                usedPercent: 100,
                windowDurationMins: 300,
                resetsAt: 2000000000,
              },
              rateLimitReachedType: 'primary',
            },
          }
        : profile === 'allowed-primary-full'
          ? {
              ordinaryUsageAllowed: true,
              rateLimits: {
                primary: {
                  usedPercent: 100,
                  windowDurationMins: 300,
                  resetsAt: 2000000000,
                },
                rateLimitReachedType: 'primary',
              },
              rateLimitsByLimitId: {
                codex: {
                  primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 2000000000 },
                  rateLimitReachedType: null,
                },
              },
            }
          : {
              rateLimits: {
                primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 2000000000 },
              },
            },
    );
  else if (m.method === 'account/login/start')
    respond({ authUrl: 'https://example.invalid/mock-login' });
  else if (m.method === 'account/logout') respond({});
  else if (m.method === 'model/list')
    respond({
      data: [
        {
          id: 'fixture-model-id',
          model: 'fixture-model',
          displayName: 'Fixture model',
          description: 'Test model',
          supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }],
          defaultReasoningEffort: 'medium',
          isDefault: true,
        },
      ],
      nextCursor: null,
    });
  else if (m.method === 'thread/start') {
    writeFileSync(join(process.env.CODEX_HOME, 'thread-start.json'), JSON.stringify(m.params));
    respond({ thread: { id: `thread-${++sequence}` } });
  } else if (m.method === 'turn/start') {
    const threadId = m.params.threadId;
    const text = m.params.input[0].text;
    if (text.includes('START_ERROR')) {
      send({ id: m.id, error: { message: 'Simulated uncertain turn start' } });
      setTimeout(() => complete(threadId), 1000);
      return;
    }
    respond({ turn: { id: `turn-${threadId}`, status: 'inProgress' } });
    if (
      text.includes('DYNAMIC_SEND') ||
      text.includes('DYNAMIC_READ') ||
      text.includes('DYNAMIC_DUPLICATE')
    ) {
      const tool =
        text.includes('DYNAMIC_SEND') || text.includes('DYNAMIC_DUPLICATE')
          ? 'remora_send_project_message'
          : 'remora_read_project_messages';
      const args =
        tool === 'remora_send_project_message'
          ? {
              recipients: ['two'],
              content: 'Fixture dynamic message',
              kind: 'update',
              idempotencyKey: 'fixture-dynamic-1',
            }
          : {};
      const callId = `dynamic-${text.includes('DYNAMIC_DUPLICATE') ? 'duplicate-' : ''}${sequence}`;
      const sendToolCall = (id) => {
        waiting.set(id, { kind: 'tool', thread: threadId });
        send({
          id,
          method: 'item/tool/call',
          params: {
            threadId,
            turnId: `turn-${threadId}`,
            callId,
            namespace: null,
            tool,
            arguments: args,
          },
        });
      };
      sendToolCall(7000 + sequence);
      if (text.includes('DYNAMIC_DUPLICATE')) sendToolCall(8000 + sequence);
    } else if (text.includes('DYNAMIC_BAD_ARGS')) {
      waiting.set(7000 + sequence, { kind: 'tool', thread: threadId });
      send({
        id: 7000 + sequence,
        method: 'item/tool/call',
        params: {
          threadId,
          turnId: `turn-${threadId}`,
          callId: `dynamic-bad-${sequence}`,
          namespace: null,
          tool: 'remora_send_project_message',
          arguments: { recipients: ['two'], content: 'bad', sender: 'spoofed' },
        },
      });
    } else if (text.includes('FILE_APPROVAL')) {
      waiting.set(1000 + sequence, threadId);
      send({
        id: 1000 + sequence,
        method: 'item/fileChange/requestApproval',
        params: {
          threadId,
          availableDecisions: ['accept', 'acceptForSession', 'decline'],
        },
      });
    } else if (text.includes('APPROVAL')) {
      waiting.set(1000 + sequence, threadId);
      send({
        id: 1000 + sequence,
        method: 'item/commandExecution/requestApproval',
        params: {
          threadId,
          command: 'node --version',
          availableDecisions: ['accept', 'acceptForSession', 'decline'],
        },
      });
    } else if (!text.includes('HANG')) setTimeout(() => complete(threadId), 40);
  } else if (m.method === 'turn/interrupt') {
    respond({});
    setTimeout(
      () =>
        send({
          method: 'turn/completed',
          params: { threadId: m.params.threadId, turn: { status: 'interrupted' } },
        }),
      500,
    );
  } else if (m.method === 'thread/read')
    respond({
      thread: {
        turns: [
          {
            id: `turn-${m.params.threadId}`,
            status: 'completed',
            items: [{ type: 'agentMessage', text: 'Recovered result' }],
          },
        ],
      },
    });
});
