import assert from 'node:assert/strict'
import https from 'node:https'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'

assert.equal(process.versions.node.split('.')[0], '24', 'Use Node.js 24 for comparable runs')
const endpoint = new URL(process.env.ENDPOINT_URL ?? '')
assert.equal(endpoint.protocol, 'https:')
assert.ok(endpoint.hostname.endsWith('.lambda-web.ap-northeast-1.on.aws'))
assert.ok(!endpoint.username && !endpoint.password)
const label = process.env.BENCH_LABEL
assert.ok(label && /^[a-z0-9_-]+$/.test(label), 'Set BENCH_LABEL')
const output = process.env.BENCH_OUTPUT
assert.ok(output, 'Set BENCH_OUTPUT to a sanitized results file')
const target = new URL('/health', endpoint)
const rateLimit = 50
const rounds = 3

function request(agent) {
  const started = performance.now()
  return new Promise((resolve) => {
    const req = https.get(target, { agent, headers: { accept: 'application/json' } }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        let contractMatches = false
        try { contractMatches = JSON.stringify(JSON.parse(body)) === '{"ok":true}' } catch {}
        resolve({
          status: res.statusCode,
          durationMs: performance.now() - started,
          contractMatches,
          reusedSocket: req.reusedSocket,
          stream: res.headers['lambda-web-logstream'],
        })
      })
      res.on('error', () => resolve({ status: 'response-error', durationMs: performance.now() - started }))
    })
    req.setTimeout(15000, () => req.destroy(new Error('request-timeout')))
    req.on('error', (error) => resolve({ status: error.code ?? 'request-error', durationMs: performance.now() - started }))
  })
}

async function runRequests(count, concurrency, agent) {
  let cursor = 0
  const results = []
  const started = performance.now()
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < count) {
      const index = cursor++
      const wait = started + index * (1000 / rateLimit) - performance.now()
      if (wait > 0) await delay(wait)
      results[index] = await request(agent)
    }
  }))
  return { results, elapsedSeconds: (performance.now() - started) / 1000 }
}

function percentile(values, fraction) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return Number(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)].toFixed(2))
}

const record = {
  label,
  recordedAt: new Date().toISOString(),
  region: 'ap-northeast-1',
  route: '/health',
  client: { node: process.version, platform: process.platform, arch: process.arch, configuredTimeZone: 'Asia/Manila' },
  method: { rounds, warmupRequestsPerPhase: 10, scheduledDispatchRatePerSecond: rateLimit, keepAlive: true, includesNetworkAndBodyRead: true, verifiedColdStarts: false },
  phases: [],
}

for (let round = 1; round <= rounds; round++) {
  for (const [concurrency, count] of [[1, 100], [8, 200]]) {
    const agent = new https.Agent({ keepAlive: true, maxSockets: concurrency })
    try {
      const warmup = await runRequests(10, concurrency, agent)
      assert.ok(warmup.results.every((r) => r.status === 200 && r.contractMatches), 'Warm-up failed')
      const { results, elapsedSeconds } = await runRequests(count, concurrency, agent)
      const successes = results.filter((r) => r.status === 200 && r.contractMatches)
      const durations = successes.map((r) => r.durationMs)
      const statuses = {}
      for (const result of results) statuses[result.status] = (statuses[result.status] ?? 0) + 1
      const phase = {
        round, concurrencyCap: concurrency, count, successful: successes.length,
        failed: count - successes.length, statuses,
        elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
        achievedRequestsPerSecond: Number((count / elapsedSeconds).toFixed(2)),
        p50Ms: percentile(durations, 0.50), p95Ms: percentile(durations, 0.95), p99Ms: percentile(durations, 0.99),
        reusedSockets: results.filter((r) => r.reusedSocket).length,
        distinctLogStreams: new Set(results.map((r) => r.stream).filter(Boolean)).size,
        samples: results.map(({ stream, ...sample }) => sample),
      }
      record.phases.push(phase)
      console.log(`${label}: round ${round}, concurrency cap ${concurrency}, ${successes.length}/${count} OK, p50=${phase.p50Ms}ms p95=${phase.p95Ms}ms p99=${phase.p99Ms}ms`)
    } finally { agent.destroy() }
  }
}
await mkdir(dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(record, null, 2) + '\n')
console.log('Saved measurements without endpoint, account, request, or log-stream identifiers')
assert.ok(record.phases.every((phase) => phase.failed === 0), 'Benchmark recorded failed requests; inspect results before comparing')
