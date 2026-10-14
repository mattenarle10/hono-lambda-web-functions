import { handle } from 'hono/aws-lambda'
import { app } from './benchmark-app.js'

export const handler = handle(app)
