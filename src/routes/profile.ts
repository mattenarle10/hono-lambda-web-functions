import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'

const profileRoute = createRoute({
  method: 'get',
  path: '/profile',
  responses: {
    200: {
      description: 'Public profile',
      content: {
        'application/json': {
          schema: z.object({
            name: z.string(),
            handle: z.string(),
            focus: z.array(z.string()),
          }),
        },
      },
    },
  },
})

export const profileRoutes = new OpenAPIHono().openapi(profileRoute, (c) => {
  return c.json(
    {
      name: 'Matt Enarle',
      handle: 'mattenarle10',
      focus: ['AWS', 'serverless', 'Hono', 'side projects'],
    },
    200
  )
})
