# Getting started

Install Node.js `>=24.15.0 <25` on Windows or Linux, then run:

```bash
npm ci
npm run build
npm run remora -- up
```

The service stays in the foreground and prints a local dashboard URL and token. Open that URL or use the CLI from another terminal. For a credential-free smoke workflow, run `npm run remora -- demo`, capture its project ID, then run `plan --goal`, `approve`, and `run`; every demo response is labeled `simulated`.

Real accounts require the installed Codex CLI/app-server. Add aliases with `accounts add --provider codex`, then use `accounts login` for each alias; credentials remain managed by Codex. Before spending a model turn, verify both aliases with the read-only readiness check:

```bash
npm run test:live -- --accounts first,second --readiness
```

When it reports two connected Codex profiles, the opt-in pilot creates two isolated local worker tasks. Run it only when you intend to use provider quota:

```bash
npm run test:live -- --accounts first,second --confirm-usage
```

The service must already be running. Review the pilot in the dashboard; it does not accept or merge artifacts automatically. Initial real-account isolation on Windows and Linux remains unverified until this opt-in validation is completed.
