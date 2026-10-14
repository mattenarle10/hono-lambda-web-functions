import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createApp } from '../src/app.js'
import { MemoryReadingList } from '../src/reading-list/store.js'
import { createReadingList, tokenMatches } from '../src/reading-list/runtime.js'

const token = randomUUID()
function setup() {
  return createApp({ store: new MemoryReadingList(), authorize: async (value) => tokenMatches(value, token) })
}
function request(app: ReturnType<typeof createApp>, path: string, method = 'GET', body?: unknown, bearer: string = token) {
  return app.request(path, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
const input = { title: 'Hono docs', url: 'https://hono.dev/docs/getting-started/nodejs' }

describe('reading-list workflow', () => {
  test('saves, lists, and marks a link read without changing its identity', async () => {
    const app = setup()
    const saved = await request(app, '/bookmarks', 'POST', input)
    expect(saved.status).toBe(201)
    const item = await saved.json()
    expect(item).toMatchObject({ ...input, status: 'unread' })
    expect(item.expiresAt).toBeGreaterThan(Date.now() / 1000)
    const list = await request(app, '/bookmarks')
    expect(await list.json()).toEqual({ items: [item], nextCursor: null })
    const read = await request(app, `/bookmarks/${item.id}/read`, 'PATCH')
    expect(read.status).toBe(200)
    expect(await read.json()).toEqual({ ...item, status: 'read' })
    expect((await (await request(app, '/bookmarks')).json()).items[0].status).toBe('read')
  })

  test('rejects every list operation before storage without a valid token', async () => {
    const app = setup()
    for (const [path, method] of [['/bookmarks', 'GET'], ['/bookmarks', 'POST'], [`/bookmarks/${randomUUID()}/read`, 'PATCH']]) {
      expect((await app.request(path, { method })).status).toBe(401)
      expect((await request(app, path, method, undefined, 'wrong')).status).toBe(401)
    }
    expect((await request(app, '/bookmarks')).headers.get('Cache-Control')).toBe('no-store')
  })

  test('rejects invalid URLs, empty titles, extra fields, malformed IDs and cursors', async () => {
    const app = setup()
    for (const body of [{ ...input, url: 'file:///etc/passwd' }, { ...input, url: 'https://' }, { ...input, title: ' ' }, { ...input, title: 'x'.repeat(121) }, { ...input, status: 'read' }]) {
      expect((await request(app, '/bookmarks', 'POST', body)).status).toBe(400)
    }
    expect((await request(app, '/bookmarks/not-a-uuid/read', 'PATCH')).status).toBe(400)
    expect((await request(app, '/bookmarks?cursor=garbage')).status).toBe(400)
    expect((await request(app, '/bookmarks', 'POST', { ...input, title: 'x'.repeat(5000) })).status).toBe(413)
    expect((await (await request(app, '/bookmarks')).json()).items).toEqual([])
  })

  test('returns 404 for a missing link and never creates it during an update', async () => {
    const app = setup()
    expect((await request(app, `/bookmarks/${randomUUID()}/read`, 'PATCH')).status).toBe(404)
    expect((await (await request(app, '/bookmarks')).json()).items).toEqual([])
  })

  test('paginates concurrent writes without losing or duplicating links', async () => {
    const app = setup()
    const saved = await Promise.all(Array.from({ length: 25 }, (_, i) => request(app, '/bookmarks', 'POST', { ...input, title: `Link ${i}` })))
    expect(saved.every((response) => response.status === 201)).toBe(true)
    const first = await (await request(app, '/bookmarks')).json()
    expect(first.items).toHaveLength(20)
    const second = await (await request(app, `/bookmarks?cursor=${first.nextCursor}`)).json()
    expect(second.items).toHaveLength(5)
    expect(second.nextCursor).toBeNull()
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(25)
  })

  test('documents bearer authentication and the whole workflow in Scalar OpenAPI', async () => {
    const spec = await (await setup().request('/doc')).json()
    expect(spec.paths['/bookmarks'].post.security).toEqual([{ ReadingListToken: [] }])
    expect(spec.paths['/bookmarks'].get).toBeDefined()
    expect(spec.paths['/bookmarks/{id}/read'].patch).toBeDefined()
    expect(spec.components.securitySchemes.ReadingListToken.scheme).toBe('bearer')
  })

  test('fails closed when storage or authorization is unavailable', async () => {
    expect((await request(createApp(), '/bookmarks')).status).toBe(503)
    const app = createApp({ store: new MemoryReadingList(), authorize: async () => { throw new Error('private service details') } })
    const response = await request(app, '/bookmarks')
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('private service details')
  })

  test('local memory mode needs an explicit token and cannot override cloud storage', () => {
    expect(() => createReadingList({ READING_LIST_MODE: 'memory' })).toThrow()
    expect(() => createReadingList({ READING_LIST_MODE: 'memory', DEMO_API_TOKEN: token, READING_LIST_TABLE: 'table' })).toThrow()
    expect(() => createReadingList({ READING_LIST_TABLE: 'table' })).toThrow()
    expect(createReadingList({})).toBeUndefined()
    expect(createReadingList({ READING_LIST_MODE: 'memory', DEMO_API_TOKEN: token })).toBeDefined()
    expect(tokenMatches('', token)).toBe(false)
    expect(tokenMatches('x'.repeat(257), token)).toBe(false)
  })
})
