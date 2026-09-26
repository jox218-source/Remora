import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import type {
  Account,
  Provider,
  RunRequest,
  SessionRef,
  ProjectMessageRequest,
  ProviderMessageResult,
} from '../types.js';

/** Deterministic offline fixture. Never calls a model or impersonates real account usage. */
export class DemoProvider implements Provider {
  readonly capabilities = {
    version: 1 as const,
    sessions: true,
    usage: false,
    approvals: false,
    projectMessaging: true,
  };
  async status(_account: Account) {
    return {
      status: 'demo',
      identity: 'Offline simulation',
      checkedAt: new Date().toISOString(),
      usage: null,
    };
  }
  async login(account: Account) {
    return this.status(account);
  }
  async logout(_account: Account) {}
  async reconcile(_ref: SessionRef) {
    return { status: 'unknown' };
  }
  async sendProjectMessage(request: ProjectMessageRequest): Promise<ProviderMessageResult> {
    // This is a deterministic fixture for offline QA; it never starts a model turn.
    if (request.message.kind === 'question')
      return {
        delivered: true,
        answer: {
          kind: 'answer',
          content: `Offline demo reply from ${request.recipient}; no model call was made.`,
        },
      };
    return { delivered: true };
  }
  async close() {}
  async run(run: RunRequest) {
    run.onSession({
      account: run.account.id,
      threadId: `demo-${run.taskId ?? 'plan'}`,
      turnId: String(Date.now()),
    });
    run.onEvent('Offline demo started (no model calls)');
    await setTimeout(500, undefined, { signal: run.signal });
    if (run.schema?.properties && 'tasks' in (run.schema.properties as object)) {
      const accounts = JSON.parse(
        run.prompt.match(/ELIGIBLE_ACCOUNTS=(\[[^\n]+\])/)?.[1] ?? '["demo-one","demo-two"]',
      );
      return JSON.stringify({
        summary:
          'Offline demo: produce two independent notes and a combined report, with lead review after each task.',
        tasks: [
          {
            id: 'research',
            title: 'Research notes',
            instruction: 'Create a short research note, clearly labeled as simulated.',
            account: accounts[0],
            dependencies: [],
            acceptance: ['Output clearly states it is simulated.'],
          },
          {
            id: 'outline',
            title: 'Report outline',
            instruction: 'Create an outline for a useful project report.',
            account: accounts[1] ?? accounts[0],
            dependencies: [],
            acceptance: ['Outline is readable and clearly labeled as simulated.'],
          },
          {
            id: 'report',
            title: 'Assemble report',
            instruction: 'Combine the accepted research and outline into a short report.',
            account: accounts[0],
            dependencies: ['research', 'outline'],
            acceptance: ['Report includes an explicit simulation notice.'],
          },
        ],
      });
    }
    if (run.readOnly)
      return JSON.stringify({
        approved: true,
        feedback:
          'Offline demo review: the simulated deliverable is present. A real lead would evaluate the acceptance criteria and evidence.',
      });
    const id = run.taskId ?? 'output';
    mkdirSync(join(run.cwd, 'deliverables'), { recursive: true });
    writeFileSync(
      join(run.cwd, 'deliverables', `${id}.md`),
      `# ${id === 'report' ? 'Remora demonstration report' : id}\n\nThis is a simulated offline deliverable, not AI-generated research.\n\nCreated by ${run.account.id} in an isolated task workspace.\n\n${id === 'report' ? 'The accepted research and outline are included alongside this report.\n' : 'Remora coordinates tasks, preserves dependencies, and routes outputs through a lead reviewer.\n'}`,
    );
    return `Created deliverables/${id}.md (offline simulation).`;
  }
}
