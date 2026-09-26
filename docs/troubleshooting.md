# Troubleshooting

If startup says that Node.js is unsupported, install or select Node.js `>=24.15.0 <25`. Remora does not install or update Node.js. Check the active version with `node --version` and run `npm run setup` after selecting the supported version.

If dependencies are missing, run `npm run setup` from the repository root. It uses the committed `package-lock.json`. A network or npm failure is reported directly; no credentials are required. Then run `npm start` again.

If startup says that port `7437` is already in use, choose another port with `npm start -- --port 7440`. Remora does not stop or inspect an unrelated application. If the existing process is the Remora service for the same home, use `npm run remora -- status` and `npm run remora -- stop` from a second terminal.

If the dashboard URL no longer works, check the foreground terminal and run `npm run remora -- status`. The URL includes a short-lived local access token; keep it private and use the URL printed by the currently running service.

If a service terminal was closed abruptly, start Remora again with the same home. A stale lock is removed only when its recorded process is no longer running. A live lock is treated as owned and is never killed automatically.
