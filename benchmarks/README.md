# Hono Web Functions: Deployment and HTTP Measurements

This is one disposable POC in Tokyo, not a general performance ranking. Both paths use AWS Lambda Web Functions. The deployment engine changes; the Hono API and service settings stay the same.

These measurements precede the reading-list feature. They cover the health-only source through [commit b31a50b](https://github.com/mattenarle10/hono-lambda-web-functions/tree/b31a50b), without DynamoDB, Secrets Manager, or the new AWS SDK application dependencies. The reading-list deployment and database requests are not part of these timing samples.

## Matched Code Updates

Each tool deployed three versions of the same temporary `x-demo-revision` health header: `benchmark-1`, `benchmark-2`, and `benchmark-3`. Responses were checked after every update. Both used the same bundled application hashes.

| Tool | Trial 1 | Trial 2 | Trial 3 | Median |
|---|---:|---:|---:|---:|
| AWS CDK CLI / CloudFormation | 79.254 s | 79.264 s | 86.084 s | 79.264 s |
| cdkd / SDK and Cloud Control | 45.664 s | 50.351 s | 35.331 s | 45.664 s |

The median cdkd update used 42.4% less measured command time in these trials. The elapsed-time ratio was 1.74. Three trials do not establish a universal speedup.

Time starts at CLI process launch and ends at its exit. It includes synthesis, asset publishing, and service stabilization. An external identity precheck is outside the timing boundary. Manual confirmation waiting is measured separately and subtracted. The remaining pre-approval work remains included.

Both CLI processes used Node.js 24.19.0. Node's compile cache was disabled. No `--no-wait`, `--yes`, skipped asset uploads, or guessed-output overrides were used. The pinned versions were AWS CDK CLI 2.1145.0, CDK library 2.273.0, and cdkd 0.299.1. The direct version uses content-addressed logical revisions so the endpoint is updated before removing the old revision; both paths perform the same physical revision/endpoint operations.

The CLI's own printed duration can include confirmation waiting and uses its own timing boundary. It is not the value compared above.

## Separate Operations and Failure

These records are excluded from the update comparison:

| Operation | Command wall time excluding approval waiting | Outcome |
|---|---:|---|
| cdkd bootstrap | 12.417 s | State and asset storage created |
| First cdkd create | 35.484 s | Failed with S3 bucket-policy `socket hang up`; twelve completed operations rolled back |
| Retried cdkd create | 46.311 s | Same configuration succeeded |
| Old CloudFormation POC destruction | 35.400 s | Stack and owned resources deleted |
| Direct API restoration | 44.467 s | Original responses restored at the same endpoint |

The transport failure's root cause was not established. The failure remains in the raw timing record. There is no matched fresh CloudFormation creation measurement here, so the successful direct create is not a comparative create benchmark.

## HTTP Samples

The same Node.js 24.19.0 HTTPS client ran on macOS Arm64. The configured timezone was Asia/Manila; physical client location and network path were not measured or controlled. Both functions were in `ap-northeast-1`, using `HomeRegion`, `nodejs24.x`, a ten-second timeout, a maximum of two execution environments, sixteen concurrent requests per environment, and a 100 RPS limit.

Each deployment had three rounds. Each round used ten warm-up requests before 100 sequential samples, then ten warm-up requests before 200 samples with a concurrency cap of eight. Request starts were paced on a 50-per-second schedule. The client used keep-alive, and timing included the network trip and complete response-body read. Warm-up samples are excluded from percentiles; their successful contracts were checked.

Percentiles below pool successful measured requests across the three rounds for each concurrency cap, using the nearest-rank method. Every measured request returned the original `{"ok":true}` contract.

| Path | Concurrency cap | Samples | p50 | p95 | p99 | Failures |
|---|---:|---:|---:|---:|---:|---:|
| cloudformation | 1 | 300 | 112.90 ms | 131.75 ms | 200.78 ms | 0 |
| cloudformation | 8 | 600 | 113.73 ms | 134.87 ms | 140.58 ms | 0 |
| cdkd | 1 | 300 | 119.05 ms | 137.37 ms | 142.12 ms | 0 |
| cdkd | 8 | 600 | 112.69 ms | 138.44 ms | 149.39 ms | 0 |

All 900 measured requests passed on each path. The first direct concurrency-eight round had a lower median than later rounds; the raw per-round results retain that variation. CLI choice does not itself change the HTTP runtime, and these samples do not establish a runtime latency improvement.

This does not measure cold starts, a capacity limit, database or model waiting, CloudWatch server-side duration, or a bill. Warm-up is not proof that every measured request was warm. Do not mix these measurements with the earlier Singapore Lambda/ECS comparison.

## Reproduce and Inspect

- [HTTP measurement script](../scripts/bench-http.mjs)
- [Interactive command timer](../scripts/time-command.py)
- [All deployment attempts](./results/deployment-timings.json), including failure and approval waiting
- [CloudFormation HTTP raw samples](./results/cloudformation-http.json)
- [cdkd HTTP raw samples](./results/cdkd-http.json)
- [Computed pooled summary](./results/summary.json)
- [Earlier CloudFormation source](https://github.com/mattenarle10/hono-lambda-web-functions/tree/9a77d03)

Use disposable checkouts and confirm your profile/account/region. The benchmark header changes were made in temporary checkouts, and the live direct POC was restored from the original application source. The old CloudFormation POC and its four verified helper-log remnants were removed; the direct POC remains available for the demo. Bootstrap storage remains.

Raw results contain timing samples and configuration metadata only. Live account IDs, profile names, endpoints, request IDs, log-stream identifiers, credentials, and resolved state are excluded.
