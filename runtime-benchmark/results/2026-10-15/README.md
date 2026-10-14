# Three Hono Runtime Paths in Tokyo

Measured on 2026-10-15 in Asia/Manila (run start: 2026-10-14T18:10:17.272Z). Same Hono application and ARM64 Node.js 24.21.0 on all three server paths; the client used Node.js 24.19.0 on macOS ARM64.

The experiment used its own synthetic DynamoDB table with twenty records. The fixture-read route calls the same consistent-read query on all three paths and bypasses token authentication. It contains no user data, and no bearer token was sent over HTTP. The original reading-list save/list/mark-read workflow was verified separately.

## Pooled Results at Client Concurrency Cap 8

| Runtime | Workload | p50 | p95 | p99 | Samples | Failures |
|---|---|---:|---:|---:|---:|---:|
| Web Functions (HTTPS) | Health | 102.98 ms | 112.03 ms | 124.59 ms | 300 | 0 |
| API Gateway + Lambda (HTTPS) | Health | 119.13 ms | 129.05 ms | 130.90 ms | 300 | 0 |
| ECS/Fargate + ALB (HTTP) | Health | 102.59 ms | 104.93 ms | 123.03 ms | 300 | 0 |
| Web Functions (HTTPS) | 20-record database read | 104.16 ms | 127.88 ms | 133.40 ms | 300 | 0 |
| API Gateway + Lambda (HTTPS) | 20-record database read | 120.38 ms | 133.13 ms | 144.60 ms | 300 | 0 |
| ECS/Fargate + ALB (HTTP) | 20-record database read | 77.67 ms | 82.12 ms | 98.90 ms | 300 | 0 |

All 5,400 measured requests passed. This table pools three 100-request rounds per row; the raw data also includes client caps 1 and 16. Each phase had ten warmups excluded from percentiles. Successful-request percentiles use nearest rank.

Request starts were scheduled at no more than 40 per second. Caps describe the client's maximum requests in flight; these are not a maximum-throughput test. Keep-alive was enabled, no CDN/cache was used, and measured latency includes the network request and full response-body read. Runtime order rotates by round. Physical client location and network path were not controlled. Warmup does not verify every request was warm.

## What This Supports

Web Functions had a lower pooled p95 than API Gateway + Lambda for the cap-8 health and fixture-read samples. The database difference at p95 was 5.25 ms, small enough that I would not generalize it from this run. ECS's HTTP path had the lowest pooled p95 in those samples.

Protocols and compute settings differ. Web Functions had two vCPUs and 2 GiB per environment; Fargate used one vCPU and 2 GiB in one task; default Lambda used 2,048 MiB with CPU proportional to memory. Web Functions allowed at most two environments and sixteen concurrent requests each. Default Lambda had no provisioned or reserved concurrency configured.

This compares these end-to-end deployment paths. It does not isolate runtime speed, prove cold-start performance, measure authenticated save requests, establish maximum capacity, or compare bills. Some database-read samples were faster than the health samples; the test cannot separate network/time-of-run effects from server work.

## Evidence

- [All request samples and per-round summaries](./samples.json).
- [All 18 pooled summary rows](./summary.json).
- [Compute settings and integrity hashes](./metadata.json).
- [Benchmark source and method](../../README.md).

cdkd reported the temporary stack destroyed with 59 resources deleted, one log group retained, and zero errors. Further cleanup and independent deletion verification were stopped at the owner's request. This is not a claim that every related resource was removed. The original blog POC and shared cdkd bootstrap storage were outside that destroy.
