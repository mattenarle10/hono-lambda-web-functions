# Hono Runtime Comparison

This isolated experiment uses the same Hono app on a native Lambda Web Function, API Gateway HTTP API + default Lambda, and ECS/Fargate + ALB in Tokyo. It owns a separate synthetic DynamoDB fixture table and generated demo secret.

The public benchmark route reads twenty synthetic records without authentication. The main reading-list routes still require the generated token. The benchmark never sends a bearer token over the HTTP ALB path.

## Method

- Node.js 24 and ARM64. Record actual deployed Node versions from response headers.
- Configure 2 GiB memory across paths. Web Functions have 2 vCPUs; Fargate uses 1 vCPU; default Lambda CPU follows its configured memory. Hardware and scaling are not identical.
- Web Functions: maximum 2 environments and 16 concurrent requests per environment. ECS: one task. Default Lambda: default account concurrency, no provisioned concurrency.
- Native entry points: Lambda paths HTTPS, ECS HTTP. These are end-to-end architecture measurements, not isolated runtime latency. No CDN or cache.
- Three rotating-order rounds; health and synthetic DynamoDB reads; concurrency caps 1, 8, and 16; ten warmups and 100 measured requests per phase; 40 scheduled starts per second; keep-alive.
- Report successful-request nearest-rank percentiles and all failures. Warmups are not proof that every request is warm. No maximum-throughput, cold-start, authentication, or cost claim.

## Local Checks

Use the pinned dependencies, then run `bun run typecheck` and `bun run test`. `bun run build` creates the shared server bundle and stages it with the tracked Dockerfile for synthesis/image build. The container uses the official ARM64 Node.js 24.21.0 image.

## Cloud Scope

Use only the confirmed sandbox and Tokyo. cdkd stack: `HonoRuntimeBenchmarkStack`; state prefix: `hono-runtime-benchmark`. Set `BENCH_INCLUDE_ECS=1` for the complete comparison. Review the cdkd preview and keep its approval prompt enabled. Deployment creates billable resources and public benchmark endpoints.

Keep resolved state, account identifiers, domains, and secret identifiers out of source/results. The benchmark client reads a temporary private endpoint configuration from `BENCH_CONFIG`; `BENCH_OUTPUT` selects the sanitized result directory.

Destroy only this experiment after recording results and checking identity/state. Verify deletion afterwards. Shared cdkd bootstrap storage and the original blog demo are separate.

## Run the Measurements

After the reviewed deployment, use a confirmed sandbox profile and explicitly set the expected account. Do not publish the private endpoint file.

```sh
export PATH="$PWD/node_modules/.bin:$PATH"
export AWS_PROFILE=your-aws-profile
export EXPECTED_BENCH_ACCOUNT=111122223333
export BENCH_CONFIG=/private/tmp/hono-runtime-endpoints.local.json
node scripts/setup-live.mjs
BENCH_OUTPUT=results/your-run-date node scripts/bench-runtimes.mjs
```

Select Node.js 24 explicitly for these commands. `setup-live.mjs` checks identity and stack ownership before seeding twenty synthetic records. It verifies live contracts and matching server versions before measurement. The runner records response timings and sanitized metadata only. It does not store domains, table names, AWS resource IDs, tokens, or server-process identifiers.
