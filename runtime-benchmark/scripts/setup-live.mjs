import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const profile = process.env.AWS_PROFILE
const expectedAccount = process.env.EXPECTED_BENCH_ACCOUNT
const output = process.env.BENCH_CONFIG
assert.ok(profile && /^\d{12}$/.test(expectedAccount ?? '') && output?.endsWith('.local.json'))
const aws = (args, input) => execFileSync('aws', [
  ...args, '--profile', profile, '--region', 'ap-northeast-1', '--output', 'json',
], { encoding: 'utf8', input })
const identity = JSON.parse(aws(['sts', 'get-caller-identity']))
assert.equal(identity.Account, expectedAccount, 'Wrong sandbox account; nothing seeded')
const response = JSON.parse(execFileSync('cdkd', [
  'state', 'show', 'HonoRuntimeBenchmarkStack', '--json',
  '--state-prefix', 'hono-runtime-benchmark', '--profile', profile,
], { encoding: 'utf8' }))
const { state } = response
assert.equal(state.stackName, 'HonoRuntimeBenchmarkStack')
assert.equal(state.region, 'ap-northeast-1')
const values = state.outputs
const table = values.ReadingListTableName
assert.ok(table.startsWith('HonoRuntimeBenchmarkStack-'))
const items = Array.from({ length: 20 }, (_, index) => {
  const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
  const item = Object.fromEntries(Object.entries({
    pk: 'reading-list', sk: id, id, title: 'Synthetic benchmark fixture',
    url: 'https://example.com/docs', status: 'unread', createdAt: new Date().toISOString(),
  }).map(([key, value]) => [key, { S: value }]))
  item.expiresAt = { N: String(Math.floor(Date.now() / 1000) + 86400) }
  return { PutRequest: { Item: item } }
})
const written = JSON.parse(aws(['dynamodb', 'batch-write-item', '--request-items', 'file:///dev/stdin'], JSON.stringify({ [table]: items })))
assert.equal(Object.keys(written.UnprocessedItems ?? {}).length, 0, 'Fixture writes incomplete')
const config = {
  'web-function': values.EndpointUrl,
  'api-gateway-lambda': values.EventEndpointUrl,
  'ecs-fargate': values.ContainerEndpointUrl,
}
writeFileSync(output, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
const versions = new Set()
for (const [label, endpoint] of Object.entries(config)) {
  for (const route of ['/health', '/bench/read-only-fixture']) {
    const result = await fetch(new URL(route, endpoint), { signal: AbortSignal.timeout(20000) })
    assert.equal(result.status, 200, `${label} ${route}`)
    const body = await result.json()
    if (route === '/health') assert.deepEqual(body, { ok: true })
    else assert.equal(body.items?.length, 20)
    assert.equal(result.headers.get('x-benchmark-arch'), 'arm64')
    const version = result.headers.get('x-benchmark-node')
    assert.ok(version?.startsWith('v24.'))
    versions.add(version)
    console.log(`${label} ${route}: contract passed (${version}, ARM64)`)
  }
}
assert.equal(versions.size, 1, 'Match server Node.js patches before running benchmarks')
console.log('Prepared synthetic fixtures and private endpoint configuration. No secret token retrieved.')
