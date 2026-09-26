# Remora v0.1.0-alpha.1 source alpha

Remora `v0.1.0-alpha.1` is a source-only alpha for local orchestration. The workspace and its npm packages remain private.

## Source archive installation

The supported distribution path for this alpha is the repository source archive or a clone. Once the `v0.1.0-alpha.1` tag is available, the pinned source archive is [`https://github.com/jox218-source/Remora/archive/refs/tags/v0.1.0-alpha.1.zip`](https://github.com/jox218-source/Remora/archive/refs/tags/v0.1.0-alpha.1.zip). A reproducible clone is:

```bash
git clone https://github.com/jox218-source/Remora.git
cd Remora
git checkout v0.1.0-alpha.1
```

Use the matching repository snapshot when the tag is not available yet. After extracting or cloning the alpha, use Node.js `>=24.15.0 <25` and run:

```bash
npm ci
npm run check
npm start
```

`npm start` builds the service and dashboard, then keeps the service in the foreground. It prints a loopback dashboard URL and a per-service-run local access token. Keep that URL private; it remains valid while that service process is running. Use `Ctrl+C` to stop the service. See [getting started](getting-started.md) for the Windows and Linux launch wrappers and the `--home` and `--port` options.

Remora's npm workspace packages are private for this alpha. Do not run `npm publish`; registry distribution is a separate packaging change that still needs its own validation.

## Credential-free walkthrough

Run the demo with a disposable home and an unused loopback port. For example, on Windows:

```powershell
$demoHome = Join-Path $env:TEMP 'remora-alpha-demo'
npm start -- --home $demoHome --port 7558
```

On Linux, use a disposable directory such as `$(mktemp -d)` and choose an unused port. Open the URL printed by the service, then:

1. Select **Try a demo project**. Remora creates the local `demo-one` and `demo-two` profiles without credentials.
2. Enter a neutral goal such as `Create a short release checklist for a local offline demo`, then select **Create plan**.
3. Review the draft. The demo produces three inspectable tasks, keeps network access off, and labels provider identities as unknown. Select **Approve plan**.
4. Select **Run project**. Wait for the project to reach `Ready`, then review the task statuses and the staged result count.
5. Open **Results**. Expand **Preview file** for the brief, and expand **View diff** for an added deliverable. The content is simulated and is marked as such.
6. Select **Accept results**, review the confirmation naming the disposable project, and accept it. The project should reach `Accepted`.
7. Stop the foreground service with `Ctrl+C`. Remove the disposable home after review if it is no longer needed.

The walkthrough exercises plan review, approval, task isolation, staged artifacts, text and diff previews, conflict checks, and explicit result acceptance. It does not use the Codex provider or consume model quota.

## Screenshot handling

Release QA should capture only clean offline-demo views: the empty overview, the inspectable plan, and the results preview or diff. Do not retain dashboard URLs containing access tokens, account profiles, user names, private project paths, SQLite files, logs, or real-account screens. The Windows browser QA capture used the supported CUA browser surface and emitted these views inline; the capture surface did not provide a persistent image export, so no screenshot files are committed by this candidate.

## Maintainer preflight

Maintainers should complete the following from a clean checkout before distributing or revising this alpha:

```bash
npm ci
npm run check
npm audit
npm run test:protocol
```

The protocol smoke must use the installed Codex CLI with fresh signed-out profiles and report zero model calls. It is a handshake check only. Authenticated validation remains opt-in and requires two already connected aliases with explicit usage confirmation. The Windows two-alias pilot and Windows/Ubuntu CI evidence are recorded in [validation](validation.md). Linux authenticated isolation, quota exhaustion, and logout/refresh isolation remain open gates for broader or stable authenticated-support claims; they are outside the scope of this expressly limited source alpha. Frequent provider approvals and the Windows provider's sandbox-only limitation remain documented operational limits.

Review the final diff for credentials, access tokens, account exports, profiles, SQLite databases, runtime homes, build output, and task workspaces before accepting the release result. Tagging and GitHub release creation require maintainer approval after this checklist passes.
