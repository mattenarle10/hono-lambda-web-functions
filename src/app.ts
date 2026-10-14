import { OpenAPIHono } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'
import { healthRoutes } from './routes/health.js'
import { profileRoutes } from './routes/profile.js'
import { bookmarkRoutes } from './routes/bookmarks.js'
import type { ReadingList } from './reading-list/store.js'

export function createApp(readingList?: ReadingList) {
  const app = new OpenAPIHono()
  const routes = app
    .route('/', healthRoutes)
    .route('/', profileRoutes)
    .route('/', bookmarkRoutes(readingList))

  app.doc('/doc', {
    openapi: '3.0.0',
    info: { title: 'hono-serverless', version: '0.2.0' },
  })
  app.get('/scalar', Scalar({ url: '/doc' }))
  return routes
}

export type AppType = ReturnType<typeof createApp>
export const app = createApp()
