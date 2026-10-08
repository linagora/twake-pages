import { describe, expect, it, vi } from 'vitest'

import { httpPagesApi, type Send } from '@/adapters/http/httpPagesApi'
import { ApiError, type PagesApi, type Sharing } from '@/application/pages'
import type { TreePage } from '@/domain/page'
import type { Wiki, WikiSummary } from '@/domain/wiki'

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

function stream(chunks: string[]) {
  const encoder = new TextEncoder()
  return vi.fn<Send>(() =>
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
}

async function sent(request: Request) {
  return {
    method: request.method,
    url: request.url,
    contentType: request.headers.get('content-type'),
    body:
      request.body === null ? undefined : ((await request.json()) as unknown)
  }
}

const BASE = 'https://pages.example.com'

const summary: WikiSummary = {
  id: 'w1',
  name: 'Handbook',
  description: '',
  kind: 'shared',
  role: 'admin',
  homePageId: 'p0',
  unread: 0
}
const wiki: Wiki = { ...summary, version: 3 }
const treePage: TreePage = {
  id: 'p1',
  parentId: null,
  position: 'a0',
  title: 'Onboarding',
  kind: 'document'
}
const sharing: Sharing = {
  members: [
    {
      id: 'u1',
      email: 'alice@example.com',
      name: 'Alice Martin',
      role: 'admin',
      joinedAt: '2026-10-08T07:30:00.000Z'
    }
  ],
  invites: [
    {
      id: 'i1',
      email: 'bob@example.com',
      role: 'editor',
      createdAt: '2026-10-08T07:31:00.000Z'
    }
  ],
  managed: false
}

interface Exchange {
  call: (api: PagesApi) => Promise<unknown>
  method: string
  path: string
  body?: unknown
  status?: number
  answer?: unknown
  resolves?: unknown
}

const exchanges: Record<string, Exchange> = {
  listWikis: {
    call: api => api.listWikis(),
    method: 'GET',
    path: '/wikis',
    answer: { wikis: [summary] },
    resolves: [summary]
  },
  createWiki: {
    call: api =>
      api.createWiki({ name: 'Handbook', description: 'How we work' }),
    method: 'POST',
    path: '/wikis',
    body: { name: 'Handbook', description: 'How we work' },
    status: 201,
    answer: wiki,
    resolves: wiki
  },
  getWiki: {
    call: api => api.getWiki('w1'),
    method: 'GET',
    path: '/wikis/w1',
    answer: wiki,
    resolves: wiki
  },
  renameWiki: {
    call: api => api.renameWiki('w1', { name: 'Guide' }),
    method: 'PATCH',
    path: '/wikis/w1',
    body: { name: 'Guide' },
    answer: wiki,
    resolves: wiki
  },
  deleteWiki: {
    call: api => api.deleteWiki('w1'),
    method: 'DELETE',
    path: '/wikis/w1',
    status: 204
  },
  getTree: {
    call: api => api.getTree('w1'),
    method: 'GET',
    path: '/wikis/w1/tree',
    answer: { version: 3, pages: [treePage] },
    resolves: { version: 3, pages: [treePage] }
  },
  getMembers: {
    call: api => api.getMembers('w1'),
    method: 'GET',
    path: '/wikis/w1/members',
    answer: sharing,
    resolves: sharing
  },
  invite: {
    call: api => api.invite('w1', 'bob@example.com', 'editor'),
    method: 'POST',
    path: '/wikis/w1/invites',
    body: { email: 'bob@example.com', role: 'editor' },
    status: 202,
    answer: { status: 'invited' }
  },
  cancelInvite: {
    call: api => api.cancelInvite('w1', 'i1'),
    method: 'DELETE',
    path: '/wikis/w1/invites/i1',
    status: 204
  },
  setMemberRole: {
    call: api => api.setMemberRole('w1', 'u2', 'viewer'),
    method: 'PATCH',
    path: '/wikis/w1/members/u2',
    body: { role: 'viewer' },
    status: 204
  },
  removeMember: {
    call: api => api.removeMember('w1', 'u2'),
    method: 'DELETE',
    path: '/wikis/w1/members/u2',
    status: 204
  },
  searchPeople: {
    call: api => api.searchPeople('Ana L'),
    method: 'GET',
    path: '/people?q=Ana+L',
    answer: { people: [{ email: 'ana@example.com', name: 'Ana Lopez' }] },
    resolves: [{ email: 'ana@example.com', name: 'Ana Lopez' }]
  }
}

describe('httpPagesApi', () => {
  it.each(Object.entries(exchanges))(
    '%s sends its request and reads the answer',
    async (_, { call, method, path, body, status = 200, answer, resolves }) => {
      const send = backend(status, answer)

      await expect(call(httpPagesApi(BASE, send))).resolves.toEqual(resolves)

      const [request] = send.mock.calls[0] ?? []
      expect(request && (await sent(request))).toEqual({
        method,
        url: `${BASE}/api${path}`,
        contentType: body === undefined ? null : 'application/json',
        body
      })
    }
  )

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
    const send = stream([
      'id: 4\ndata: {"version":4}\n\n:\n\nid: 5\nda',
      'ta: {}\n\n'
    ])
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

  it('reads the versions of a wiki from its stream, keep-alives aside', async () => {
    const send = stream([
      'event: version\nid: 7\ndata: {"version":7}\n\n',
      ': keep-alive\n\nevent: version\nid: 8\ndata: {"version":8}\n\n'
    ])
    const versions: number[] = []

    const stop = httpPagesApi(BASE, send).watchWiki('w1', version => {
      versions.push(version)
    })

    await vi.waitFor(() => {
      expect(versions).toEqual([7, 8])
    })
    stop()
    const [request] = send.mock.calls[0] ?? []
    expect(request?.url).toBe(`${BASE}/api/wikis/w1/stream`)
  })
})
