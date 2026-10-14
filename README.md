# Hono on Lambda Web Functions with cdkd

A reading-list API running as a normal Node.js 24 HTTP server on AWS Lambda Web Functions. CDK defines the resources; **cdkd (CDK Direct)** deploys them through AWS APIs and manages state in S3.

```txt
Client -> Web Function HTTPS endpoint -> Node.js HTTP server -> Hono
CDK app -> cdkd -> service SDK / Cloud Control -> AWS resources
```

This is a public, disposable POC. [cdkd is intended for dev/test](https://cdkd.dev/getting-started/).

## Use Case: Save Links to Read Later

Save a link, list saved links, and mark one read. Hono validates requests and checks a bearer token; DynamoDB persists the data. Scalar documents the workflow.

| Request | Action |
|---|---|
| `POST /bookmarks` | Save a title and HTTP/HTTPS URL |
| `GET /bookmarks` | List links, 20 per page |
| `PATCH /bookmarks/{id}/read` | Mark an existing link read |

All three require a token generated in Secrets Manager. [Run the local or cloud reading-list demo](./docs/reading-list.md). Local memory mode resets on restart; cloud data expires from the API after 24 hours.

## Public Routes

| Route | Response |
|---|---|
| `/health` | `200`, `{"ok":true}` |
| `/profile` | `200`, public profile |
| `/doc` | `200`, OpenAPI for health and profile |
| `/scalar` | `200`, API reference loading `/doc` |
| `/missing` | `404` |

## Local Setup

Requires Node.js 24, Bun, and AWS CLI for deployment.

1. Clone and install:

   ```sh
   git clone https://github.com/mattenarle10/hono-lambda-web-functions.git
   cd hono-lambda-web-functions
   nvm use
   bun install --frozen-lockfile --ignore-scripts
   export PATH="$PWD/node_modules/.bin:$PATH"
   cdkd --version
   ```

   The PATH change applies to this shell and selects the repo's pinned **cdkd 0.299.1**. If `cdkd` is unavailable, replace it in the commands below with `bunx --no-install cdkd`. Bun still runs the local TypeScript app and tests; AWS runs Node.js 24.

2. Check and start the app:

   ```sh
   bun run typecheck
   bun run test
   bun run smoke
   bun run dev
   ```

   Smoke runs the staged deployment files locally. It does not deploy. In another terminal:

   ```sh
   curl --fail-with-body http://127.0.0.1:3000/health
   ```

   Open `http://127.0.0.1:3000/scalar` for API docs.

## Deploy with cdkd

**Creates billable resources and a public endpoint.** Use a short-lived sandbox profile. This sample uses Tokyo; Singapore was absent from the [Web Functions launch region list](https://aws.amazon.com/about-aws/whats-new/2026/10/aws-lambda-web-functions/).

1. Set and verify the target:

   ```sh
   export AWS_PROFILE=your-aws-profile
   export CDK_DEPLOY_ACCOUNT=111122223333
   export CDK_DEPLOY_REGION=ap-northeast-1
   export AWS_REGION="$CDK_DEPLOY_REGION"
   aws sts get-caller-identity --profile "$AWS_PROFILE" --region "$AWS_REGION"
   ```

   Replace the account placeholder. Stop if the returned identity differs.

2. Review and bootstrap once for the target account/region:

   ```sh
   cdkd bootstrap --profile "$AWS_PROFILE" --region "$AWS_REGION"
   ```

   [cdkd bootstrap](https://cdkd.dev/cli-bootstrap/index.html) creates encrypted state/asset storage and an ECR asset repository. It is separate from `cdk bootstrap` and persists after app cleanup.

3. Preview, then review the deployment confirmation:

   ```sh
   cdkd diff HonoLambdaWebDirectStack \
     --no-cfn-fallback --state-prefix hono-web-poc --profile "$AWS_PROFILE"
   cdkd deploy HonoLambdaWebDirectStack \
     --no-cfn-fallback --strict-getatt --require-approval any-change \
     --state-prefix hono-web-poc --profile "$AWS_PROFILE"
   ```

   Keep approval prompts enabled. cdkd owns this POC under `hono-web-poc`; there is no application CloudFormation stack.

4. Read `EndpointUrl` and verify:

   ```sh
   cdkd state show HonoLambdaWebDirectStack \
     --state-prefix hono-web-poc --profile "$AWS_PROFILE"
   export ENDPOINT_URL='https://your-endpoint-domain'
   curl --include --fail-with-body "$ENDPOINT_URL/health"
   curl --fail-with-body "$ENDPOINT_URL/profile"
   curl --fail-with-body "$ENDPOINT_URL/doc"
   curl --fail-with-body "$ENDPOINT_URL/scalar"
   ```

   Replace the URL placeholder. Open `/scalar` in a browser too. An HTML response alone does not prove its UI loaded.

   For startup logs, use the response's `lambda-web-logstream` header to read the exact stream in `/aws/lambda/web/hono-lambda-web-direct-poc.local`. Both app log groups retain seven days. [AWS logging](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-logging.html)

## Code and Updates

- [`src/server.ts`](./src/server.ts) listens on AWS's `AWS_LAMBDA_HTTP_ENDPOINT`, with a localhost fallback.
- [`lib/bundle.ts`](./lib/bundle.ts) bundles the server. CDK assets and cdkd handle packaging/upload; no manual ZIP step.
- [`lib/web-stack.ts`](./lib/web-stack.ts) defines private, versioned code storage and scoped permissions. New Web Function types use Cloud Control.
- Revision logical IDs include the bundle hash: create the new revision, switch the stable endpoint, then remove the old revision. This order passed the update trials.

Demo settings: public `ApplicationManaged` access, two environments maximum, sixteen concurrent requests each, ten-second timeout, and 100 RPS limit. Add authentication before serving private data. These limits are not a spending guarantee.

## Results

Verified on 2026-10-14 with Node.js 24.19.0 and Bun 1.4.2:

- Eighteen tests, typecheck, cdkd synthesis, and the Node.js 24 staged-server smoke passed.
- Direct deployment, three original updates, restoration, four public HTTPS routes, expected 404, and startup logs passed.
- Cloud reading-list save/list/mark-read passed, with an independent DynamoDB read; unauthorized, invalid-input, and missing-record cases passed.
- Scalar rendered the new reading-list operations in Zen; its unauthenticated list request returned `401`. The authenticated browser walkthrough remains pending.
- Each deployment path passed 900 measured HTTP requests. The old CloudFormation POC and four owned helper-log remnants were deleted.

The benchmarks measured the earlier health-only code, before this reading-list expansion. Median code-update command time: **45.664 s with cdkd**, versus **79.264 s through CloudFormation**, excluding manual approval waiting. Three trials per tool. HTTP samples do not establish a CLI-caused runtime speedup or cost savings.

The first direct create failed with an S3 bucket-policy `socket hang up`; rollback completed and the same configuration succeeded on retry. Root cause remains unknown. The CDK validator also warns about the new resource types; those warnings remain visible.

[Benchmark method and raw results](./benchmarks/README.md). To rerun HTTP samples after setting `ENDPOINT_URL`:

```sh
BENCH_LABEL=cdkd BENCH_OUTPUT=benchmarks/results/cdkd-http.json \
  node scripts/bench-http.mjs
```

## Cleanup

**Deletes app code, object versions, logs, endpoint, revisions, function, stack roles, the demo DynamoDB table, and token secret.** Save sanitized evidence first.

1. Verify identity and inspect the owned state:

   ```sh
   aws sts get-caller-identity --profile "$AWS_PROFILE" --region "$AWS_REGION"
   cdkd state show HonoLambdaWebDirectStack \
     --state-prefix hono-web-poc --profile "$AWS_PROFILE"
   ```

2. Review the deletion confirmation:

   ```sh
   cdkd destroy HonoLambdaWebDirectStack \
     --state-prefix hono-web-poc --profile "$AWS_PROFILE"
   ```

   Verify deletion in cdkd state and AWS; check for leftover helper logs. Shared cdkd bootstrap storage and any existing `CDKToolkit` remain.

Before sharing screenshots, blur account IDs, ARNs, generated names, endpoint domains, and private data. Never commit credentials, resolved state, `.env`, `build/`, or `cdk.out/`.
