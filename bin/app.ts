import * as cdk from 'aws-cdk-lib'
import { WebStack } from '../lib/web-stack.js'

const account = process.env.CDK_DEPLOY_ACCOUNT
if (!account || !/^\d{12}$/.test(account)) {
  throw new Error(
    'Set CDK_DEPLOY_ACCOUNT explicitly. Use 111122223333 for offline synth only.'
  )
}

const app = new cdk.App()
new WebStack(app, 'HonoLambdaWebStack', {
  env: {
    account,
    region: process.env.CDK_DEPLOY_REGION ?? 'ap-northeast-1',
  },
})
