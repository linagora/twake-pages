import { ApiError, type PagesApi, type PersonMatch } from '@/application/pages'
import type { WikiSummary } from '@/domain/wiki'

export type Send = (request: Request) => Promise<Response>

async function errorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json()
    return typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string'
      ? body.error
      : null
  } catch {
    return null
  }
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
    if (!response.ok) {
      throw new ApiError(response.status, await errorCode(response))
    }
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
      ).then(({ people }) => people)
  }
}
