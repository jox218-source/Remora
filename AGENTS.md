# Repository guidance

This is a local TypeScript/npm workspace. Preserve the Node engine range (`>=24.15.0 <25`) and keep the default workflow credential-free. Never commit secrets, account profile data, local tokens, or generated task workspaces.

Changes should remain scoped to the requested behavior. Provider integrations must use installed, unmodified provider applications and honor their limits and terms. The plan lead and reviewer are the same selected account; intended limits are one turn per account, four globally, and two revisions. Git tasks use worktrees; non-Git tasks use snapshots and must check conflicts before explicit result acceptance.

Run `npm run check` for normal validation. Live validation is opt-in and requires two already connected real aliases; do not invent credentials or silently run it. Delegation is optional and is not required for contributions.
