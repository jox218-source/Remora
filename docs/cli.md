# CLI

The intended entry point is `npm run remora -- <command>`. Global options are `--json`, `--home PATH`, and `--port PORT` (for `up`; default port `7437`).

```text
up
demo
accounts add <alias> [--provider codex|demo] [--model model]
accounts login <alias>
accounts list
accounts refresh|logout|remove <alias>
init [path] --name NAME --lead ACCOUNT --workers comma,list [--network] [--concurrency 4]
plan <projectId> --goal TEXT [--file plan.json]
approve <projectId>
run <projectId>
status [projectId]
logs [projectId] --follow
pause|resume|cancel <projectId>
retry <projectId> --task TASK
permission <approvalId> --decision accept|decline
results <projectId> [--accept]
doctor
```

The plan lead and reviewer are one account. Each account has one active turn, the global cap is four, and a project may configure up to 16 concurrent turns; the effective cap is the lower value. Plans allow two revisions. Pausing stops new dispatch while active work may finish. `results --accept` is the explicit acceptance point after conflict checks. `permission` accepts or declines one provider request.
