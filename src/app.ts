import { OpenAPIHono } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'
import { healthRoutes } from './routes/health.js'
import { profileRoutes } from './routes/profile.js'

const app = new OpenAPIHono()

const routes = app
  .route('/', healthRoutes)
  .route('/', profileRoutes)

app.doc('/doc', {
  openapi: '3.0.0',
  info: {
    title: 'hono-serverless',
    version: '0.1.0',
  },
})

app.get('/scalar', Scalar({ url: '/doc' }))

export type AppType = typeof routes
export { app }
