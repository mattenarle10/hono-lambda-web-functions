# Architecture Diagrams

Open [hono-web-functions-architecture.drawio](./hono-web-functions-architecture.drawio) in draw.io. It contains three editable pages with official AWS SVG icons embedded in the file. No icon download or cloud connection is required to edit it.

## Pages

| Page | Shows | Status |
|---|---|---|
| 1 Reading-list runtime | HTTPS endpoint, Hono, DynamoDB, Secrets Manager, CloudWatch, execution role | Matches the deployed Tokyo POC |
| 2 Deployment with cdkd | CDK app, cdkd CLI, AWS APIs, S3 state/assets/code, revision update order | Matches the deployment workflow; helper resources are summarized |
| 3 Hosting comparison | API Gateway + default Lambda, ECS/Fargate with ALB, Web Functions | Conceptual alternatives; only the expanded Web Functions reading list was deployed |

## Open and Edit

1. Open draw.io Desktop, or [app.diagrams.net](https://app.diagrams.net/). Choose **File > Open From > Device** and select the `.drawio` file.
2. Select a page tab along the bottom. Text, shapes, grouped service cards, and connectors are editable. The AWS icons are embedded SVG artwork.
3. Export the current page using **File > Export As > SVG** or **PNG**. Use a white background and keep text readable. The checked exports below are ready to use.

## Blog Exports

- Runtime: [SVG](./architecture-runtime.svg), [PNG](./architecture-runtime.png).
- Deployment: [SVG](./architecture-deployment.svg), [PNG](./architecture-deployment.png).
- Comparison: [SVG](./architecture-comparison.svg), [PNG](./architecture-comparison.png).

Exports were rendered with draw.io Desktop 32.4.1 and visually checked. No account IDs, ARNs, generated domains, resource names, or tokens are included.

## Icon Sources and Scope

Artwork comes from the [official AWS architecture icon package](https://aws.amazon.com/architecture/icons/), release 2026-07-31. The [source manifest](./aws-icon-sources.json) records the exact package URL, selected filenames, and SHA-256 values. The embedded AWS icon bytes are unchanged.

The package has no dedicated Web Functions icon. The generic official Lambda icon is labelled **Web Function**. Hono, cdkd, and the HTTPS endpoint use ordinary text boxes rather than invented AWS service icons.

These diagrams describe this POC; they are not an AWS-published reference architecture. The regional boundary is not a VPC. IAM is shown outside that boundary because it is an account-wide service. The comparison leaves out shared authentication, logging, packaging, and networking details for readability.
