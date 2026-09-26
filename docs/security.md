# Security model

The service is bound to localhost. The dashboard token is a local secret; do not paste it into issues or logs. The local SQLite home, provider profile references, logs, worktrees, and non-Git snapshots may contain private prompts and results. Local API data is plaintext and protected by the user's filesystem permissions.

Credentials remain in the installed Codex app. Use dedicated profiles and least privilege. Remora does not bill accounts or bypass provider limits. One turn per account and four turns globally are intended safeguards, with two revisions. Plans use the same selected account for lead and review.

Do not report security issues in public issues. Use GitHub private vulnerability reporting if enabled for this repository. If it is unavailable, open a public issue containing only a request for a private reporting channel; do not publish vulnerability details. Do not include credentials, account exports, tokens, or private task data in a report.

Git worktrees and non-Git snapshots isolate task changes. Before results are accepted, Remora checks for conflicts and requires explicit acceptance. Sensitive filename filtering excludes common credential names, but it is not full data-loss prevention; artifacts may still contain secrets. Verify the staged diff and destination before accepting. This is not a security boundary against a compromised provider app or host.
