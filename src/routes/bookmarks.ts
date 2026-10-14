import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { bodyLimit } from 'hono/body-limit'
import type { ReadingList } from '../reading-list/store.js'

const bookmark = z.object({
  id: z.string().uuid(),
  title: z.string(),
  url: z.string().url(),
  status: z.enum(['unread', 'read']),
  createdAt: z.string().datetime(),
  expiresAt: z.number().int(),
}).openapi('Bookmark')
const failure = z.object({ error: z.string() })
const json = (schema: z.ZodType, description: string) => ({
  description,
  content: { 'application/json': { schema } },
})
const errors = {
  401: json(failure, 'Missing or invalid bearer token'),
  503: json(failure, 'Reading list unavailable'),
}
const security = [{ ReadingListToken: [] }]

export function bookmarkRoutes(readingList?: ReadingList) {
  const router = new OpenAPIHono()
  router.openAPIRegistry.registerComponent('securitySchemes', 'ReadingListToken', {
    type: 'http', scheme: 'bearer', description: 'Single-owner demo token. Never share it publicly.',
  })
  router.use('/bookmarks', authenticate)
  router.use('/bookmarks/*', authenticate)
  router.use('/bookmarks', bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: 'Request body too large' }, 413) }))

  async function authenticate(c: Context, next: Next) {
    c.header('Cache-Control', 'no-store')
    const token = c.req.header('Authorization')?.match(/^Bearer ([^\s]{1,256})$/i)?.[1]
    if (!token) {
      c.header('WWW-Authenticate', 'Bearer')
      return c.json({ error: 'Unauthorized' }, 401)
    }
    if (!readingList) return c.json({ error: 'Reading list unavailable' }, 503)
    try {
      if (!await readingList.authorize(token)) {
        c.header('WWW-Authenticate', 'Bearer')
        return c.json({ error: 'Unauthorized' }, 401)
      }
    } catch {
      return c.json({ error: 'Reading list unavailable' }, 503)
    }
    await next()
  }

  router.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse()
    console.error('Reading list request failed:', error.name)
    return c.json({ error: 'Reading list unavailable' }, 503)
  })

  return router
    .openapi(createRoute({
      method: 'post', path: '/bookmarks', tags: ['Reading List'], security,
      summary: 'Save a link to read later',
      request: { body: { required: true, content: { 'application/json': { schema: z.object({
        title: z.string().trim().min(1).max(120).openapi({ example: 'Hono on Node.js' }),
        url: z.string().max(2048).url().refine((value) => {
          try { return ['http:', 'https:'].includes(new URL(value).protocol) }
          catch { return false }
        }, 'Use an HTTP or HTTPS URL').openapi({ example: 'https://hono.dev/docs/getting-started/nodejs' }),
      }).strict() } } } },
      responses: { 201: json(bookmark, 'Saved; expires after 24 hours'), 400: { description: 'Invalid input' }, 413: json(failure, 'Body exceeds 4 KiB'), ...errors },
    }), async (c) => c.json(await readingList!.store.create(c.req.valid('json')), 201))
    .openapi(createRoute({
      method: 'get', path: '/bookmarks', tags: ['Reading List'], security,
      summary: 'List saved links',
      request: { query: z.object({ cursor: z.string().uuid().optional() }) },
      responses: { 200: json(z.object({ items: z.array(bookmark), nextCursor: z.string().uuid().nullable() }), 'Up to 20 links; continue with nextCursor'), 400: { description: 'Invalid cursor' }, ...errors },
    }), async (c) => c.json(await readingList!.store.list(c.req.valid('query').cursor), 200))
    .openapi(createRoute({
      method: 'patch', path: '/bookmarks/{id}/read', tags: ['Reading List'], security,
      summary: 'Mark a saved link as read',
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: { 200: json(bookmark, 'Marked as read'), 400: { description: 'Invalid ID' }, 404: json(failure, 'Missing or expired link'), ...errors },
    }), async (c) => {
      const item = await readingList!.store.markRead(c.req.valid('param').id)
      return item ? c.json(item, 200) : c.json({ error: 'Bookmark not found' }, 404)
    })
}
