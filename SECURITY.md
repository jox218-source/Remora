# Security

Use [GitHub private vulnerability reporting](https://github.com/jox218-source/Remora/security/advisories/new) when enabled for this repository. If it is unavailable, open a public issue containing only a request for a private reporting channel; do not publish vulnerability details. No separate private contact address is advertised. Never include credentials, account exports, tokens, or private task data in a report.

Remora is pre-alpha and has not received live multi-account validation. Treat the local dashboard token, SQLite home, task snapshots, logs, and provider profiles as sensitive. Keep the service bound to localhost, use dedicated provider profiles, review staged results before acceptance, and remove test snapshots when finished.

Remora does not bypass provider limits and does not bill accounts. Provider credentials remain managed by the installed Codex app. See [docs/security.md](docs/security.md) for the threat model and operating guidance.
