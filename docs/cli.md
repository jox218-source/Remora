# CLI

The intended entry point is `npm run remora -- <command>`. Global options are `--json` and `--home PATH`. The `up` command accepts `--port PORT` (default `7437`). `npm start` is the convenient foreground bootstrap; it checks prerequisites, sets up missing dependencies, builds, and then runs `up`.

```text
up
stop
demo
accounts add <alias> [--provider codex|demo] [--model model]
accounts login <alias>
accounts list
accounts refresh|logout|remove <alias>
init [path] --name NAME --lead ACCOUNT --workers comma,list [--network] [--sandbox-only] [--concurrency 4]
plan <projectId> --goal TEXT [--file plan.json]
approve <projectId>
run <projectId>
status [projectId]
messages <projectId> [--after MESSAGE_ID]
message <projectId> --to ACCOUNT[,ACCOUNT] --text TEXT [--kind update|question|answer|blocker] [--reply-to MESSAGE_ID] [--idempotency-key KEY]
logs [projectId] --follow
pause|resume|cancel <projectId>
retry <projectId> --task TASK
permission <approvalId> --decision accept|decline
results <projectId> [--accept]
doctor
```

`up` stays in the foreground; press `Ctrl+C` to stop it. `stop` uses the runtime token and service lock for the selected home to request a graceful shutdown. It does not terminate a process that merely happens to use the same port. `status` reports `{ "status": "stopped" }` when no service is running.

The plan lead and reviewer are one account. Each account has one active turn, the global cap is four, and a project may configure up to 16 concurrent turns; the effective cap is the lower value. Plans allow two revisions. Pausing stops new dispatch while active work may finish. `results --accept` is the explicit acceptance point after conflict checks. `permission` accepts or declines one provider request.

Projects use provider approval prompts by default. `--sandbox-only` selects a fail-closed mode for a new project: provider turns keep the task workspace sandbox and network setting, while commands that require approval or access outside that sandbox are rejected instead of escalated. It does not grant full-disk access.

`messages` reads durable project conversation history, including per-recipient delivery state. `message` creates a bounded user message. The Codex adapter delivers only after an active-turn steer is acknowledged; idle recipients remain queued with an explanation until a later active checkpoint. Retry the same post with `--idempotency-key` to avoid duplicate messages.
