# Hono Lambda Web Functions POC

This repository hosts a normal Hono HTTP server using AWS Lambda Web Functions, CDK constructs, and the cdkd CLI.

## Scope

- Keep the API contracts in `src/app.ts` and `src/routes/` stable.
- `src/server.ts` must listen on the AWS-supplied `AWS_LAMBDA_HTTP_ENDPOINT`.
- Use cdkd (CDK Direct) for app deployment. AWS CDK CLI is only relevant to the earlier CloudFormation benchmark baseline.
- Use CDK-managed S3 assets and local esbuild bundling. Do not add a manual ZIP or upload step.
- Keep immutable revision logical IDs tied to the code hash; update the endpoint before deleting the old revision.
- Keep cdkd state scoped to `--state-prefix hono-web-poc`.
- This is a disposable POC with public demo routes. The direct API, code updates, and application startup logs were verified in a sandbox. Do not describe it as production-ready.

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
