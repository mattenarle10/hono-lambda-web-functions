# Hono Lambda Web Function POC with CDK

A normal Node.js HTTP server, deployed through CDK's Web Function resources. This is a disposable, public API demo. The Tokyo sandbox deployment, code update, restoration, and CDK-managed asset deployment passed HTTPS checks. Application startup logging was verified by reading the exact regional stream. Browser rendering remains unverified.

```txt
Client -> Web Function HTTPS endpoint -> Node.js HTTP server -> Hono
```

The routes, profile payload, OpenAPI title, and exported `AppType` are carried over from [hono-serverless](https://github.com/mattenarle10/hono-serverless).

| Route | Expected result |
|---|---|
| `GET /health` | `200`, `{"ok":true}` |
| `GET /profile` | `200`, the original public profile |
| `GET /doc` | `200`, OpenAPI 3.0.0 with both routes |
| `GET /scalar` | `200`, HTML configured to load `/doc` |
| `GET /missing` | `404` |

## Local Setup

Use Node.js 24, Bun, and the locked dependencies. Bun runs the TypeScript development server and tests; the deployed runtime is Node.js, not Bun. If you use nvm, the included `.nvmrc` selects Node.js 24.

1. Clone this repository:

   ```sh
   git clone https://github.com/mattenarle10/hono-lambda-web-functions.git
   cd hono-lambda-web-functions
   ```

2. Select Node.js 24 and install dependencies:

   ```sh
   nvm use
   node --version
   bun install --frozen-lockfile --ignore-scripts
   ```

   If you use a different Node version manager, select Node.js 24 with it instead of running `nvm use`.

3. Verify the app, template assertions, and server asset CDK stages for deployment:

   ```sh
   bun run typecheck
   bun run test
   bun run smoke
   ```

4. Synthesize without AWS lookups, using an obvious placeholder account:

   ```sh
   CDK_DEPLOY_ACCOUNT=111122223333 CDK_DEPLOY_REGION=ap-northeast-1 bun run synth
   ```

   This writes `cdk.out/`; it does not deploy. The placeholder is for offline synth only. The CDK library is pinned to `2.273.0`, with toolkit `2.1145.0`; CDK library and toolkit version numbers are separate.

5. Run the development server:

   ```sh
   bun run dev
   ```

   In another terminal, check the health route:

   ```sh
   curl --fail-with-body http://127.0.0.1:3000/health
   ```

   For the built Node.js server, use `bun run build` followed by `bun run start`. For an alternate local address, set `AWS_LAMBDA_HTTP_ENDPOINT=127.0.0.1:4000` before starting it. The fallback is only for local runs; AWS supplies the real listen address.

## Packaging and Infrastructure

The CDK stack defines a bundled S3 `Asset`. During synthesis, its local bundling provider calls `lib/bundle.ts`, which uses the installed esbuild package to write a CommonJS Node.js 24 `index.js` and `package.json` into CDK's staging directory. Only those files enter the asset; environment files, development dependencies, and infrastructure source are excluded.

CDK handles archiving and uploading the staged directory. There is no custom ZIP builder, archive dependency, or manual S3 upload command. AWS currently requires ZIP code in S3 for Web Functions; CDK supplies that format. [AWS code source requirements](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-code-s3.html), [CDK assets](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3_assets.Asset.html)

The asset uses `AssetHashType.OUTPUT`. Its bundled content determines the package key: `packages/<asset-hash>/<asset-object-key>`. Changed bundled code changes the key and replaces the immutable revision. Unchanged output keeps the same asset key.

`BucketDeployment` copies the CDK asset from the bootstrap bucket into the private, versioned application code bucket. `extract: false` keeps that archive intact. This avoids modifying the shared bootstrap bucket policy to grant Web Function code access. The revision waits for the copy, scoped bucket policy, and execution role. [CDK archive handling](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3_deployment-readme.html#keep-files-zipped)

`bun run deploy` invokes CDK directly. It needs no preceding `bun run build`. The optional `build` and `start` scripts are only for trying the compiled server locally.

The stack contains:

- `CfnWebFunction`, `CfnWebFunctionRevision`, and a `HomeRegion` `CfnWebFunctionEndpoint`, routing 100% to that revision.
- A private, SSL-only, versioned S3 bucket with Lambda service read access scoped to this function's revision ARN pattern.
- A logging execution role and the central plus `.local` log groups, both with seven-day retention. Create/write permissions are scoped to those two groups.
- A public `ApplicationManaged` endpoint, capped at two execution environments and 100 requests per second. Each environment permits up to sixteen concurrent requests; the request timeout is ten seconds. These are demo limits, not recommended production settings or a spending guarantee.

The initial AWS deployment rejected `rateLimit: 10`. Supported positive limits start at 100 RPS, use 100-RPS increments through 1,000, and 1,000-RPS increments above that. Zero disables traffic. The infrastructure test now checks those constraints rather than only matching the configured number. [AWS scaling settings](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-scaling.html)

The Web Function runtime is `nodejs24.x`; Arm64 is the launch platform rather than a separately configured architecture property on this revision. [AWS launch announcement](https://aws.amazon.com/blogs/aws/announcing-aws-lambda-web-functions-for-fast-consistent-web-app-performance-anywhere/)

CDK also creates helper Event Functions for the S3 upload and bucket cleanup. They are deployment helpers; requests to the Hono API go through the Web Function endpoint.

Old package objects are preserved during code updates so an earlier revision's artifact is not removed while it may still be needed. Destroying this disposable stack deletes the entire dedicated bucket, including all object versions, and deletes both app log groups. Copy any evidence you need before cleanup.

Web Functions write first to a `.local` companion group, including for a single-region endpoint, and then centralize asynchronously. The first logging role allowed only the central group, and initial searches did not show the startup message. The sample now manages both groups. `logs:CreateLogGroup` uses their bare group ARNs; `logs:CreateLogStream` and `logs:PutLogEvents` use their stream wildcard ARNs. Early searches returned no events. A later exact-stream read, using the health response's `lambda-web-logstream` header, confirmed the startup message in the `.local` group. No further permission change was made for that successful check. The earlier empty searches do not establish which configuration change affected delivery. [AWS logging guidance](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-logging.html)

## Sandbox Deployment

These commands create billable resources and a publicly reachable endpoint. Confirm the exact sandbox account and region first. Do not use a production account or add private data to the demo routes. Confirm your target account and review CDK's approval prompts before deploying. Bootstrap and cleanup need their own review.

The fixed function name is `hono-lambda-web-poc` and the stack name is `HonoLambdaWebStack`. Use an unused sandbox name; do not point this example at another person's existing stack.

1. Choose an existing short-lived AWS profile and set the target explicitly. Replace the account placeholder with the confirmed sandbox account:

   ```sh
   export AWS_PROFILE=your-aws-profile
   export CDK_DEPLOY_ACCOUNT=111122223333
   export CDK_DEPLOY_REGION=ap-northeast-1
   aws sts get-caller-identity --profile "$AWS_PROFILE" --region "$CDK_DEPLOY_REGION"
   ```

   Compare the returned account with `CDK_DEPLOY_ACCOUNT`. If the identity or target is wrong, stop. Do not put credentials in `.env` or source files.

2. Check the CDK bootstrap prerequisite for this account and region. If needed, review and approve bootstrap separately before running:

   ```sh
   bunx --no-install cdk bootstrap "aws://$CDK_DEPLOY_ACCOUNT/$CDK_DEPLOY_REGION" \
     --no-bootstrap-customer-key \
     --public-access-block-configuration true
   ```

   Bootstrap creates persistent deployment infrastructure and IAM roles. It is not part of the offline verification, and application cleanup does not remove it. [CDK bootstrapping](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html)

   The standard bootstrap gives its CloudFormation execution role `AdministratorAccess`. Review that policy before running bootstrap, and choose a narrower execution policy and trust model where needed. This command uses AWS-managed S3 encryption and adds no cross-account trust.

   Running bootstrap from this app directory also loads the CDK app. Set `CDK_DEPLOY_ACCOUNT` and `CDK_DEPLOY_REGION` first, even though the bootstrap command includes an explicit target. The app's account guard also applies during bootstrap.

3. Preview and review the proposed resources and IAM changes, then deploy:

   ```sh
   bun run diff
   bun run deploy
   ```

   Do not bypass CDK's approval prompts. With this sample's explicit revision weights, a code update is routed by the CloudFormation endpoint update; it does not rely on CLI `LatestRevision` auto-deployment.

4. Copy the `EndpointUrl` stack output into a local shell variable and check each route:

   ```sh
   export ENDPOINT_URL='https://your-endpoint-domain'
   curl --fail-with-body "$ENDPOINT_URL/health"
   curl --fail-with-body "$ENDPOINT_URL/profile"
   curl --fail-with-body "$ENDPOINT_URL/doc"
   curl --fail-with-body "$ENDPOINT_URL/scalar"
   curl --silent --output /dev/null --write-out '%{http_code}\n' "$ENDPOINT_URL/missing"
   ```

   Replace the placeholder domain with the output. Open `$ENDPOINT_URL/scalar` in a browser and confirm that both routes appear and the OpenAPI fetch succeeds. Scalar uses an external script CDN; HTML checks alone do not prove the browser UI loads.

5. Inspect endpoint state and logs. The stack outputs `EndpointState` and `RevisionState`, which can be retrieved with the existing CloudFormation CLI:

   ```sh
   aws cloudformation describe-stacks \
     --stack-name HonoLambdaWebStack \
     --query 'Stacks[0].Outputs' \
     --profile "$AWS_PROFILE" \
     --region "$CDK_DEPLOY_REGION"
   ```

   For additional endpoint details, use an AWS CLI v2 release that includes `lambda-web`. The installed CLI used during local preparation did not recognize it; update through the [official AWS CLI instructions](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) if `aws lambda-web help` fails. CloudFormation outputs and HTTPS checks do not require that new command.

   ```sh
   aws lambda-web get-web-function-endpoint \
     --function-name hono-lambda-web-poc \
     --endpoint-name dev \
     --profile "$AWS_PROFILE" \
     --region "$CDK_DEPLOY_REGION"

   aws logs tail /aws/lambda/web/hono-lambda-web-poc \
     --since 10m \
     --profile "$AWS_PROFILE" \
     --region "$CDK_DEPLOY_REGION"
   ```

   For immediate regional troubleshooting, tail `/aws/lambda/web/hono-lambda-web-poc.local` instead. Its name is also returned as `LocalLogGroupName`. Centralized logs can arrive a few minutes later.

   If a recent-window search returns no events, get the exact stream name from a successful response's `lambda-web-logstream` header. Read that stream in the regional `.local` group:

   ```sh
   curl --include --fail-with-body "$ENDPOINT_URL/health"
   export LAMBDA_WEB_LOGSTREAM='paste-the-lambda-web-logstream-header-value'
   aws logs get-log-events \
     --log-group-name /aws/lambda/web/hono-lambda-web-poc.local \
     --log-stream-name "$LAMBDA_WEB_LOGSTREAM" \
     --start-from-head \
     --limit 100 \
     --no-paginate \
     --profile "$AWS_PROFILE" \
     --region "$CDK_DEPLOY_REGION"
   ```

   This exact-stream read confirmed the server's startup message in the sandbox. An empty early search is not proof that no logs were delivered. [AWS log correlation guidance](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-logging.html)

   `Active` is not an HTTP health check. A wrong entry file or listen address can still cause requests to fail. Record successful HTTPS responses and check for initialization errors. [AWS S3 deployment guide](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-code-s3.html)

6. Test an update without changing the route contracts. Add `c.header('x-demo-revision', 'second')` before the health handler's `return` in `src/routes/health.ts`, then run `bun run test` and `bun run deploy`. Confirm the new header at the same endpoint URL:

   ```sh
   curl --include --fail-with-body "$ENDPOINT_URL/health"
   ```

   Record the new `RevisionId` output. Remove the demo header and redeploy before recording the final example.

   This is a sandbox update test, not a canary rollout or a zero-downtime guarantee. Do not attach additional endpoints manually; a revision still serving such an endpoint cannot be deleted during stack updates or cleanup.

## Cleanup: Deletes Resources and Evidence

1. Save sanitized observations and screenshots. Recheck your identity and review the stack resources before deleting:

   ```sh
   aws sts get-caller-identity --profile "$AWS_PROFILE" --region "$CDK_DEPLOY_REGION"
   aws cloudformation list-stack-resources \
     --stack-name HonoLambdaWebStack \
     --profile "$AWS_PROFILE" \
     --region "$CDK_DEPLOY_REGION"
   ```

2. After confirming that this is the disposable POC, destroy it and review the manual confirmation prompt:

   ```sh
   bun run destroy
   ```

   This deletes the endpoint, revision, function, both app log groups, and deployment bucket with its object versions. It does not delete the CDK bootstrap stack or its shared asset bucket. This cleanup configuration is unsuitable for a production artifact store or audit logs.

3. Verify deletion using the CloudFormation console or CLI:

   ```sh
   aws cloudformation describe-stacks \
     --stack-name HonoLambdaWebStack \
     --profile "$AWS_PROFILE" \
     --region "$CDK_DEPLOY_REGION"
   ```

   For a deleted named stack, the CLI normally reports that it does not exist. Authentication errors, network failures, or `DELETE_FAILED` are not deletion evidence. Confirm the Web Function is gone in the Lambda console, check for leftover deployment-helper logs, and account for any retained CDK bootstrap resources before considering cleanup complete.

## Verification Record

Prepared on 2026-10-14, on macOS Arm64. Node.js 24.19.0 was used to run the CDK-staged server files; Bun 1.4.2 ran the TypeScript tests.

| Check | Result |
|---|---|
| Route and template tests | Nine passing tests |
| TypeScript | `tsc --noEmit` passed |
| CDK-staged server under Node.js 24 | All four routes, supplied listen address, 404, and eight concurrent health requests passed |
| Unchanged-source synth | Asset hash and package key stability checked locally |
| Offline CDK synth | Passed using placeholder account `111122223333` and Tokyo; validator warnings remain |
| AWS deployment | Corrected stack completed in Tokyo; endpoint and revision `Active` |
| CDK-managed asset deployment | New revision `Active`; original contracts passed at the same URL after asset bundling, packaging, upload, and copy |
| HTTPS routes | All four routes returned `200` with expected content; unknown route returned `404` |
| Code update | New revision served the temporary header at the unchanged endpoint URL |
| Application startup logs | Verified in the `.local` stream identified by the health response; startup message observed with `get-log-events` |
| Scalar browser rendering | Unverified; browser automation surface was unavailable |
| Restore | New revision removed the demo header; original contracts and unchanged URL verified |
| Cleanup | The test POC remains deployed; the deletion procedure above is documented but not yet verified |

The pinned CDK library's bundled CloudFormation validator emits `Unknown resource type 'AWS::Lambda::WebFunction'` warnings on the three Web Function constructs. Synthesis succeeds and the [official CDK reference](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda.CfnWebFunction.html) documents these resources, but the local validator did not validate their cloud schemas. Do not suppress the warnings or treat synth as a deployment test.

The smoke command first synthesizes offline with a placeholder account. It then finds the Web Function server asset in the CDK manifest, checks that CDK will package it as a ZIP with only the two allowlisted files, and runs a copy under Node.js 24 using a temporary loopback listener. It requires permission to listen locally if your sandbox blocks network sockets. It does not emulate Lambda scaling, billing, request isolation, or cold starts.

Before sharing screenshots, blur account IDs, ARNs, role names, generated bucket names, endpoint domains, and private data. Keep real cloud outputs, credentials, and local environment files out of this repository.
