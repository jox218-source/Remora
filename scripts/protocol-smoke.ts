/** Installed Codex handshake only: isolated empty profiles, no login or model turns. */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexProvider } from '../packages/remora/src/providers/codex.js';
const home = mkdtempSync(join(tmpdir(), 'remora-codex-protocol-'));
const provider = new CodexProvider(
  home,
  async () => 'decline',
  () => {},
);
try {
  const statuses = await Promise.all(
    ['protocol-one', 'protocol-two'].map((id) =>
      provider.status({ id, provider: 'codex', status: 'signed-out' }),
    ),
  );
  if (statuses.some((s) => s.status !== 'signed-out'))
    throw new Error('Isolated blank profiles unexpectedly inherited authentication');
  console.log(
    JSON.stringify(
      {
        status: 'passed',
        profiles: 2,
        authentication: 'signed-out',
        modelCalls: 0,
        note: 'Handshake validation only; real multi-account isolation still requires opt-in live validation.',
      },
      null,
      2,
    ),
  );
} finally {
  await provider.close();
  rmSync(home, { recursive: true, force: true });
}
