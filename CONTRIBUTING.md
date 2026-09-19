# Contributing

Run `npm run format` before submitting changes. CI checks formatting, types, tests, production builds, and documentation links.

Remora is pre-alpha. Please open an issue before substantial changes so the scope and provider assumptions are clear. Keep changes focused, document user-visible behavior, and do not commit credentials, account exports, local tokens, SQLite files, or task snapshots.

Use Node.js `>=24.15.0 <25`, then run `npm ci` and `npm run check`. Credential-free tests are required for normal changes. Live tests are opt-in and must use two already connected aliases only after the operator has explicitly confirmed the accounts and flags.

Pull requests should explain the behavior changed, validation run, and any provider-specific limitation. Do not modify provider applications or claim live multi-account support without reproducible evidence.
