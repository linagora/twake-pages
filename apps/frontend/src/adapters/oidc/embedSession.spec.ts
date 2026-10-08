import { setTokenSet } from '@linagora/twake-oidc'
import * as client from 'openid-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { embedSession } from '@/adapters/oidc/embedSession'
import { readSsoConfig } from '@/adapters/oidc/oidcSession'
import {
  POPUP_NAME,
  relayCallback,
  SILENT_NAME
} from '@/adapters/oidc/ssoFrame'

vi.mock('@linagora/twake-oidc', () => ({
  addAuthorization: vi.fn(),
  configureAuth: vi.fn(),
  setTokenSet: vi.fn(),
  logOut: vi.fn(),
  onSessionEndedElsewhere: vi.fn()
}))

vi.mock('openid-client', () => ({
  discovery: vi.fn(() => Promise.resolve({})),
  randomPKCECodeVerifier: vi.fn(() => 'verifier'),
  randomState: vi.fn(() => 'state'),
  calculatePKCECodeChallenge: vi.fn(() => Promise.resolve('challenge')),
  buildAuthorizationUrl: vi.fn(
    (_config: unknown, params: Record<string, string>) =>
      new URL(`https://sso.test/authorize?${new URLSearchParams(params)}`)
  ),
  authorizationCodeGrant: vi.fn(() =>
    Promise.resolve({
      access_token: 'at',
      id_token: 'id-token',
      claims: () => ({ sub: 'alice' })
    })
  ),
  fetchUserInfo: vi.fn(() =>
    Promise.resolve({
      sub: 'alice',
      name: 'Alice',
      email: 'alice@test',
      workplaceFqdn: 'alice.twake.test'
    })
  )
}))

const config = readSsoConfig(
  {
    SSO_BASE_URL: 'https://sso.test/',
    SSO_CLIENT_ID: 'twakepages',
    SSO_SCOPE: 'openid email profile',
    SSO_REDIRECT_URI: 'http://localhost:3000/auth/callback',
    SSO_POST_LOGOUT_REDIRECT: 'http://localhost:3000/'
  },
  'http://localhost:3000'
)

const ALICE = {
  name: 'Alice',
  email: 'alice@test',
  workplaceFqdn: 'alice.twake.test',
  idToken: 'id-token'
}

const silentFrame = () =>
  document.querySelector<HTMLIFrameElement>(`iframe[name="${SILENT_NAME}"]`)

async function frameOpened() {
  await vi.waitFor(() => {
    expect(silentFrame()).not.toBeNull()
  })
  const frame = silentFrame()
  if (!frame?.contentWindow) throw new Error('no silent frame')
  return { url: new URL(frame.src), window: frame.contentWindow }
}

function relay(
  source: Window,
  search: string,
  origin = window.location.origin
) {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin,
      source,
      data: {
        type: 'twake-pages:sso-callback',
        url: `http://localhost:3000/auth/callback${search}`
      }
    })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  window.history.replaceState(null, '', '/embed/wikis/w1')
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  silentFrame()?.remove()
})

describe('embedSession', () => {
  it('signs in without showing the SSO, in a hidden frame, staying on the page', async () => {
    const starting = embedSession(config).start()

    const frame = await frameOpened()
    expect(frame.url.searchParams.get('prompt')).toBe('none')
    expect(frame.url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/auth/callback'
    )
    relay(frame.window, '?code=c&state=state')

    await expect(starting).resolves.toEqual(ALICE)
    expect(setTokenSet).toHaveBeenCalled()
    expect(vi.mocked(client.authorizationCodeGrant).mock.calls[0]?.[2]).toEqual(
      { pkceCodeVerifier: 'verifier', expectedState: 'state' }
    )
    expect(silentFrame()).toBeNull()
    expect(window.location.pathname).toBe('/embed/wikis/w1')
  })

  it('fails when the SSO wants the user to sign in', async () => {
    const starting = embedSession(config).start()

    relay((await frameOpened()).window, '?error=login_required&state=state')

    await expect(starting).rejects.toThrow('login_required')
    expect(client.authorizationCodeGrant).not.toHaveBeenCalled()
  })

  it('gives up when the SSO never answers, as when it refuses to be framed', async () => {
    vi.useFakeTimers()
    const starting = embedSession(config).start()
    starting.catch(() => undefined)

    await vi.advanceTimersByTimeAsync(10_000)

    await expect(starting).rejects.toThrow('no answer from the SSO')
    expect(silentFrame()).toBeNull()
  })

  it('takes the answer only from its own frame, on its own origin', async () => {
    const starting = embedSession(config).start()
    const frame = await frameOpened()

    relay(frame.window, '?code=forged&state=state', 'https://evil.test')
    relay(window, '?code=forged&state=state')
    relay(frame.window, '?code=c&state=state')

    await expect(starting).resolves.toEqual(ALICE)
    expect(client.authorizationCodeGrant).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      new URL('http://localhost:3000/auth/callback?code=c&state=state'),
      expect.anything()
    )
  })

  it('signs in through a popup, where the SSO may show its portal', async () => {
    const popup = document.createElement('iframe')
    document.body.append(popup)
    const popupWindow = popup.contentWindow
    if (!popupWindow) throw new Error('no popup window')
    const open = vi.spyOn(window, 'open').mockReturnValue(popupWindow)
    const close = vi.spyOn(popupWindow, 'close').mockReturnValue()

    const signingIn = embedSession(config).signIn()

    expect(open).toHaveBeenCalledWith('', POPUP_NAME, expect.any(String))
    await vi.waitFor(() => {
      expect(client.buildAuthorizationUrl).toHaveBeenCalled()
    })
    expect(
      vi.mocked(client.buildAuthorizationUrl).mock.calls[0]?.[1]
    ).not.toHaveProperty('prompt')
    relay(popupWindow, '?code=c&state=state')

    await expect(signingIn).resolves.toEqual(ALICE)
    expect(close).toHaveBeenCalled()
    popup.remove()
  })

  it('signs in again silently when the backend refuses the token, then retries', async () => {
    const fetch = vi
      .spyOn(window, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response('ok'))
    const request = new Request('http://localhost:3000/api/wikis', {
      headers: { Authorization: 'Bearer old' }
    })

    const sending = embedSession(config).send(request)
    relay((await frameOpened()).window, '?code=c&state=state')

    expect(await (await sending).text()).toBe('ok')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('relayCallback', () => {
  it('hands the SSO answer to the embed that opened the frame', () => {
    const post = vi.spyOn(window.parent, 'postMessage')

    expect(
      relayCallback({ name: SILENT_NAME, href: 'http://x/cb?code=c' })
    ).toBe(true)
    expect(post).toHaveBeenCalledWith(
      { type: 'twake-pages:sso-callback', url: 'http://x/cb?code=c' },
      window.location.origin
    )
  })

  it('leaves any other window alone', () => {
    expect(relayCallback({ name: '', href: 'http://x/cb?code=c' })).toBe(false)
  })
})
