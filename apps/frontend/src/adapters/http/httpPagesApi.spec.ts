import { describe, expect, it, vi } from 'vitest'

import { httpPagesApi, type Send } from '@/adapters/http/httpPagesApi'
import {
  ApiError,
  EditConflict,
  type PagesApi,
  type Sharing
} from '@/application/pages'
import type { Comment } from '@/domain/comment'
import type {
  Page,
  TrashEntry,
  TreePage,
  Version,
  VersionSummary
} from '@/domain/page'
import type { Person } from '@/domain/person'
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
const alice: Person = {
  id: 'u1',
  email: 'alice@example.com',
  name: 'Alice Martin'
}
const content = [{ type: 'paragraph', content: 'Welcome' }]
const page: Page = {
  id: 'p1',
  wikiId: 'w1',
  parentId: null,
  home: false,
  kind: 'document',
  title: 'Onboarding',
  content,
  gristUrl: null,
  version: 2,
  createdAt: '2026-10-08T07:30:00.000Z',
  createdBy: alice,
  updatedAt: '2026-10-08T07:40:00.000Z',
  updatedBy: alice,
  labels: ['howto'],
  ancestors: [],
  following: true,
  favorite: false,
  deletedAt: null
}
const versionSummary: VersionSummary = {
  number: 2,
  title: 'Onboarding',
  author: alice,
  createdAt: '2026-10-08T07:40:00.000Z',
  restoredFrom: null
}
const version: Version = { ...versionSummary, content, gristUrl: null }
const trashEntry: TrashEntry = {
  id: 'p1',
  title: 'Onboarding',
  deletedAt: '2026-10-08T07:50:00.000Z',
  deletedBy: alice,
  descendants: 2
}
const labelledPage = {
  id: 'p1',
  title: 'Onboarding',
  updatedAt: '2026-10-08T07:40:00.000Z'
}
const comment: Comment = {
  id: 'c1',
  parentId: 'c0',
  author: alice,
  body: 'Thanks @bob@example.com',
  createdAt: '2026-10-08T07:45:00.000Z',
  editedAt: null
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
  },
  createPage: {
    call: api =>
      api.createPage('w1', {
        title: 'Onboarding',
        kind: 'document',
        parentId: null,
        afterId: 'p0',
        content
      }),
    method: 'POST',
    path: '/wikis/w1/pages',
    body: {
      title: 'Onboarding',
      kind: 'document',
      parentId: null,
      afterId: 'p0',
      content
    },
    status: 201,
    answer: page,
    resolves: page
  },
  getPage: {
    call: api => api.getPage('p1'),
    method: 'GET',
    path: '/pages/p1',
    answer: page,
    resolves: page
  },
  publish: {
    call: api =>
      api.publish('p1', { baseVersion: 1, title: 'Onboarding', content }),
    method: 'POST',
    path: '/pages/p1/versions',
    body: { baseVersion: 1, title: 'Onboarding', content },
    status: 201,
    answer: page,
    resolves: page
  },
  listVersions: {
    call: api => api.listVersions('p1'),
    method: 'GET',
    path: '/pages/p1/versions',
    answer: { versions: [versionSummary] },
    resolves: [versionSummary]
  },
  getVersion: {
    call: api => api.getVersion('p1', 2),
    method: 'GET',
    path: '/pages/p1/versions/2',
    answer: version,
    resolves: version
  },
  restoreVersion: {
    call: api => api.restoreVersion('p1', 1),
    method: 'POST',
    path: '/pages/p1/versions/1/restore',
    body: {},
    status: 201,
    answer: page,
    resolves: page
  },
  movePage: {
    call: api => api.movePage('p1', { parentId: 'p2', afterId: 'p3' }),
    method: 'POST',
    path: '/pages/p1/move',
    body: { parentId: 'p2', afterId: 'p3' },
    answer: { parentId: 'p2', position: 'a1' },
    resolves: { parentId: 'p2', position: 'a1' }
  },
  'setFollowing on': {
    call: api => api.setFollowing('p1', true),
    method: 'PUT',
    path: '/pages/p1/follow',
    status: 204
  },
  'setFollowing off': {
    call: api => api.setFollowing('p1', false),
    method: 'DELETE',
    path: '/pages/p1/follow',
    status: 204
  },
  'setFavorite on': {
    call: api => api.setFavorite('p1', true),
    method: 'PUT',
    path: '/pages/p1/favorite',
    status: 204
  },
  'setFavorite off': {
    call: api => api.setFavorite('p1', false),
    method: 'DELETE',
    path: '/pages/p1/favorite',
    status: 204
  },
  deletePage: {
    call: api => api.deletePage('p1'),
    method: 'DELETE',
    path: '/pages/p1',
    status: 204
  },
  listTrash: {
    call: api => api.listTrash('w1'),
    method: 'GET',
    path: '/wikis/w1/trash',
    answer: { pages: [trashEntry] },
    resolves: [trashEntry]
  },
  restorePage: {
    call: api => api.restorePage('p1'),
    method: 'POST',
    path: '/pages/p1/restore',
    body: {},
    answer: { parentId: null, position: 'a2' },
    resolves: { parentId: null, position: 'a2' }
  },
  purgePage: {
    call: api => api.purgePage('w1', 'p1'),
    method: 'DELETE',
    path: '/wikis/w1/trash/p1',
    status: 204
  },
  emptyTrash: {
    call: api => api.emptyTrash('w1'),
    method: 'DELETE',
    path: '/wikis/w1/trash',
    status: 204
  },
  setLabels: {
    call: api => api.setLabels('p1', ['howto', 'laptop']),
    method: 'PUT',
    path: '/pages/p1/labels',
    body: { names: ['howto', 'laptop'] },
    answer: { labels: ['howto', 'laptop'] },
    resolves: ['howto', 'laptop']
  },
  listLabels: {
    call: api => api.listLabels('w1'),
    method: 'GET',
    path: '/wikis/w1/labels',
    answer: { labels: [{ name: 'howto', pages: 2 }] },
    resolves: [{ name: 'howto', pages: 2 }]
  },
  pagesWithLabel: {
    call: api => api.pagesWithLabel('w1', 'café'),
    method: 'GET',
    path: '/wikis/w1/labels/caf%C3%A9/pages',
    answer: { pages: [labelledPage] },
    resolves: [labelledPage]
  },
  listComments: {
    call: api => api.listComments('p1'),
    method: 'GET',
    path: '/pages/p1/comments',
    answer: { comments: [comment] },
    resolves: [comment]
  },
  addComment: {
    call: api =>
      api.addComment('p1', { body: 'Thanks @bob@example.com', parentId: 'c0' }),
    method: 'POST',
    path: '/pages/p1/comments',
    body: { body: 'Thanks @bob@example.com', parentId: 'c0' },
    status: 201,
    answer: comment,
    resolves: comment
  },
  editComment: {
    call: api => api.editComment('c1', 'Thanks @bob@example.com'),
    method: 'PATCH',
    path: '/comments/c1',
    body: { body: 'Thanks @bob@example.com' },
    answer: comment,
    resolves: comment
  },
  deleteComment: {
    call: api => api.deleteComment('c1'),
    method: 'DELETE',
    path: '/comments/c1',
    status: 204
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

  it('rejects a publish over a newer version with the current one', async () => {
    const send = backend(409, {
      error: 'edit_conflict',
      current: versionSummary
    })

    const publishing = httpPagesApi(BASE, send).publish('p1', {
      baseVersion: 1,
      title: 'Onboarding',
      content
    })

    await expect(publishing).rejects.toBeInstanceOf(EditConflict)
    await expect(publishing).rejects.toMatchObject({
      status: 409,
      code: 'edit_conflict',
      current: versionSummary
    })
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
