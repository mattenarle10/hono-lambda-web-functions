import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { createApp } from './app.js'
import { createReadingList } from './reading-list/runtime.js'

const readingList = createReadingList(process.env)
const instance = randomUUID()
export const app = new Hono()
app.use('*', async (context, next) => {
  await next()
  context.header('x-benchmark-instance', instance)
  context.header('x-benchmark-node', process.version)
  context.header('x-benchmark-arch', process.arch)
  context.header('cache-control', 'no-store')
})
// This isolated experiment contains synthetic fixtures only. No token travels over the HTTP ALB path.
app.get('/bench/read-only-fixture', async (context) => {
  if (!readingList) return context.json({ error: 'Fixture storage is not configured' }, 503)
  return context.json(await readingList.store.list())
})
app.route('/', createApp(readingList))
