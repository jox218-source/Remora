# Validation

The current Windows local suite passes 24 tests, with two platform-specific skips (26 total). The suite is credential-free and covers planning, task isolation, revisions, approvals, pause/cancel/recovery, API protections, provider behavior, and workspace safety. Run it with:

```bash
npm test
```

The protocol smoke test also passed with the installed `codex-cli 0.154.0-alpha.6.2`, using two fresh blank profiles that were signed out and had `modelCalls: 0`:

```bash
npm run test:protocol
```

The [Windows and Ubuntu CI run](https://github.com/jox218-source/Remora/actions/runs/35454019012) passed on commit `f40e1ff`: Ubuntu passed all 26 tests; Windows passed 24 with two platform-specific skips. The full check includes type checking, lint, formatting, production builds, and Markdown links. Browser QA exercised demo creation, planning, approval, parallel workers, review, text/diff previews, and acceptance into its original test directory.

This does not constitute authenticated multi-account or live billing validation. Real-account isolation on Windows and Linux is unverified until opt-in live validation; quota exhaustion and logout/refresh isolation with real accounts remain release gates.

For live validation, use two already connected aliases and explicitly confirm usage:

```bash
npm run test:live -- --accounts first,second --confirm-usage
```

The service must already be running. The smoke test does not log out, merge, or accept artifacts automatically. Inspect its results in the dashboard.

## Workspace boundaries

Git mode requires the project root itself to be the Git root. A subfolder is treated as a non-Git project and uses a snapshot. Snapshots exclude common sensitive filenames, but this is filename filtering rather than full data-loss prevention; inspect artifacts before sharing them. Symlinks and unsupported mode changes are rejected, while regular file content changes are supported.

## Account recovery

An unconfirmed provider shutdown quarantines its account and blocks dispatch. Neither `refresh` nor `logout` clears quarantine. Stop the indicated provider process tree in the operating system, then run `accounts recover <alias> --confirm-stopped` to clear quarantine and refresh its status. This command records your confirmation; it does not independently prove that the old processes stopped.
