import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import * as cdk from 'aws-cdk-lib'
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as patterns from 'aws-cdk-lib/aws-ecs-patterns'
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WebStack } from './web-stack.js'

export class ComparisonStack extends WebStack {
  constructor(scope: cdk.App, id: string, props: cdk.StackProps) {
    super(scope, id, props)
    const table = this.node.findChild('ReadingList') as dynamodb.Table
    const secret = this.node.findChild('ReadingListToken') as secretsmanager.Secret
    const environment = {
      READING_LIST_TABLE: table.tableName,
      READING_LIST_TOKEN_SECRET_ARN: secret.secretArn,
    }
    const eventLogs = new logs.LogGroup(this, 'EventLogs', {
      retention: logs.RetentionDays.ONE_DAY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })
    const eventFunction = new lambda.Function(this, 'EventFunction', {
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 2048,
      timeout: cdk.Duration.seconds(10),
      logGroup: eventLogs,
      environment,
      code: lambda.Code.fromAsset(fileURLToPath(new URL('../src/', import.meta.url)), {
        bundling: {
          image: lambda.Runtime.NODEJS_24_X.bundlingImage,
          local: {
            tryBundle(outputDirectory) {
              mkdirSync(outputDirectory, { recursive: true })
              buildSync({
                absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
                entryPoints: ['src/event.ts'],
                outfile: join(outputDirectory, 'index.js'),
                bundle: true, platform: 'node', target: 'node24', format: 'cjs',
              })
              writeFileSync(join(outputDirectory, 'package.json'), '{"type":"commonjs"}\n')
              return true
            },
          },
        },
      }),
      handler: 'index.handler',
    })
    table.grant(eventFunction, 'dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:UpdateItem')
    secret.grantRead(eventFunction)
    const api = new apigateway.HttpApi(this, 'EventApi', {
      defaultIntegration: new HttpLambdaIntegration('Hono', eventFunction),
    })
    new cdk.CfnOutput(this, 'EventEndpointUrl', { value: api.apiEndpoint })

    if (process.env.BENCH_INCLUDE_ECS !== '1') return
    const vpc = new ec2.Vpc(this, 'BenchmarkVpc', {
      availabilityZones: ['ap-northeast-1a', 'ap-northeast-1c'],
      natGateways: 0,
    })
    const cluster = new ecs.Cluster(this, 'BenchmarkCluster', { vpc })
    const service = new patterns.ApplicationLoadBalancedFargateService(this, 'ContainerService', {
      cluster,
      assignPublicIp: true,
      taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      publicLoadBalancer: true,
      openListener: true,
      desiredCount: 1,
      cpu: 1024,
      memoryLimitMiB: 2048,
      circuitBreaker: { rollback: true },
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset(fileURLToPath(new URL('../build/container/', import.meta.url)), {
          platform: ecrAssets.Platform.LINUX_ARM64,
        }),
        containerPort: 3000,
        environment: { ...environment, AWS_REGION: this.region, AWS_LAMBDA_HTTP_ENDPOINT: '0.0.0.0:3000' },
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: 'benchmark', logRetention: logs.RetentionDays.ONE_DAY }),
      },
    })
    table.grant(service.taskDefinition.taskRole, 'dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:UpdateItem')
    secret.grantRead(service.taskDefinition.taskRole)
    service.targetGroup.configureHealthCheck({ path: '/health', healthyHttpCodes: '200' })
    new cdk.CfnOutput(this, 'ContainerEndpointUrl', { value: `http://${service.loadBalancer.loadBalancerDnsName}` })
  }
}
