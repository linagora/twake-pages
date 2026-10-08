import { describe, expect, it, vi } from 'vitest'

import { httpPagesApi, type Send } from '@/adapters/http/httpPagesApi'
import { ApiError } from '@/application/pages'

function backend(status: number, body?: unknown) {
  return vi.fn<Send>(() =>
    Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
      })
    )
  )
}

const BASE = 'https://pages.example.com'

describe('httpPagesApi', () => {
  it('lists wikis from /api/wikis', async () => {
    const send = backend(200, [{ id: 'w1', name: 'Handbook' }])

    const wikis = await httpPagesApi(BASE, send).listWikis()

    expect(wikis).toEqual([{ id: 'w1', name: 'Handbook' }])
    const [request] = send.mock.calls[0] ?? []
    expect(request?.method).toBe('GET')
    expect(request?.url).toBe(`${BASE}/api/wikis`)
  })

  it("reads the person's settings from /api/settings", async () => {
    const settings = {
      version: 2,
      language: 'fr',
      timezone: null,
      theme: 'dark',
      avatar: null,
      name: null
    }
    const send = backend(200, settings)

    await expect(httpPagesApi(BASE, send).settings()).resolves.toEqual(settings)
    const [request] = send.mock.calls[0] ?? []
    expect(request?.url).toBe(`${BASE}/api/settings`)
  })

  it('rejects with the status and code the backend refused with', async () => {
    const send = backend(403, { error: 'forbidden' })

    await expect(httpPagesApi(BASE, send).listWikis()).rejects.toEqual(
      new ApiError(403, 'forbidden')
    )
  })

  it('rejects without a code when the answer has no body', async () => {
    const send = backend(502)

    await expect(httpPagesApi(BASE, send).listWikis()).rejects.toEqual(
      new ApiError(502, null)
    )
  })

  it("reads the versions of the person's settings from their stream, across chunks", async () => {
    const encoder = new TextEncoder()
    const chunks = [
      'id: 4\ndata: {"version":4}\n\n:\n\nid: 5\nda',
      'ta: {}\n\n'
    ]
    const send = vi.fn<Send>(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              for (const chunk of chunks)
                controller.enqueue(encoder.encode(chunk))
            }
          }),
          { headers: { 'content-type': 'text/event-stream' } }
        )
      )
    )
    const versions: number[] = []

    const stop = httpPagesApi(BASE, send).watchSettings(version => {
      versions.push(version)
    })

    await vi.waitFor(() => {
      expect(versions).toEqual([4, 5])
    })
    stop()
    const [request] = send.mock.calls[0] ?? []
    expect(request?.url).toBe(`${BASE}/api/settings/events`)
  })
})
