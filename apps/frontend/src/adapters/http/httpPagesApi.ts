import {
  ApiError,
  EditConflict,
  type PagesApi,
  type PersonMatch
} from '@/application/pages'
import type { TrashEntry, VersionSummary } from '@/domain/page'
import type { WikiSummary } from '@/domain/wiki'

export type Send = (request: Request) => Promise<Response>

async function refusal(response: Response): Promise<ApiError> {
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // No JSON body: a refusal without a code.
  }
  const fields = typeof body === 'object' && body !== null ? body : {}
  const code =
    'error' in fields && typeof fields.error === 'string' ? fields.error : null
  if (
    code === 'edit_conflict' &&
    'current' in fields &&
    typeof fields.current === 'object' &&
    fields.current !== null
  ) {
    return new EditConflict(fields.current as VersionSummary)
  }
  return new ApiError(response.status, code)
}

const RETRY_MS = 1000
const MAX_RETRY_MS = 30_000

// The stream's messages each carry the version as their id.
async function readVersions(
  body: ReadableStream<Uint8Array>,
  onVersion: (version: number) => void
) {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true })
    const messages = buffer.split('\n\n')
    buffer = messages.pop() ?? ''
    for (const message of messages) {
      const id = message
        .split('\n')
        .find(line => line.startsWith('id:'))
        ?.slice(3)
        .trim()
      if (id) onVersion(Number(id))
    }
  }
}

export function httpPagesApi(baseUrl: string, send: Send): PagesApi {
  async function call<T>(method: string, path: string, body?: object) {
    const response = await send(
      new Request(new URL(`/api${path}`, baseUrl), {
        method,
        ...(body && {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        })
      })
    )
    if (!response.ok) throw await refusal(response)
    return (response.status === 204 ? undefined : await response.json()) as T
  }

  function watch(path: string, onVersion: (version: number) => void) {
    const stop = new AbortController()
    void (async () => {
      let delay = RETRY_MS
      while (!stop.signal.aborted) {
        try {
          const response = await send(
            new Request(new URL(`/api${path}`, baseUrl), {
              signal: stop.signal
            })
          )
          if (response.ok && response.body) {
            delay = RETRY_MS
            await readVersions(response.body, onVersion)
          }
        } catch {
          // Dropped: reconnect below, unless stopped.
        }
        await new Promise(resolve => setTimeout(resolve, delay))
        delay = Math.min(delay * 2, MAX_RETRY_MS)
      }
    })()
    return () => {
      stop.abort()
    }
  }

  return {
    settings: () => call('GET', '/settings'),
    watchSettings: onVersion => watch('/settings/events', onVersion),

    listWikis: () =>
      call<{ wikis: WikiSummary[] }>('GET', '/wikis').then(
        ({ wikis }) => wikis
      ),
    createWiki: wiki => call('POST', '/wikis', wiki),
    getWiki: wikiId => call('GET', `/wikis/${wikiId}`),
    renameWiki: (wikiId, changes) => call('PATCH', `/wikis/${wikiId}`, changes),
    deleteWiki: wikiId => call('DELETE', `/wikis/${wikiId}`),
    getTree: wikiId => call('GET', `/wikis/${wikiId}/tree`),
    watchWiki: (wikiId, onVersion) =>
      watch(`/wikis/${wikiId}/stream`, onVersion),

    getMembers: wikiId => call('GET', `/wikis/${wikiId}/members`),
    invite: (wikiId, email, role) =>
      call('POST', `/wikis/${wikiId}/invites`, { email, role }).then(
        () => undefined
      ),
    cancelInvite: (wikiId, inviteId) =>
      call('DELETE', `/wikis/${wikiId}/invites/${inviteId}`),
    setMemberRole: (wikiId, userId, role) =>
      call('PATCH', `/wikis/${wikiId}/members/${userId}`, { role }),
    removeMember: (wikiId, userId) =>
      call('DELETE', `/wikis/${wikiId}/members/${userId}`),
    searchPeople: query =>
      call<{ people: PersonMatch[] }>(
        'GET',
        `/people?${new URLSearchParams({ q: query }).toString()}`
      ).then(({ people }) => people),

    createPage: (wikiId, page) => call('POST', `/wikis/${wikiId}/pages`, page),
    getPage: pageId => call('GET', `/pages/${pageId}`),
    publish: (pageId, version) =>
      call('POST', `/pages/${pageId}/versions`, version),
    listVersions: pageId =>
      call<{ versions: VersionSummary[] }>(
        'GET',
        `/pages/${pageId}/versions`
      ).then(({ versions }) => versions),
    getVersion: (pageId, number) =>
      call('GET', `/pages/${pageId}/versions/${String(number)}`),
    restoreVersion: (pageId, number) =>
      call('POST', `/pages/${pageId}/versions/${String(number)}/restore`, {}),
    movePage: (pageId, move) => call('POST', `/pages/${pageId}/move`, move),
    deletePage: pageId => call('DELETE', `/pages/${pageId}`),
    setFollowing: (pageId, following) =>
      call(following ? 'PUT' : 'DELETE', `/pages/${pageId}/follow`),
    setFavorite: (pageId, favorite) =>
      call(favorite ? 'PUT' : 'DELETE', `/pages/${pageId}/favorite`),

    listTrash: wikiId =>
      call<{ pages: TrashEntry[] }>('GET', `/wikis/${wikiId}/trash`).then(
        ({ pages }) => pages
      ),
    restorePage: pageId => call('POST', `/pages/${pageId}/restore`, {}),
    purgePage: (wikiId, pageId) =>
      call('DELETE', `/wikis/${wikiId}/trash/${pageId}`),
    emptyTrash: wikiId => call('DELETE', `/wikis/${wikiId}/trash`)
  }
}
