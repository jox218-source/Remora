# Maintainers

Keep the project local-first, provider-respecting, and honest about pre-alpha behavior. Review changes for secret handling, account/turn limits, worktree or snapshot isolation, conflict checks, explicit result acceptance, and credential-free CI.

There is no dedicated support address in this repository. Use the private security reporting path described in [SECURITY.md](../SECURITY.md) for vulnerabilities and GitHub issues for normal project discussion.

## Release checklist

1. Follow the [first alpha release preparation](release.md) preflight: run `npm ci`, `npm run check`, `npm audit`, and the signed-out protocol smoke; require both Windows and Linux CI jobs to pass.
2. Verify the demo through the dashboard and CLI. Check text previews, task feedback, permissions, and result acceptance against the original project.
3. Run the signed-out protocol smoke check against each supported Codex version. Before claiming authenticated support, complete the opt-in two-account test and separately verify logout/refresh isolation with the account owners present.
4. Update the changelog, compatibility/validation evidence, and versions in all three package manifests, then refresh the lockfile.
5. Review the diff for credentials and private artifacts. Build outputs, profiles, SQLite databases, and runtime tokens must remain ignored.
6. Tag and publish a GitHub release only after maintainer review. npm packages remain private in this alpha candidate; registry publication needs a separately tested packaging/distribution change.

Use prerelease semantic versions until the live integration gates are met. Breaking adapter or API changes require migration notes. There are no automatic updates of provider binaries or uploads of user project data to Remora infrastructure.
