import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import * as cdk from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { WebStack } from '../lib/web-stack.js'

const app = new cdk.App()
const stack = new WebStack(app, 'TestWebStack', {
  env: { account: '111122223333', region: 'ap-northeast-1' },
})
const template = Template.fromStack(stack)
const [revision] = Object.values(template.findResources('AWS::Lambda::WebFunctionRevision'))
const codeKey = revision.Properties.BuildConfig.CodeConfig.S3Object.Key as string
const codeFilename = codeKey.split('/').at(-1)!
const codePrefix = codeKey.slice(0, codeKey.lastIndexOf('/'))
const [revisionLogicalId] = Object.keys(template.findResources('AWS::Lambda::WebFunctionRevision'))

describe('Web Function infrastructure', () => {
  test('uses persisted demo data and a generated secret with scoped runtime access', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1)
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
      KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }],
    })
    const [tableId] = Object.keys(template.findResources('AWS::DynamoDB::Table'))
    const [secretId] = Object.keys(template.findResources('AWS::SecretsManager::Secret'))
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      GenerateSecretString: { PasswordLength: 40, ExcludePunctuation: true },
    })
    template.hasResourceProperties('AWS::Lambda::WebFunctionRevision', {
      ServiceConfig: {
        EnvironmentVariables: {
          READING_LIST_TABLE: { Ref: tableId },
          READING_LIST_TOKEN_SECRET_ARN: { Ref: secretId },
        },
      },
    })
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: { Statement: Match.arrayWith([
        Match.objectLike({ Action: ['dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:UpdateItem'], Resource: { 'Fn::GetAtt': [tableId, 'Arn'] } }),
        Match.objectLike({ Action: 'secretsmanager:GetSecretValue', Resource: { Ref: secretId } }),
      ]) },
    })
    const serialized = JSON.stringify(template.toJSON())
    expect(serialized).not.toContain('DEMO_API_TOKEN')
    expect(template.toJSON().Resources[secretId].Properties.SecretString).toBeUndefined()
    expect(template.toJSON().Resources[tableId].DeletionPolicy).toBe('Delete')
  })

  test('uses the HTTP-native resources and routes traffic to this revision', () => {
    template.resourceCountIs('AWS::Lambda::WebFunction', 1)
    template.resourceCountIs('AWS::Lambda::WebFunctionRevision', 1)
    expect(revisionLogicalId).toContain(codeFilename.slice(0, 12))
    template.resourceCountIs('AWS::Lambda::WebFunctionEndpoint', 1)
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 0)

    const [revisionId] = Object.keys(
      template.findResources('AWS::Lambda::WebFunctionRevision')
    )
    const [logGroupId] = Object.keys(template.findResources('AWS::Logs::LogGroup'))
    template.hasResourceProperties('AWS::Lambda::WebFunctionEndpoint', {
      AuthType: 'ApplicationManaged',
      EndpointType: 'HomeRegion',
      RevisionWeights: [
        { RevisionId: { 'Fn::GetAtt': [revisionId, 'RevisionId'] }, Weight: 100 },
      ],
      ScalingConfig: { MaxEnvironments: 2 },
      ThrottleConfig: { RateLimit: Match.anyValue() },
    })
    const [endpoint] = Object.values(
      template.findResources('AWS::Lambda::WebFunctionEndpoint')
    )
    // Service constraint: positive rates use 100-RPS steps up to 1,000,
    // then 1,000-RPS steps up to 10,000. Zero disables the endpoint.
    const rate = endpoint.Properties.ThrottleConfig.RateLimit
    expect(rate).toBeGreaterThanOrEqual(100)
    expect(rate).toBeLessThanOrEqual(10000)
    expect(rate % (rate <= 1000 ? 100 : 1000)).toBe(0)
    template.hasResourceProperties('AWS::Lambda::WebFunctionRevision', {
      BuildConfig: {
        CodeConfig: { S3Object: { Key: Match.stringLikeRegexp('^packages/[a-f0-9]{64}/[a-f0-9]{64}\\.zip$') } },
        RuntimeConfig: { Runtime: 'nodejs24.x' },
      },
      ServiceConfig: {
        TimeoutSeconds: 10,
        MaxConcurrencyPerEnvironment: 16,
        TelemetryConfig: {
          LoggingConfig: { LogGroup: { Ref: logGroupId } },
        },
      },
    })
  })

  test('keeps code private and versioned with a scoped Lambda read policy', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      VersioningConfiguration: { Status: 'Enabled' },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    })
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Principal: { Service: 'lambda.amazonaws.com' },
            Action: ['s3:GetObject', 's3:GetObjectVersion'],
            Resource: {
              'Fn::Join': ['', Match.arrayWith(['/packages/*'])],
            },
            Condition: {
              ArnLike: {
                'aws:SourceArn': Match.anyValue(),
              },
            },
          }),
        ]),
      },
    })

    const policy = JSON.stringify(template.findResources('AWS::S3::BucketPolicy'))
    expect(policy).toContain('web-function/hono-lambda-web-direct-poc/revision/*')
  })

  test('copies the CDK asset intact and waits for its upload and bucket policy', () => {
    const [revision] = Object.values(
      template.findResources('AWS::Lambda::WebFunctionRevision')
    )
    const [uploadId] = Object.keys(
      template.findResources('Custom::CDKBucketDeployment')
    )
    const [policyId] = Object.keys(template.findResources('AWS::S3::BucketPolicy'))
    expect(revision.DependsOn).toContain(uploadId)
    expect(revision.DependsOn).toContain(policyId)
    template.hasResourceProperties('Custom::CDKBucketDeployment', {
      SourceObjectKeys: [codeFilename],
      DestinationBucketKeyPrefix: codePrefix,
      Extract: false,
      Prune: false,
      RetainOnDelete: true,
    })
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      RetentionInDays: 7,
    })
    template.hasOutput('EndpointUrl', {
      Value: Match.anyValue(),
    })
  })

  test('stages only the bundled server and CommonJS metadata for CDK packaging', () => {
    const assembly = app.synth()
    const manifest = JSON.parse(readFileSync(resolve(assembly.directory, 'TestWebStack.assets.json'), 'utf8'))
    const files = Object.values(manifest.files) as Array<{
      source: { path: string; packaging: string }
      destinations: Record<string, { objectKey: string }>
    }>
    const [code] = files.filter((asset) =>
      Object.values(asset.destinations).some((destination) => destination.objectKey === codeFilename)
    )
    expect(code.source.packaging).toBe('zip')
    const directory = resolve(assembly.directory, code.source.path)
    expect(readdirSync(directory).sort()).toEqual(['index.js', 'package.json'])
    expect(JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'))).toEqual({ type: 'commonjs' })
  })

  test('manages both log groups and scopes logging permissions to both', () => {
    template.resourceCountIs('AWS::Logs::LogGroup', 2)
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/aws/lambda/web/hono-lambda-web-direct-poc.local',
      RetentionInDays: 7,
    })
    const groupIds = Object.keys(template.findResources('AWS::Logs::LogGroup'))
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
            Resource: groupIds.map((id) => ({
              'Fn::Join': ['', [
                'arn:',
                { Ref: 'AWS::Partition' },
                ':logs:ap-northeast-1:111122223333:log-group:',
                { Ref: id },
                ':*',
              ]],
            })),
          }),
          Match.objectLike({
            Action: 'logs:CreateLogGroup',
            Resource: groupIds.map((id) => ({
              'Fn::Join': ['', [
                'arn:',
                { Ref: 'AWS::Partition' },
                ':logs:ap-northeast-1:111122223333:log-group:',
                { Ref: id },
              ]],
            })),
          }),
        ]),
      },
    })
  })
})
