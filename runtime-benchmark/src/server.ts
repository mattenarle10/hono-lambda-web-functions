import { serve } from '@hono/node-server'
import { app } from './benchmark-app.js'

const [hostname, port] = (
  process.env.AWS_LAMBDA_HTTP_ENDPOINT ?? '127.0.0.1:3000'
).split(':')

const server = serve(
  {
    fetch: app.fetch,
    hostname,
    port: Number(port),
  },
  (info) => {
    console.log(`listening on http://${hostname}:${info.port}`)
  }
)

process.on('SIGTERM', () => {
  server.close((error) => {
    process.exit(error ? 1 : 0)
  })
})

process.on('SIGINT', () => {
  server.close((error) => {
    process.exit(error ? 1 : 0)
  })
})
