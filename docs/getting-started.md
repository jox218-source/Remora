# Getting started

Install Node.js `>=24.15.0 <25` on Windows or Linux, then run:

```bash
npm ci
npm run build
npm run remora -- up
```

The service stays in the foreground and prints a local dashboard URL and token. Open that URL or use the CLI from another terminal. For a credential-free smoke workflow, run `npm run remora -- demo`, capture its project ID, then run `plan --goal`, `approve`, and `run`; every demo response is labeled `simulated`.

Real accounts require the installed Codex CLI/app-server. Add aliases with `accounts add --provider codex`, then use `accounts login` for each alias; credentials remain managed by Codex. Initial real-account isolation on Windows and Linux remains unverified until opt-in live validation.
