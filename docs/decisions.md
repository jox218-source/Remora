# Decisions

## Local service first

The first milestone keeps orchestration local with SQLite, a CLI, and a dashboard. This limits network exposure and makes task artifacts inspectable.

## Installed provider application

The Codex adapter coordinates the installed, unmodified Codex app-server and leaves credentials under Codex management. This avoids inventing a parallel credential store or provider bypass.

## Bounded review loop

The selected lead account reviews worker output; the user approves the plan. Work is limited to one turn per account, four turns globally, and two revision rounds per task so a plan cannot expand without bound.

## Explicit acceptance

Task changes are isolated in a Git worktree or non-Git snapshot, checked for conflicts, staged for inspection, and accepted explicitly. This makes the final write a visible user decision.
