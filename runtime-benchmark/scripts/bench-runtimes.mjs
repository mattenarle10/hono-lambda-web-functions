import assert from 'node:assert/strict'
import http from 'node:http'
import https from 'node:https'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'

assert.equal(process.versions.node.split('.')[0], '24')
const config = JSON.parse(await readFile(process.env.BENCH_CONFIG, 'utf8'))
const labels = ['web-function', 'api-gateway-lambda', 'ecs-fargate']
const endpoints = labels.map((label) => {
  const url = new URL(config[label])
  assert.ok(!url.username && !url.password && !url.search)
  if (label === 'ecs-fargate') {
    assert.equal(url.protocol, 'http:')
    assert.ok(url.hostname.endsWith('.ap-northeast-1.elb.amazonaws.com'))
  } else {
    assert.equal(url.protocol, 'https:')
    assert.ok(label === 'web-function'
      ? url.hostname.endsWith('.lambda-web.ap-northeast-1.on.aws')
      : url.hostname.endsWith('.execute-api.ap-northeast-1.amazonaws.com'))
  }
  return url
})
const output = process.env.BENCH_OUTPUT
assert.ok(output)
const results = {
  recordedAt: new Date().toISOString(),
  region: 'ap-northeast-1',
  client: { node: process.version, platform: process.platform, arch: process.arch },
  method: {
    rounds: 3, concurrencyCaps: [1, 8, 16], samplesPerPhase: 100,
    warmupRequestsPerPhase: 10, scheduledStartsPerSecond: 40, keepAlive: true,
    routes: ['/health', '/bench/read-only-fixture'], fixtureRecords: 20,
    platformOrder: 'Rotates each round to reduce time-order bias',
    authenticationMeasured: false, verifiedColdStarts: false, costMeasured: false,
    physicalClientLocationControlled: false, includesNetworkAndBodyRead: true,
    caveats: [
      'ECS uses HTTP; Lambda paths use HTTPS. This compares native end-to-end paths, not isolated runtime latency.',
      'Memory is configured at 2 GiB across paths; CPU and scaling settings differ and are reported separately.',
      'Database route reads synthetic fixture records, bypassing token authentication on all three paths.',
      'Warmup is not proof that every measured request was warm. No capacity-limit claim.',
    ],
  },
  phases: [],
}
const pct = (values, fraction) => {
  const sorted = values.toSorted((a, b) => a - b)
  return sorted.length ? +sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)].toFixed(2) : null
}
function request(url, agent, fixture) {
  const start = performance.now()
  const transport = url.protocol === 'https:' ? https : http
  return new Promise((resolve) => {
    const req = transport.get(url, { agent, headers: { accept: 'application/json' } }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        let matches = false
        try {
          const parsed = JSON.parse(body)
          matches = fixture
            ? parsed.items?.length === 20 && parsed.items.every((item) => item.title === 'Synthetic benchmark fixture')
            : parsed.ok === true && Object.keys(parsed).length === 1
        } catch {}
        resolve({
          status: response.statusCode, matches, ms: performance.now() - start,
          reused: req.reusedSocket, instance: response.headers['x-benchmark-instance'],
          node: response.headers['x-benchmark-node'], arch: response.headers['x-benchmark-arch'],
        })
      })
      response.on('error', () => resolve({ status: 'response-error', ms: performance.now() - start }))
    })
    req.setTimeout(15000, () => req.destroy(new Error('timeout')))
    req.on('error', (error) => resolve({ status: error.code ?? 'request-error', ms: performance.now() - start }))
  })
}
async function phase(url, agent, count, concurrency, fixture) {
  const start = performance.now()
  let cursor = 0
  const samples = []
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < count) {
      const i = cursor++
      const remaining = start + i * 25 - performance.now()
      if (remaining > 0) await delay(remaining)
      samples[i] = await request(url, agent, fixture)
    }
  }))
  return { samples, seconds: (performance.now() - start) / 1000 }
}
await mkdir(output, { recursive: true })
for (let round = 0; round < 3; round++) {
  for (const route of results.method.routes) {
    for (const concurrency of results.method.concurrencyCaps) {
      for (let offset = 0; offset < 3; offset++) {
        const index = (round + offset) % 3
        const label = labels[index]
        const url = new URL(route, endpoints[index])
        const fixture = route !== '/health'
        const Agent = url.protocol === 'https:' ? https.Agent : http.Agent
        const agent = new Agent({ keepAlive: true, maxSockets: concurrency })
        try {
          const warmup = await phase(url, agent, 10, concurrency, fixture)
          assert.ok(warmup.samples.every((s) => s.status === 200 && s.matches), `${label} warmup failed`)
          const { samples, seconds } = await phase(url, agent, 100, concurrency, fixture)
          const ok = samples.filter((s) => s.status === 200 && s.matches)
          const durations = ok.map((s) => s.ms)
          results.phases.push({
            round: round + 1, label, route, protocol: url.protocol, concurrencyCap: concurrency,
            n: samples.length, failed: samples.length - ok.length,
            elapsedSeconds: +seconds.toFixed(3), completedRequestsPerSecond: +(ok.length / seconds).toFixed(2),
            p50Ms: pct(durations, 0.5), p95Ms: pct(durations, 0.95), p99Ms: pct(durations, 0.99),
            observedNodeVersions: [...new Set(samples.map((s) => s.node).filter(Boolean))],
            observedArchitectures: [...new Set(samples.map((s) => s.arch).filter(Boolean))],
            distinctServerProcesses: new Set(samples.map((s) => s.instance).filter(Boolean)).size,
            samples: samples.map(({ instance, node, arch, ...s }) => s),
          })
          console.log(`${label} ${route} round=${round + 1} concurrency=${concurrency}: ${ok.length}/100 OK p95=${pct(durations, 0.95)}ms`)
          await writeFile(`${output}/samples.json`, JSON.stringify(results, null, 2) + '\n')
        } finally { agent.destroy() }
      }
    }
  }
}
const summary = []
for (const label of labels) for (const route of results.method.routes) for (const concurrency of results.method.concurrencyCaps) {
  const phases = results.phases.filter((p) => p.label === label && p.route === route && p.concurrencyCap === concurrency)
  const successes = phases.flatMap((p) => p.samples).filter((s) => s.status === 200 && s.matches).map((s) => s.ms)
  summary.push({ label, route, concurrencyCap: concurrency, n: phases.reduce((n, p) => n + p.n, 0), failed: phases.reduce((n, p) => n + p.failed, 0), p50Ms: pct(successes, 0.5), p95Ms: pct(successes, 0.95), p99Ms: pct(successes, 0.99) })
}
await writeFile(`${output}/summary.json`, JSON.stringify({ recordedAt: results.recordedAt, method: results.method, summary }, null, 2) + '\n')
assert.ok(summary.every((r) => r.failed === 0), 'Failed requests recorded; inspect before claiming success')
