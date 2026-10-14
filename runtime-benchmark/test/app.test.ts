import { describe, expect, test } from 'bun:test'
import { hc } from 'hono/client'
import { app, type AppType } from '../src/app.js'

describe('original Hono API contracts', () => {
  test('returns health and the public profile through the typed client', async () => {
    const localFetch: typeof app.request = (input, init) => app.request(input, init)
    const client = hc<AppType>('http://local.test', {
      fetch: localFetch,
    })

    const health = await client.health.$get()
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ ok: true })

    const profile = await client.profile.$get()
    expect(profile.status).toBe(200)
    expect(await profile.json()).toEqual({
      name: 'Matt Enarle',
      handle: 'mattenarle10',
      focus: ['AWS', 'serverless', 'Hono', 'side projects'],
    })
  })

  test('exposes both route contracts in OpenAPI', async () => {
    const res = await app.request('/doc')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.openapi).toBe('3.0.0')
    expect(body.info.title).toBe('hono-serverless')
    expect(body.paths['/health'].get.responses['200']).toBeDefined()
    expect(body.paths['/profile'].get.responses['200']).toBeDefined()
  })

  test('serves Scalar HTML pointing at the relative OpenAPI URL', async () => {
    const res = await app.request('/scalar')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('/doc')
  })

  test('returns 404 for an unknown route', async () => {
    expect((await app.request('/missing')).status).toBe(404)
  })
})
