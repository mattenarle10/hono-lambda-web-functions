# Hono Lambda Web Functions POC

This repository hosts a normal Hono HTTP server using AWS Lambda Web Functions and CDK.

## Scope

- Keep the API contracts in `src/app.ts` and `src/routes/` stable.
- `src/server.ts` must listen on the AWS-supplied `AWS_LAMBDA_HTTP_ENDPOINT`.
- Use CDK-managed S3 assets and local esbuild bundling. Do not add a manual ZIP or upload step.
- This is a disposable POC, with public demo routes and unresolved application startup logging. Do not describe it as production-ready.

## Checks

Use Node.js 24 and the locked Bun dependencies:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
bun run test
bun run smoke
```

The smoke command synthesizes offline with a placeholder account. It does not deploy.

## Cloud and Git

- Confirm the exact AWS account, profile, and region before cloud mutations.
- Review bootstrap, deployment, and destructive cleanup separately.
- Keep CDK approval prompts enabled.
- Never commit account IDs, generated infrastructure identifiers, secrets, auth files, logs, `build/`, or `cdk.out/`.
- Commit, push, or create/delete remote repositories only when the user asks.
