# Hono on Lambda Web Functions with cdkd

A normal Node.js HTTP server, defined with AWS CDK and deployed with **cdkd (CDK Direct)**. This is a disposable, public API demo.

```txt
Client -> Web Function HTTPS endpoint -> Node.js 24 HTTP server -> Hono
CDK app -> cdkd -> service SDK / Cloud Control API -> AWS resources
```

cdkd is a separate CLI from AWS CDK CLI. It manages its own state instead of creating a CloudFormation stack. The direct POC was deployed and updated successfully. The earlier CloudFormation POC was measured, then destroyed after the new API passed.

## Routes

The contracts come from [hono-serverless](https://github.com/mattenarle10/hono-serverless):

| Route | Expected result |
|---|---|
| `GET /health` | `200`, `{"ok":true}` |
| `GET /profile` | `200`, the public profile |
| `GET /doc` | `200`, OpenAPI with health and profile |
| `GET /scalar` | `200`, API reference HTML loading `/doc` |
| `GET /missing` | `404` |

## Run Locally

1. Clone the sample and select Node.js 24:

   ```sh
   git clone https://github.com/mattenarle10/hono-lambda-web-functions.git
   cd hono-lambda-web-functions
   nvm use
   ```

2. Install locked dependencies and check the app:

   ```sh
   bun install --frozen-lockfile --ignore-scripts
   bun run typecheck
   bun run test
   bun run smoke
   ```

   Bun runs the CDK TypeScript app and tests. The deployed server runs Node.js 24. The smoke command synthesizes with a placeholder account and runs the exact staged server files under Node.js 24. It checks the supplied listen address, four routes, `404`, and eight concurrent health requests.

3. Start the app:

   ```sh
   bun run dev
   ```

   Check `http://127.0.0.1:3000/health` in another terminal. The optional `bun run build` and `bun run start` commands run the compiled server locally.

## Deploy with cdkd

**These commands create billable resources and a public endpoint.** Use an existing short-lived sandbox profile. Verify the identity before creating anything.

1. Set the target. Replace the account placeholder with your confirmed sandbox account:

   ```sh
   export AWS_PROFILE=your-aws-profile
   export CDK_DEPLOY_ACCOUNT=111122223333
   export CDK_DEPLOY_REGION=ap-northeast-1
   export AWS_REGION="$CDK_DEPLOY_REGION"
   aws sts get-caller-identity --profile "$AWS_PROFILE" --region "$AWS_REGION"
   ```

   Stop if the identity does not match. Singapore was absent from the Web Functions launch region list; this sample uses Tokyo. Do not put credentials into source or `.env` files.

2. Review and run cdkd bootstrap:

   ```sh
   bun run bootstrap --profile "$AWS_PROFILE" --region "$AWS_REGION"
   ```

   This is **cdkd bootstrap**, separate from `cdk bootstrap`. It creates a versioned, encrypted state bucket, an encrypted regional asset bucket, an immutable-tag ECR asset repository, and an asset-storage marker. These persist after application cleanup. No CDK CloudFormation execution role is needed. [cdkd bootstrap](https://cdkd.dev/cli-bootstrap/index.html)

3. Preview, then deploy:

   ```sh
   bun run diff --profile "$AWS_PROFILE"
   bun run deploy --profile "$AWS_PROFILE"
   ```

   The scripts call pinned `cdkd` 0.299.1 directly. Deployment uses `--require-approval any-change`, `--strict-getatt`, and `--no-cfn-fallback`. Keep prompts enabled. The POC state is isolated under `--state-prefix hono-web-poc`.

   The logical stack name is `HonoLambdaWebDirectStack`; its Web Function is `hono-lambda-web-direct-poc`. A cdkd deployment does not appear as an application stack in the CloudFormation console.

4. Inspect outputs from cdkd state and check the API:

   ```sh
   bunx --no-install cdkd state show HonoLambdaWebDirectStack \
     --state-prefix hono-web-poc \
     --profile "$AWS_PROFILE"
   export ENDPOINT_URL='https://your-endpoint-domain'
   curl --fail-with-body "$ENDPOINT_URL/health"
   curl --fail-with-body "$ENDPOINT_URL/profile"
   curl --fail-with-body "$ENDPOINT_URL/doc"
   curl --fail-with-body "$ENDPOINT_URL/scalar"
   ```

   Replace the URL placeholder with `EndpointUrl`. Open `/scalar` in a browser to confirm both routes render; an HTML response alone does not prove its external UI script loaded.

5. Verify logs using a response's exact stream:

   ```sh
   curl --include --fail-with-body "$ENDPOINT_URL/health"
   export LAMBDA_WEB_LOGSTREAM='paste-the-lambda-web-logstream-header-value'
   aws logs get-log-events \
     --log-group-name /aws/lambda/web/hono-lambda-web-direct-poc.local \
     --log-stream-name "$LAMBDA_WEB_LOGSTREAM" \
     --start-from-head --limit 100 --no-paginate \
     --profile "$AWS_PROFILE" --region "$AWS_REGION"
   ```

   Web Functions write to the regional `.local` group before asynchronous centralization. Both groups have seven-day retention. Their creation and stream-writing ARN permissions are explicit and scoped to these two names. An empty early search is not proof that no logs arrived. [AWS logging guidance](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-logging.html)

## How Packaging and Updates Work

`lib/bundle.ts` uses esbuild to write only `index.js` and a CommonJS `package.json`. A CDK S3 `Asset` stages those files; cdkd packages and uploads them. AWS requires a ZIP internally, but there is no manual ZIP or upload step.

`BucketDeployment` copies that asset into a dedicated private, versioned, SSL-only code bucket with `extract: false`. The Lambda service gets package-read permission scoped to this Web Function's revisions. Existing package versions remain available during updates.

Web Functions, revisions, and endpoints are deployed through cdkd's documented Cloud Control path when no dedicated SDK provider exists. Tokyo reported the function and endpoint types `FULLY_MUTABLE`, and the revision type `IMMUTABLE`. [cdkd resource coverage](https://cdkd.dev/supported-resources/index.html)

The immutable revision's logical ID includes the bundled output hash. On a code change, cdkd creates a new revision, updates the stable endpoint reference, and deletes the old logical resource after the create/update phase. This avoids attempting an in-place revision update or deleting a revision still serving the endpoint.

The endpoint has public `ApplicationManaged` access, two execution environments maximum, sixteen concurrent requests per environment, a ten-second request timeout, and a 100 RPS limit. These are demo settings, not production guidance or a spending guarantee. Positive request limits start at 100; the earlier deployment rejected 10. [AWS scaling settings](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-scaling.html)

## Benchmarks

The experiment measures matched code updates through CloudFormation and cdkd, and repeated `/health` latency samples from the same macOS Arm64 laptop to Tokyo. Bootstrap, first creation, and cleanup are recorded separately from update timing.

The HTTP script uses Node.js 24, keep-alive connections, three rounds, ten warm-up requests per phase, 100 sequential samples, and 200 samples with a concurrency cap of eight. Request starts are paced on a 50-per-second schedule. It saves raw latency samples and failures without account, endpoint, request, or log-stream identifiers:

```sh
BENCH_LABEL=cdkd \
BENCH_OUTPUT=benchmarks/results/cdkd-http.json \
bun run bench:http
```

Set `ENDPOINT_URL` first. These measurements include network and body-read time. The client's physical location and network path were not measured or controlled. They do not establish cold-start latency, maximum throughput, AI workload behavior, or cost savings. CLI choice should not itself change the HTTP runtime.

[Completed measurements and raw data](./benchmarks/README.md): three update trials per tool and 900 successful HTTP samples per deployment. Median update command time was 45.664 s with cdkd versus 79.264 s through CloudFormation, excluding approval waiting. These results apply only to this POC. The comparison records approval waiting separately and does not use `--no-wait` or skipped stabilization. The CLI's printed duration can include time spent waiting at a confirmation prompt; do not compare that directly with an unattended run.

For a timed update, make the same small code change in a disposable checkout and keep manual approval enabled:

```sh
NODE_DISABLE_COMPILE_CACHE=1 \
python3 scripts/time-command.py \
  --label cdkd-update-1 \
  --output benchmarks/results/deployment-timings.json \
  -- bun run deploy --profile "$AWS_PROFILE"
```

The timer preserves the interactive prompt and records total wall time, approval waiting, and wall time excluding that waiting. Failed commands are retained with their exit code. No command arguments or live AWS identifiers enter the results file.

## Cleanup: Deletes Application Resources and Evidence

1. Save sanitized evidence, verify identity, and inspect this POC's state:

   ```sh
   aws sts get-caller-identity --profile "$AWS_PROFILE" --region "$AWS_REGION"
   bunx --no-install cdkd state show HonoLambdaWebDirectStack \
     --state-prefix hono-web-poc --profile "$AWS_PROFILE"
   ```

2. Review the deletion confirmation:

   ```sh
   bun run destroy --profile "$AWS_PROFILE"
   ```

   This deletes the endpoint, revisions, function, code bucket and object versions, app log groups, and stack roles. Check for leftover helper log groups and confirm both cdkd state and AWS resource deletion. A failed command is not cleanup evidence.

   The cdkd bootstrap storage and any previously approved `CDKToolkit` remain. Do not destroy shared bootstrap storage while another stack uses it. No database, Bedrock calls, or AgentCore resources are included.

## Verification Record

Prepared on 2026-10-14 with Node.js 24.19.0 and Bun 1.4.2.

| Check | Result |
|---|---|
| Contracts and infrastructure | Nine tests passing |
| TypeScript | Passed |
| cdkd CLI, synthesis, and staged-server smoke | Passed |
| cdkd bootstrap and deployment dry-run | Passed in the confirmed Tokyo sandbox |
| Direct deployment and updates | Passed; three timed code updates and restoration kept the endpoint URL |
| HTTPS contracts | Four routes and expected 404 passed |
| Direct startup logs | Verified in an exact regional stream |
| HTTP measurements | 900 measured requests per deployment, all passed |
| Old POC cleanup | CloudFormation stack/resources and four exactly owned helper logs deleted |
| Scalar browser rendering | Unverified |

The pinned CDK library's bundled validator warns about the new Web Function resource types. The warnings remain visible; local synthesis is not a cloud deployment test. cdkd is documented as a dev/test tool. Keep this sample a POC. [cdkd getting started](https://cdkd.dev/getting-started/)

Before sharing screenshots, blur account IDs, ARNs, role names, generated bucket names, endpoint domains, and private data. Never commit credentials, resolved state, `.env`, `build/`, or `cdk.out/`.
