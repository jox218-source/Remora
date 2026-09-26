# Validation

The current Windows local suite passes 34 tests, with two platform-specific skips (36 total). The suite is credential-free and covers planning, task isolation, revisions, approvals, pause/cancel/recovery, API protections, provider behavior, model and team lifecycle changes, and workspace safety. Run it with:

```bash
npm test
```

The protocol smoke test also passed with the installed `codex-cli 0.154.0-alpha.6.2`, using two fresh blank profiles that were signed out and had `modelCalls: 0`:

```bash
npm run test:protocol
```

The [Windows and Ubuntu CI run](https://github.com/jox218-source/Remora/actions/runs/35460025772) passed on the validated head: Ubuntu passed all 36 tests; Windows passed 34 with two platform-specific skips. The full check includes type checking, lint, formatting, production builds, and Markdown links. Browser QA exercised demo creation, planning, approval, parallel workers, review, text/diff previews, and acceptance into its original test directory.

This does not constitute general authenticated multi-account or live billing validation. The opt-in Windows pilot demonstrated isolation for its two connected aliases; Linux live isolation, quota exhaustion, and logout/refresh isolation with real accounts remain gates for broader or stable authenticated-support claims. Those checks are outside the scope of the expressly limited source alpha.

Before using any model turns, verify the two aliases and their connection state with the read-only readiness check. It refreshes provider account metadata, does not create a project, and does not print provider identities or credentials:

```bash
npm run test:live -- --accounts first,second --readiness
```

Once readiness reports two connected Codex profiles, run the small two-worker pilot with explicit usage confirmation:

```bash
npm run test:live -- --accounts first,second --confirm-usage
```

The service must already be running. The smoke test does not log out, merge, or accept artifacts automatically. Inspect its results in the dashboard. If the command is interrupted with Ctrl+C or a termination signal, it requests cancellation and leaves the task workspaces available for inspection.

Provider command and file-change prompts are shown in plain language with the requested command, working path, and any requested permission root. `Allow once` approves only the current request; `Allow for this task` uses the installed app-server's `acceptForSession` decision and applies only to the current provider task session. Remora does not auto-approve requests; inspect any requested path or additional permission before allowing it.

For a bounded run that must remain inside its assigned workspace, initialize it with `--sandbox-only` (or choose Sandbox only in the dashboard). This keeps the configured filesystem and network sandbox and rejects requests that would need escalation; the default mode continues to ask for provider approval.

The opt-in live validation on September 19, 2026 used two connected aliases and a disposable three-task project. The workers for `analysis-0` and `analysis-1` started concurrently under `business` and `personal-codex`, and `combined-report` then ran under the business lead and reviewer. Provider identity evidence was recorded for both aliases, the project reached `ready`, and no output was accepted. The sandbox-only attempt stopped safely because the installed Windows provider rejected its shell and file-write requests under `approval_policy=never`, even inside the assigned workspace; it produced no task files and no pending approvals. A follow-up run with the normal on-request policy completed all three tasks after exact disposable-workspace approvals. The provider advertised `accept`, `acceptWithExecpolicyAmendment`, and `cancel` for those requests, but did not advertise `acceptForSession`, so the run did not claim or apply a session-wide approval. These results document the installed provider behavior; they do not promise that sandbox-only mode can complete every provider operation without a prompt.

## Workspace boundaries

Git mode requires the project root itself to be the Git root. A subfolder is treated as a non-Git project and uses a snapshot. Snapshots exclude common sensitive filenames, but this is filename filtering rather than full data-loss prevention; inspect artifacts before sharing them. Symlinks and unsupported mode changes are rejected, while regular file content changes are supported.

## Account recovery

An unconfirmed provider shutdown quarantines its account and blocks dispatch. Neither `refresh` nor `logout` clears quarantine. Stop the indicated provider process tree in the operating system, then run `accounts recover <alias> --confirm-stopped` to clear quarantine and refresh its status. This command records your confirmation; it does not independently prove that the old processes stopped.
