# Testing

Normal validation is credential-free:

```bash
npm ci
npm test
npm run check
```

For a first local checkout, `npm start` performs the supported Node.js check, installs locked dependencies if needed, builds, and starts the foreground service. This is a convenience path for local startup; CI continues to run the explicit commands above.

The CI workflow runs `npm ci` and `npm run check` on Ubuntu and Windows with Node 24. Live tests are opt-in via `npm run test:live -- --accounts first,second --confirm-usage`, use the running service, and do not log out automatically. They require two already connected real aliases and explicit confirmation. Never place credentials in CI. Demo mode is the safe path for local and automated workflows.
