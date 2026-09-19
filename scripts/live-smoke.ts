/** Explicit, metered integration check against accounts already connected to a running Remora. */
import { parseArgs } from 'node:util';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { setTimeout } from 'node:timers/promises';
const { values } = parseArgs({
  options: {
    accounts: { type: 'string' },
    'confirm-usage': { type: 'boolean' },
    home: { type: 'string' },
  },
});
if (!values['confirm-usage'] || !values.accounts || values.accounts.split(',').length !== 2)
  throw new Error(
    'Explicitly opt in: npm run test:live -- --accounts first,second --confirm-usage',
  );
const accounts = values.accounts.split(',').map((id) => id.trim());
if (accounts[0] === accounts[1]) throw new Error('Choose two distinct account profiles');
const home = values.home ?? process.env.REMORA_HOME ?? join(homedir(), '.remora');
const runtime = JSON.parse(readFileSync(join(home, 'runtime.json'), 'utf8'));
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
const root = mkdtempSync(join(tmpdir(), 'remora-live-'));
writeFileSync(
  join(root, 'BRIEF.md'),
  'Live multi-account integration test; write only requested local files.',
);
const project = await api('/projects', {
  root,
  name: 'Live isolation smoke test',
  lead: accounts[0],
  workers: accounts,
});
await api(`/projects/${project.id}/plan`, {
  goal: 'Verify two accounts can independently write local artifacts and review them.',
  plan: {
    summary: 'Two independent local artifact tasks',
    tasks: accounts.map((account, i) => ({
      id: `worker-${i}`,
      title: `Worker ${i}`,
      instruction: `Create worker-${i}.txt containing exactly Remora live test ${i}. Do not run network commands.`,
      account,
      dependencies: [],
      acceptance: [`worker-${i}.txt exists and contains exactly Remora live test ${i}.`],
    })),
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
    process.exit(0);
  }
  if (['blocked', 'cancelled'].includes(current.state))
    throw new Error(`Live validation ${current.state}: ${current.error ?? 'inspect dashboard'}`);
  await setTimeout(2000);
}
await api(`/projects/${project.id}/cancel`, {});
throw new Error('Live validation timed out; run cancelled and workspaces retained');
