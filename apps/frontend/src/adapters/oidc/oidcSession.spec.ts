import {
  completeLogin,
  startLogin,
  type LoginResult
} from '@linagora/twake-oidc'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { oidcSession, readSsoConfig } from '@/adapters/oidc/oidcSession'
import { signInSilently } from '@/adapters/oidc/ssoFrame'

vi.mock('@/adapters/oidc/ssoFrame', () => ({ signInSilently: vi.fn() }))

vi.mock('@linagora/twake-oidc', () => ({
  configureAuth: vi.fn(),
  completeLogin: vi.fn(),
  startLogin: vi.fn(() => Promise.resolve()),
  logOut: vi.fn(),
  onSessionEndedElsewhere: vi.fn()
}))

const settings = {
  SSO_BASE_URL: 'https://sso.test/',
  SSO_CLIENT_ID: 'twakepages',
  SSO_SCOPE: 'openid email profile',
  SSO_REDIRECT_URI: 'http://localhost:3000/auth/callback',
  SSO_POST_LOGOUT_REDIRECT: 'http://localhost:3000/'
}

const config = readSsoConfig(settings, 'http://localhost:3000')

const ALICE = {
  name: 'Alice Martin',
  email: 'alice@test',
  workplaceFqdn: null,
  idToken: null
}

beforeEach(() => {
  vi.clearAllMocks()
})

// Enough of a token set for the cast of the login result to type check
const tokenSet = (idToken: string): Partial<LoginResult['tokenSet']> => ({
  access_token: 'access-token',
  token_type: 'bearer',
  id_token: idToken
})

describe('readSsoConfig', () => {
  it('refuses missing settings', () => {
    expect(() =>
      readSsoConfig({ ...settings, SSO_CLIENT_ID: '' }, 'http://localhost')
    ).toThrow(/SSO_CLIENT_ID/)
  })
})

describe('oidcSession', () => {
  it('finishes the sign-in on the redirect URI and goes back', async () => {
    window.history.replaceState(null, '', '/auth/callback?code=c&state=s')
    vi.mocked(completeLogin).mockResolvedValue({
      userinfo: {
        sub: 'alice',
        name: 'Alice Martin',
        workplaceFqdn: 'alice.twake.test'
      },
      tokenSet: tokenSet('id-token'),
      returnTo: '/wikis/w1?page=p2'
    } as LoginResult)

    const user = await oidcSession(config).start()

    expect(user).toEqual({
      name: 'Alice Martin',
      email: null,
      workplaceFqdn: 'alice.twake.test',
      idToken: 'id-token'
    })
    expect(window.location.pathname + window.location.search).toBe(
      '/wikis/w1?page=p2'
    )
    expect(startLogin).not.toHaveBeenCalled()
  })

  it('signs in again when the redirect URI has no pending sign-in', async () => {
    window.history.replaceState(null, '', '/auth/callback')
    vi.mocked(completeLogin).mockResolvedValue(null)

    await expect(oidcSession(config).start()).resolves.toBeNull()
    expect(startLogin).toHaveBeenCalled()
  })

  it('signs in silently on any other page, staying on it', async () => {
    window.history.replaceState(null, '', '/wikis/w1')
    vi.mocked(signInSilently).mockResolvedValue(ALICE)

    await expect(oidcSession(config).start()).resolves.toEqual(ALICE)
    expect(signInSilently).toHaveBeenCalledWith(config)
    expect(startLogin).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/wikis/w1')
  })

  it('sends the user to the SSO when the silent sign-in fails', async () => {
    window.history.replaceState(null, '', '/')
    vi.mocked(signInSilently).mockRejectedValue(new Error('login_required'))

    await expect(oidcSession(config).start()).resolves.toBeNull()
    expect(completeLogin).not.toHaveBeenCalled()
    expect(startLogin).toHaveBeenCalled()
  })
})
