# Remora

Remora is a local, pre-alpha coordinator for work split across multiple ChatGPT accounts. It runs as a TypeScript service with SQLite storage, a React dashboard, and a CLI. Its Codex provider adapter uses the installed, unmodified Codex app-server; Remora does not replace the Codex app, manage provider credentials itself, bypass provider limits, or send work to remote nodes.

The repository is pre-alpha. Authenticated multi-account live validation has not yet been performed. Claude, Grok, native subagents, and remote-node adapters are unsupported future work.

## Requirements

- Node.js `>=24.15.0 <25`
- npm
- Windows or Linux
- Git for Git-backed projects
- The installed Codex CLI for real accounts; the offline demo does not require Codex

## Quick start

```bash
git clone https://github.com/jox218-source/Remora.git
cd Remora
npm ci
npm run build
npm run remora -- up
```

`up` runs the local service in the foreground, prints a local dashboard URL, and issues a local access token. The default port is `7437`; use `--port` and `--home` to override it. The CLI and dashboard use the same service API.

In a second terminal, create the credential-free demo project:

```bash
npm run remora -- demo
```

Then plan, approve, and run it:

```bash
npm run remora -- plan PROJECT_ID --goal "Create a short report"
npm run remora -- approve PROJECT_ID
npm run remora -- run PROJECT_ID
```

Demo agent responses are labeled `simulated` and never use credentials. Use `status`, `logs`, `results`, and `results PROJECT_ID --accept` to inspect and accept the staged result.

For real profiles, register and authenticate aliases after the service is running:

```bash
npm run remora -- accounts add lead --provider codex
npm run remora -- accounts add worker --provider codex
npm run remora -- accounts login lead
npm run remora -- accounts login worker
```

The provider login flow and its credentials remain managed by Codex. See [docs/getting-started.md](docs/getting-started.md) before using real accounts.

## CLI shape

The command surface is documented in [docs/cli.md](docs/cli.md). It includes account setup, project initialization, plan approval, task execution, logs, retries, result acceptance, and diagnostics. The plan lead and reviewer are the same selected account. The global cap is four active turns; a project may request up to 16 concurrent turns, with the effective limit being the lower of the project setting and global cap. Each account has one active turn, and plans allow up to two revisions.

## Safety model

Remora isolates tasks in Git worktrees or non-Git snapshots, checks for conflicts before staged results are accepted, and requires explicit result acceptance. No account is billed by Remora; provider quotas and usage policies remain in force. Read [docs/security.md](docs/security.md) before connecting real profiles.

## Contributing and support

Start with [CONTRIBUTING.md](CONTRIBUTING.md), [docs/getting-started.md](docs/getting-started.md), and [docs/architecture.md](docs/architecture.md). Security issues belong in [SECURITY.md](SECURITY.md); general help is covered by [SUPPORT.md](SUPPORT.md).

Remora is licensed under the [Apache License 2.0](LICENSE).

Validation evidence and the remaining platform limitations are recorded in [docs/validation.md](docs/validation.md).
