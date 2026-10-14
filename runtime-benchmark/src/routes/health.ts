import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  responses: {
    200: {
      description: 'Health check',
      content: {
        'application/json': {
          schema: z.object({
            ok: z.boolean(),
          }),
        },
      },
    },
  },
})

export const healthRoutes = new OpenAPIHono().openapi(healthRoute, (c) => {
  return c.json({ ok: true }, 200)
})
