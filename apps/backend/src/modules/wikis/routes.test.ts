import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { aB2cUser, aUser, startApp } from '../../testing/app.ts'

let api: Awaited<ReturnType<typeof startApp>>
let baseUrl: string

beforeAll(async () => {
  api = await startApp()
  baseUrl = await api.listen()
})

afterAll(async () => {
  await api.close()
})

describe('GET /wikis', () => {
  it.each([
    ['a B2B user', aUser()],
    ['a B2C user, who has no organization', aB2cUser()]
  ])('lists no wiki yet for %s', async (_case, user) => {
    const response = await api.as(user).get('/wikis')

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([])
  })

  it('asks for a bearer token', async () => {
    const response = await fetch(`${baseUrl}/api/wikis`)

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe('Bearer')
  })
})
