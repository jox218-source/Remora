# Architecture

Remora has one local TypeScript service, SQLite state under the Remora home, a React dashboard, and a CLI that calls the same local API. The default home is `~/.remora`; `--home` selects another location. The default service port is `7437`.

```mermaid
flowchart LR
  CLI[CLI] --> API[Local service API]
  UI[React dashboard] --> API
  API --> DB[(SQLite)]
  API --> ENG[Task engine]
  ENG --> ISO[Git worktree or snapshot]
  ENG --> CODEX[Installed Codex app-server]
  ENG --> MSG[Project message store]
  MSG --> DEMO[Offline demo message adapter]
```

The provider boundary is an adapter for the installed, unmodified Codex app-server. Provider profiles and credentials stay managed by Codex. A project plan assigns work to selected account aliases. The user approves the lead's plan; the same lead account later reviews worker submissions. Execution allows one active turn per account, four active turns globally, and up to 16 project turns (the effective project limit is the lower cap); tasks allow two revision rounds. Provider turns have a 30-minute limit.

Task isolation uses a Git worktree when the project is a Git repository and a filesystem snapshot otherwise. Results are staged for review; conflict checks run before explicit acceptance. Native subagents are disabled; Remora child tasks are future work. Claude, Grok, and remote nodes are future adapters.

## State and recovery

```mermaid
stateDiagram-v2
  idle --> planning
  planning --> draft
  draft --> approved: user approves
  approved --> running
  running --> paused: pause dispatch
  paused --> running: resume
  running --> blocked: task or assembly failure
  blocked --> paused: explicit task retry
  running --> ready: all tasks reviewed and assembled
  ready --> accepted: user accepts
  running --> cancelled: cancel
```

Task states distinguish execution from review: `pending → running → review → reviewing → accepted`. Rejected work returns to pending until its revision limit; errors block the project. Startup reconciliation suspends scheduling and reads saved provider sessions. Uncertain attempts remain interrupted until the user explicitly retries them.

SQLite stores account metadata, project/task state, durable project messages, and redacted events. Artifact bodies remain on disk. It stores no provider credentials. A service lock prevents two Remora processes from controlling the same state directory. The `project_messages` table keeps stable message IDs, retry idempotency keys, sender identity, and one delivery record per recipient, so queued messages and conversation history survive a restart. Schema version 2 is recorded in `meta`; opening a version 1 home creates the message table and advances the schema marker before serving requests. Future schema changes require a migration and backup strategy.

The HTTP API is local and pre-alpha. `/api/state` supplies the dashboard snapshot, `/api/events?after=ID` supplies ordered event pages, and account/project action routes back the CLI commands. The dashboard polls the snapshot every two seconds and derives each account's current task, review state, verified provider identity, and provider-reported usage windows from persisted records; it shows redacted started/completed action summaries, never hidden reasoning or raw provider credentials. Usage and reset values remain unavailable when the provider does not report them. State-changing routes use POST. Authentication uses a bearer token for the CLI and an HTTP-only SameSite cookie for the browser; both originate from the locally generated runtime token. Host and Origin checks reject remote browser origins.

Project conversation uses `GET /api/projects/:id/messages?after=<messageId>` and `POST /api/projects/:id/messages`. A post accepts up to eight project-member recipients and 4,000 characters, with `kind` (`update`, `question`, `answer`, or `blocker`), an optional reply target, and an optional retry idempotency key. API posts derive the sender from the authenticated local session as `user`; agent posts use an internal engine method that derives the account and role from project membership. Each recipient reports `queued`, `sent`, `delivered`, `answered`, or `failed` with a reason and timestamps. The Codex adapter advertises messaging only through its verified dynamic-tools bridge: active turns can be steered after a provider acknowledgement, while idle recipients return a negative receipt and remain queued for a later active checkpoint. The offline demo adapter provides deterministic credential-free request/reply QA. Remora never claims delivery from queue insertion, wakes unspecified accounts, or treats message text as authorization.
