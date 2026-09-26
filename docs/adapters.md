# Adapters

The Codex adapter coordinates the installed, unmodified Codex app-server. Remora stores aliases and asks the provider application to handle its own credentials and account profile. Remora does not scrape, modify, or bypass the provider app.

The `demo` adapter is credential-free and returns deterministic-looking responses labeled `simulated`; it exists for local workflows and CI. Claude, Grok, subagent, and remote-node adapters are future milestones. Adapter status, usage, and errors should be treated as provider-specific and may change with the installed app.

## Adapter contract v1

The source of truth is [Provider and RunRequest](../packages/remora/src/types.ts). Adapters implement `status`, `login`, `logout`, `run`, `reconcile`, and `close`, and declare support for sessions, usage, and approvals.

`run` receives the approved workspace, account/model, prompt, network policy, read-only flag, optional output schema, cancellation signal, and event/session callbacks. Return the final response text. Persist a session reference before invoking model work so recovery can find an uncertain attempt. Planning and review return schema-constrained JSON, validated again by the scheduler.

Each account must have isolated authentication state. The Codex adapter gives each alias its own `CODEX_HOME` and app-server subprocess; it does not inherit API-key or access-token environment overrides. The CLI handles browser login and writes its own auth cache beneath that profile. Account aliases are lowercase and reject Windows device names.

Forward supported permission requests to the operator, never auto-approve them. Unknown provider requests fail closed. Cancellation must stop the provider before releasing capacity; uncertain termination quarantines the account. Report unavailable usage as unavailable, not zero. Never silently switch providers or billing modes.

Add credential-free adapter tests using a fake protocol process before opting into live provider tests. See [provider tests](../tests/provider.test.ts), [protocol fixture](../tests/fixtures/codex.mjs), and [validation evidence](validation.md). `npm run test:protocol` checks the installed Codex handshake without signing in or making model calls. Native tools and protocol fields vary by CLI version; a successful handshake alone does not establish full compatibility.

Project conversation follows the same fail-closed rule. The Codex app-server adapter now uses the verified `thread/start` dynamic-tools declaration and `item/tool/call` request/response protocol for authenticated send/read tools, plus `turn/steer` with the active turn id for live delivery. Idle recipients return a negative receipt and remain queued; only an acknowledged active-turn steer becomes delivered. The engine passes authenticated `sendProjectMessage` and `readProjectMessages` callbacks only to adapters that opt into that capability, and the credential-free fixture verifies tool schemas, scope, deduplication, and tool results. The offline demo adapter remains available for deterministic request/reply QA.
