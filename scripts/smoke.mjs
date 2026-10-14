import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

assert.equal(process.versions.node.split('.')[0], '24', 'Run the smoke check with Node.js 24')

const root = fileURLToPath(new URL('../', import.meta.url))
const assembly = join(root, 'cdk.out')
const template = JSON.parse(await readFile(join(assembly, 'HonoLambdaWebDirectStack.template.json'), 'utf8'))
const revision = Object.values(template.Resources).find((item) => item.Type === 'AWS::Lambda::WebFunctionRevision')
const key = revision.Properties.BuildConfig.CodeConfig.S3Object.Key.split('/').at(-1)
const manifest = JSON.parse(await readFile(join(assembly, 'HonoLambdaWebDirectStack.assets.json'), 'utf8'))
const assets = Object.values(manifest.files).filter((item) =>
  Object.values(item.destinations).some((destination) => destination.objectKey === key)
)
assert.equal(assets.length, 1, 'Expected one CDK asset supplying the Web Function code')
assert.equal(assets[0].source.packaging, 'zip')
const assetDirectory = resolve(assembly, assets[0].source.path)
const files = await readdir(assetDirectory)
assert.deepEqual(files.sort(), ['index.js', 'package.json'])

const directory = await mkdtemp(join(tmpdir(), 'hono-lambda-web-smoke-'))
let child
const demoToken = randomUUID()

try {
  for (const name of files) {
    await copyFile(join(assetDirectory, name), join(directory, name))
  }

  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const { port } = reservation.address()
  await new Promise((resolve, reject) => {
    reservation.close((error) => (error ? reject(error) : resolve()))
  })

  const address = `127.0.0.1:${port}`
  child = spawn(process.execPath, ['index.js'], {
    cwd: directory,
    env: { PATH: process.env.PATH, AWS_LAMBDA_HTTP_ENDPOINT: address, READING_LIST_MODE: 'memory', DEMO_API_TOKEN: demoToken },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  await new Promise((resolve, reject) => {
    let output = ''
    let errors = ''
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${errors}`)), 10000)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`Server exited during startup (${code}): ${errors}`))
    })
    child.stderr.on('data', (chunk) => { errors += chunk.toString() })
    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
      if (output.includes(`listening on http://${address}`)) {
        clearTimeout(timer)
        resolve()
      }
    })
  })

  const get = (path) => fetch(`http://${address}${path}`, {
    signal: AbortSignal.timeout(5000),
  })
  const health = await get('/health')
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { ok: true })

  const profile = await get('/profile')
  assert.equal(profile.status, 200)
  assert.deepEqual(await profile.json(), {
    name: 'Matt Enarle',
    handle: 'mattenarle10',
    focus: ['AWS', 'serverless', 'Hono', 'side projects'],
  })

  const doc = await get('/doc')
  assert.equal(doc.status, 200)
  const spec = await doc.json()
  assert.equal(spec.openapi, '3.0.0')
  assert.ok(spec.paths['/health'].get)
  assert.ok(spec.paths['/profile'].get)

  const scalar = await get('/scalar')
  assert.equal(scalar.status, 200)
  assert.match(scalar.headers.get('content-type'), /text\/html/)
  assert.match(await scalar.text(), /\/doc/)
  assert.equal((await get('/missing')).status, 404)

  await Promise.all(Array.from({ length: 8 }, async () => {
    const response = await get('/health')
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
  }))

  assert.equal((await get('/bookmarks')).status, 401)
  const bookmarkRequest = (path, method = 'GET', body) => fetch(`http://${address}${path}`, {
    method,
    headers: { Authorization: `Bearer ${demoToken}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  })
  const saved = await bookmarkRequest('/bookmarks', 'POST', {
    title: 'Hono docs', url: 'https://hono.dev/docs/getting-started/nodejs',
  })
  assert.equal(saved.status, 201)
  const item = await saved.json()
  const list = await bookmarkRequest('/bookmarks')
  assert.deepEqual((await list.json()).items, [item])
  const marked = await bookmarkRequest(`/bookmarks/${item.id}/read`, 'PATCH')
  assert.equal(marked.status, 200)
  assert.equal((await marked.json()).status, 'read')
  assert.ok(spec.paths['/bookmarks'].post.security)
  assert.ok(spec.paths['/bookmarks/{id}/read'].patch)

  console.log('Reading-list staged-server smoke passed: unauthorized, save, list, mark read (local memory only)')
  console.log(`CDK-staged server passed under Node.js ${process.versions.node}: supplied address, four routes, 404, eight concurrent requests`)
} finally {
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    const stopped = once(child, 'exit')
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    child.kill('SIGTERM')
    await stopped
    clearTimeout(timer)
  }
  await rm(directory, { recursive: true, force: true })
}
