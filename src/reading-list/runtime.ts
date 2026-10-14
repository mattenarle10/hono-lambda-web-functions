import { createHash, timingSafeEqual } from 'node:crypto'
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { DynamoReadingList } from './dynamodb.js'
import { MemoryReadingList, type ReadingList } from './store.js'

export function tokenMatches(actual: string, expected: string) {
  if (!actual || actual.length > 256) return false
  const hash = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(hash(actual), hash(expected))
}

export function createReadingList(env: NodeJS.ProcessEnv): ReadingList | undefined {
  if (env.READING_LIST_MODE === 'memory') {
    if (env.READING_LIST_TABLE || env.READING_LIST_TOKEN_SECRET_ARN || env.AWS_LAMBDA_FUNCTION_NAME) {
      throw new Error('Memory mode is only for local development')
    }
    if (!env.DEMO_API_TOKEN) throw new Error('Memory mode requires a local DEMO_API_TOKEN')
    return {
      store: new MemoryReadingList(),
      authorize: async (token) => tokenMatches(token, env.DEMO_API_TOKEN!),
    }
  }

  if (!env.READING_LIST_TABLE || !env.READING_LIST_TOKEN_SECRET_ARN) {
    if (env.READING_LIST_TABLE || env.READING_LIST_TOKEN_SECRET_ARN) {
      throw new Error('Reading list requires both table and token secret configuration')
    }
    return undefined
  }

  const client = new SecretsManagerClient({})
  let cached: { token: string; until: number } | undefined
  let pending: Promise<string> | undefined
  async function getToken() {
    if (cached && Date.now() < cached.until) return cached.token
    if (!pending) {
      pending = client.send(new GetSecretValueCommand({ SecretId: env.READING_LIST_TOKEN_SECRET_ARN }))
        .then((result) => {
          if (!result.SecretString) throw new Error('Reading-list token is unavailable')
          cached = { token: result.SecretString, until: Date.now() + 60000 }
          return cached.token
        }).finally(() => { pending = undefined })
    }
    return pending
  }

  return {
    store: new DynamoReadingList(env.READING_LIST_TABLE),
    authorize: async (token) => tokenMatches(token, await getToken()),
  }
}
