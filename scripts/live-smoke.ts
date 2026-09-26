/** Explicit, metered integration check against accounts already connected to a running Remora. */
import { parseArgs } from 'node:util';
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { setTimeout } from 'node:timers/promises';
const { values } = parseArgs({
  options: {
    accounts: { type: 'string' },
    'confirm-usage': { type: 'boolean' },
    readiness: { type: 'boolean' },
    home: { type: 'string' },
    'sandbox-only': { type: 'boolean' },
  },
});
if (!values.accounts || values.accounts.split(',').length !== 2)
  throw new Error(
    'Choose exactly two aliases: npm run test:live -- --accounts first,second --readiness',
  );
const accounts = values.accounts.split(',').map((id) => id.trim());
if (accounts.some((id) => !/^[a-z0-9][a-z0-9_-]*$/.test(id)))
  throw new Error('Account aliases must be lowercase letters, numbers, hyphens, or underscores');
if (!accounts[0] || !accounts[1] || accounts[0] === accounts[1])
  throw new Error('Choose two distinct, non-empty account profiles');
if (!values.readiness && !values['confirm-usage'])
  throw new Error(
    'Explicitly opt in for the metered run: npm run test:live -- --accounts first,second --confirm-usage',
  );
const home = values.home ?? process.env.REMORA_HOME ?? join(homedir(), '.remora');
const runtimePath = join(home, 'runtime.json');
if (!existsSync(runtimePath)) throw new Error(`Remora is not running: missing ${runtimePath}`);
let runtime: { port: number; token: string };
try {
  runtime = JSON.parse(readFileSync(runtimePath, 'utf8')) as typeof runtime;
} catch {
  throw new Error(`Unable to read ${runtimePath}; start Remora and retry`);
}
if (
  !Number.isInteger(runtime.port) ||
  runtime.port < 1024 ||
  runtime.port > 65535 ||
  !runtime.token
)
  throw new Error(`Invalid runtime metadata in ${runtimePath}; restart Remora and retry`);
async function api(path: string, body?: unknown): Promise<any> {
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json()) as any;
  if (!response.ok) throw new Error(result.error);
  return result;
}
const connected = await Promise.all(accounts.map((id) => api(`/accounts/${id}/refresh`, {})));
if (
  connected.some((a) => a.provider !== 'codex' || a.status !== 'connected') ||
  connected[0].identity === connected[1].identity
)
  throw new Error('Two connected Codex profiles with distinct identities are required');
if (values.readiness) {
  console.log(
    JSON.stringify(
      {
        status: 'ready',
        accounts: connected.map((account) => ({
          id: account.id,
          provider: account.provider,
          status: account.status,
        })),
        next: 'Run again with --confirm-usage to create the two-worker live project.',
      },
      null,
      2,
    ),
  );
}
if (!values.readiness) {
  const root = mkdtempSync(join(tmpdir(), 'remora-live-'));
  writeFileSync(
    join(root, 'BRIEF.md'),
    'Live multi-account integration test; write only requested local files.',
  );
  const project = await api('/projects', {
    root,
    name: 'Live two-account bounded pilot',
    lead: accounts[0],
    workers: accounts,
    approvalPolicy: values['sandbox-only'] ? 'never' : 'on-request',
  });
  await api(`/projects/${project.id}/plan`, {
    goal: 'Verify two accounts can independently write local analyses, then have the lead combine them into one reviewed report.',
    plan: {
      summary: 'Two independent analyses and one dependent combined report',
      tasks: [
        {
          id: 'analysis-0',
          title: 'Independent analysis 0',
          instruction:
            'Create analysis-0.txt with a short, self-contained analysis of the supplied brief. Label it as a live Remora pilot artifact. Do not run network commands.',
          account: accounts[0],
          dependencies: [],
          acceptance: ['analysis-0.txt exists and contains a labeled analysis of the brief.'],
        },
        {
          id: 'analysis-1',
          title: 'Independent analysis 1',
          instruction:
            'Create analysis-1.txt with a separate short, self-contained analysis of the supplied brief. Label it as a live Remora pilot artifact. Do not run network commands.',
          account: accounts[1],
          dependencies: [],
          acceptance: ['analysis-1.txt exists and contains a labeled analysis of the brief.'],
        },
        {
          id: 'combined-report',
          title: 'Combined report',
          instruction:
            'Read the accepted analysis-0.txt and analysis-1.txt dependency outputs, then create combined-report.txt that combines their useful points. Label it as a live Remora pilot artifact and do not modify either source analysis.',
          account: accounts[0],
          dependencies: ['analysis-0', 'analysis-1'],
          acceptance: [
            'combined-report.txt exists, is labeled, and reflects both dependency analyses.',
          ],
        },
      ],
    },
  });
  await api(`/projects/${project.id}/approve`, {});
  await api(`/projects/${project.id}/run`, {});
  console.log(
    JSON.stringify({
      projectId: project.id,
      root,
      status: 'running',
      note: 'Open the dashboard for any permission requests. No logout or acceptance is performed.',
    }),
  );
  const deadline = Date.now() + 15 * 60 * 1000;
  let finished = false;
  const stop = async () => {
    if (finished) return;
    try {
      await api(`/projects/${project.id}/cancel`, {});
    } catch {
      // The service may already have stopped; preserve the original interruption.
    }
  };
  process.once('SIGINT', () => {
    void stop().finally(() => process.exit(130));
  });
  process.once('SIGTERM', () => {
    void stop().finally(() => process.exit(143));
  });
  while (Date.now() < deadline) {
    const state = await api('/state'),
      current = state.projects.find((p: any) => p.id === project.id);
    if (current.state === 'ready') {
      console.log(
        JSON.stringify(
          {
            status: 'passed',
            projectId: project.id,
            results: await api(`/projects/${project.id}/results`),
          },
          null,
          2,
        ),
      );
      finished = true;
      process.exit(0);
    }
    if (['blocked', 'cancelled'].includes(current.state))
      throw new Error(`Live validation ${current.state}: ${current.error ?? 'inspect dashboard'}`);
    await setTimeout(2000);
  }
  await api(`/projects/${project.id}/cancel`, {});
  finished = true;
  throw new Error('Live validation timed out; run cancelled and workspaces retained');
}
