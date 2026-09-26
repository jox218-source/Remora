# Getting started

Install Node.js `>=24.15.0 <25` and npm on Windows or Linux, clone the repository, and run:

```bash
npm start
```

`npm start` checks the Node.js version, runs `npm ci` from the lockfile when dependencies are missing, builds the dashboard and service, then starts Remora in the foreground. It prints a loopback dashboard URL and local access token. Press `Ctrl+C` to stop it. Use `npm start -- --port 7440` or `npm start -- --home PATH` to select a different port or state home.

Windows users can double-click `scripts/start-remora.cmd`. Linux users can run `./scripts/start-remora.sh`. These wrappers stay in the foreground. Run `npm run setup` if you want to install the locked dependencies before starting. The setup does not install Node.js, npm, or global tools.

In a second terminal, run `npm run remora -- status` to inspect the service. `npm run remora -- stop` requests a graceful stop for the same home. If `status` reports `stopped`, start the foreground terminal again. If startup reports that port `7437` is busy, choose another port; Remora does not stop the process using it.

For a credential-free smoke workflow, run `npm run remora -- demo`, capture its project ID, then run `plan --goal`, `approve`, and `run`; every demo response is labeled `simulated`.

Real accounts require the installed Codex CLI/app-server. Add aliases with `accounts add --provider codex`, then use `accounts login` for each alias; credentials remain managed by Codex. Before spending a model turn, verify both aliases with the read-only readiness check:

```bash
npm run test:live -- --accounts first,second --readiness
```

When it reports two connected Codex profiles, the opt-in pilot creates two isolated local worker tasks. Run it only when you intend to use provider quota:

```bash
npm run test:live -- --accounts first,second --confirm-usage
```

The service must already be running. Review the pilot in the dashboard; it does not accept or merge artifacts automatically. The Windows pilot passed with two connected aliases under normal provider approvals. Linux live isolation, quota exhaustion, and logout/refresh isolation remain release gates; see [validation](validation.md).
