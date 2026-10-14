# Architecture Diagrams

Open [hono-web-functions-architecture.drawio](./hono-web-functions-architecture.drawio) in draw.io. Three short diagrams use large official AWS icons and editable arrows/labels.

| Page | Meaning |
|---|---|
| 1 Our app | A browser uses Hono on a Web Function; DynamoDB stores links. Secrets Manager and CloudWatch support the app. |
| 2 Deploying our app | CDK defines the resources, cdkd deploys, S3 stores the code, and Lambda runs it. |
| 3 Three hosting options | The same API through API Gateway + Lambda, ECS/Fargate with a load balancer, or Web Functions. |

## Open and Edit

1. In draw.io, choose **File > Open From > Device** and select the file.
2. Choose a page tab. Move or edit the icons, labels, and connectors.
3. Use **File > Export As > SVG** or **PNG**, or use the checked exports below.

## Exports

- App: [SVG](./architecture-runtime.svg), [PNG](./architecture-runtime.png).
- Deployment: [SVG](./architecture-deployment.svg), [PNG](./architecture-deployment.png).
- Comparison: [SVG](./architecture-comparison.svg), [PNG](./architecture-comparison.png).

Rendered with draw.io Desktop 32.4.1 and visually checked.

## Sources and Simplification

The icons are unchanged SVG artwork from the [official AWS icon package](https://aws.amazon.com/architecture/icons/), release 2026-07-31. This includes the AWS cloud mark, client, Lambda, DynamoDB, S3, API Gateway, ECS, Fargate, load balancer, Secrets Manager, CloudWatch, and CDK icons. The [source manifest](./aws-icon-sources.json) records filenames and SHA-256 values.

Web Functions use the generic official Lambda icon because this package has no dedicated Web Functions artwork. cdkd is a separate tool, represented by a plain label.

These are simplified views of our POC, not AWS-published reference architectures. Only the Web Functions reading list was deployed. The comparison alternatives are conceptual. The app view omits explicit IAM and endpoint configuration; the deployment view omits state/asset buckets, AWS control APIs, deployment helpers, and revision update steps. The article and tested stack explain those details.
