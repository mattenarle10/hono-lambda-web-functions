import { fileURLToPath } from 'node:url'
import * as cdk from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3assets from 'aws-cdk-lib/aws-s3-assets'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import { Construct } from 'constructs'
import { bundleServer } from './bundle.js'

export class WebStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const code = new s3assets.Asset(this, 'ServerCode', {
      path: fileURLToPath(new URL('../src/', import.meta.url)),
      assetHashType: cdk.AssetHashType.OUTPUT,
      bundling: {
        image: lambda.Runtime.NODEJS_24_X.bundlingImage,
        outputType: cdk.BundlingOutput.NOT_ARCHIVED,
        local: {
          tryBundle(outputDirectory) {
            bundleServer(outputDirectory)
            return true
          },
        },
      },
    })
    const packagePrefix = `packages/${code.assetHash}`

    const webFunction = new lambda.CfnWebFunction(this, 'WebFunction', {
      functionName: 'hono-lambda-web-direct-poc',
      tags: [{ key: 'Environment', value: 'poc' }],
    })

    const logGroup = new logs.LogGroup(this, 'AppLogs', {
      logGroupName: '/aws/lambda/web/hono-lambda-web-direct-poc',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })
    const localLogGroup = new logs.LogGroup(this, 'LocalAppLogs', {
      logGroupName: '/aws/lambda/web/hono-lambda-web-direct-poc.local',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    const executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    })
    executionRole.addToPolicy(new iam.PolicyStatement({
      actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [logGroup, localLogGroup].map((group) => this.formatArn({
        service: 'logs',
        resource: 'log-group',
        resourceName: `${group.logGroupName}:*`,
        arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
      })),
    }))
    executionRole.addToPolicy(new iam.PolicyStatement({
      actions: ['logs:CreateLogGroup'],
      resources: [logGroup, localLogGroup].map((group) => this.formatArn({
        service: 'logs',
        resource: 'log-group',
        resourceName: group.logGroupName,
        arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
      })),
    }))

    const readingList = new dynamodb.Table(this, 'ReadingList', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })
    const readingListToken = new secretsmanager.Secret(this, 'ReadingListToken', {
      description: 'Single-owner reading-list POC bearer token',
      generateSecretString: { passwordLength: 40, excludePunctuation: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })
    executionRole.addToPolicy(new iam.PolicyStatement({
      actions: ['dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:UpdateItem'],
      resources: [readingList.tableArn],
    }))
    executionRole.addToPolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [readingListToken.secretArn],
    }))

    const codeBucket = new s3.Bucket(this, 'CodeBucket', {
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })

    codeBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal('lambda.amazonaws.com')],
        actions: ['s3:GetObject', 's3:GetObjectVersion'],
        resources: [codeBucket.arnForObjects('packages/*')],
        conditions: {
          ArnLike: {
            'aws:SourceArn': this.formatArn({
              service: 'lambda',
              resource: 'web-function',
              resourceName: `${webFunction.functionName}/revision/*`,
              arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
            }),
          },
        },
      })
    )

    // CDK packages the bundled directory. Keep that asset intact in the code bucket.
    const upload = new s3deploy.BucketDeployment(this, 'CodeUpload', {
      sources: [s3deploy.Source.bucket(code.bucket, code.s3ObjectKey)],
      destinationBucket: codeBucket,
      destinationKeyPrefix: packagePrefix,
      extract: false,
      prune: false,
      retainOnDelete: true,
    })

    // A distinct logical resource per bundle lets cdkd switch the endpoint before deleting the old revision.
    const revision = new lambda.CfnWebFunctionRevision(this, `Revision${code.assetHash.slice(0, 12)}`, {
      functionName: webFunction.functionName,
      buildConfig: {
        codeConfig: {
          s3Object: {
            bucket: codeBucket.bucketName,
            key: `${packagePrefix}/${code.s3ObjectKey}`,
          },
        },
        runtimeConfig: { runtime: 'nodejs24.x' },
      },
      serviceConfig: {
        executionRoleArn: executionRole.roleArn,
        environmentVariables: {
          READING_LIST_TABLE: readingList.tableName,
          READING_LIST_TOKEN_SECRET_ARN: readingListToken.secretArn,
        },
        timeoutSeconds: 10,
        maxConcurrencyPerEnvironment: 16,
        telemetryConfig: {
          loggingConfig: { logGroup: logGroup.logGroupName },
        },
      },
    })
    revision.addResourceDependency(webFunction)
    revision.node.addDependency(upload, codeBucket.policy!, executionRole, readingList, readingListToken)

    const endpoint = new lambda.CfnWebFunctionEndpoint(this, 'Endpoint', {
      functionName: webFunction.functionName,
      endpointName: 'dev',
      endpointType: 'HomeRegion',
      authType: 'ApplicationManaged',
      revisionWeights: [{ revisionId: revision.attrRevisionId, weight: 100 }],
      scalingConfig: { maxEnvironments: 2 },
      // Supported nonzero rate limits start at 100 requests per second.
      throttleConfig: { rateLimit: 100 },
    })

    new cdk.CfnOutput(this, 'ReadingListTableName', { value: readingList.tableName })
    new cdk.CfnOutput(this, 'ReadingListTokenSecretArn', { value: readingListToken.secretArn })
    new cdk.CfnOutput(this, 'EndpointUrl', {
      value: `https://${endpoint.attrDomainName}`,
    })
    new cdk.CfnOutput(this, 'WebFunctionName', {
      value: webFunction.functionName,
    })
    new cdk.CfnOutput(this, 'RevisionId', { value: revision.attrRevisionId })
    new cdk.CfnOutput(this, 'RevisionState', { value: revision.attrState })
    new cdk.CfnOutput(this, 'EndpointState', { value: endpoint.attrState })
    new cdk.CfnOutput(this, 'LogGroupName', { value: logGroup.logGroupName })
    new cdk.CfnOutput(this, 'LocalLogGroupName', { value: localLogGroup.logGroupName })
  }
}
