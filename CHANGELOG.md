# Changelog

The `0.1.0-alpha.1` entry is the first source alpha. It remains source-only, with npm packages private.

## 0.1.0-alpha.1

- Initial pre-alpha local service, dashboard, CLI, SQLite store, Codex adapter, demo workflow, isolation model, approval flow, and result acceptance.
- Added credential-free CI and repository documentation.
- Added foreground `npm start` setup/build/startup, Windows and Linux launch wrappers, authenticated same-home stop, and lifecycle troubleshooting guidance.
- Windows two-alias authenticated pilot passed with normal approvals. Ubuntu CI passed 36 tests; Windows passed 34 with two platform-specific skips. Linux live isolation, quota exhaustion, and logout/refresh isolation remain untested.
- Added the source archive install path and a credential-free offline demo walkthrough covering plan review, approval, simulated execution, previews, diffs, and explicit result acceptance. Release preflight and screenshot privacy guidance are in [docs/release.md](docs/release.md).
