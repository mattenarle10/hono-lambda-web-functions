import * as cdk from 'aws-cdk-lib'
import { ComparisonStack } from '../lib/comparison-stack.js'

const account = process.env.CDK_DEPLOY_ACCOUNT
if (!account || !/^\d{12}$/.test(account)) {
  throw new Error(
    'Set CDK_DEPLOY_ACCOUNT explicitly. Use 111122223333 for offline synth only.'
  )
}

const region = process.env.CDK_DEPLOY_REGION ?? 'ap-northeast-1'
if (region !== 'ap-northeast-1') throw new Error('This benchmark is scoped to Tokyo')
const app = new cdk.App({
  context: {
    [`availability-zones:account=${account}:region=${region}`]: ['ap-northeast-1a', 'ap-northeast-1c'],
  },
})
new ComparisonStack(app, 'HonoRuntimeBenchmarkStack', {
  env: {
    account,
    region,
  },
})
