import { setTokenSet, type AuthConfig } from '@linagora/twake-oidc'
import * as client from 'openid-client'

import { userOf } from '@/adapters/oidc/user'
import type { User } from '@/application/session'

export const SILENT_NAME = 'twake-pages-silent-sign-in'
export const POPUP_NAME = 'twake-pages-sign-in'
const CALLBACK = 'twake-pages:sso-callback'
const SILENT_TIMEOUT_MS = 10_000

// A window the app opens for the SSO (a hidden frame, or a popup) comes back
// on the redirect URI and hands the SSO's answer to the app, which never
// leaves its page.
export function relayCallback(
  self: { name: string; href: string } = {
    name: window.name,
    href: window.location.href
  }
): boolean {
  const to =
    self.name === SILENT_NAME
      ? window.parent
      : self.name === POPUP_NAME
        ? (window.opener as Window | null)
        : null
  if (!to) return false
  to.postMessage({ type: CALLBACK, url: self.href }, window.location.origin)
  return true
}

function callbackFrom(source: () => Window | null, timeoutMs?: number) {
  return new Promise<URL>((resolve, reject) => {
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            done()
            reject(new Error('no answer from the SSO'))
          }, timeoutMs)
    const onMessage = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== window.location.origin ||
        event.source === null ||
        event.source !== source()
      ) {
        return
      }
      const data = event.data as { type?: unknown; url?: unknown } | null
      if (data?.type !== CALLBACK || typeof data.url !== 'string') return
      done()
      resolve(new URL(data.url))
    }
    const done = () => {
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
    }
    window.addEventListener('message', onMessage)
  })
}

/**
 * Whether the SSO answered that nobody is signed in to it, which a silent
 * sign-in (`prompt=none`) may not ask for: `signInAt` throws its error code.
 */
export const isLoginRequired = (error: unknown): boolean =>
  error instanceof Error && error.message === 'login_required'

export async function signInAt(
  config: AuthConfig,
  open: (url: URL) => () => Window | null,
  options: { prompt?: string; timeoutMs?: number }
): Promise<User> {
  const configuration = await client.discovery(
    new URL(config.ssoUrl),
    config.clientId
  )
  const codeVerifier = client.randomPKCECodeVerifier()
  const state = client.randomState()
  const url = client.buildAuthorizationUrl(configuration, {
    redirect_uri: config.redirectUri,
    scope: config.scope,
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state,
    ...(options.prompt ? { prompt: options.prompt } : {})
  })
  const callback = await callbackFrom(open(url), options.timeoutMs)
  const error = callback.searchParams.get('error')
  if (error) throw new Error(error)
  const tokens = await client.authorizationCodeGrant(configuration, callback, {
    pkceCodeVerifier: codeVerifier,
    expectedState: state
  })
  const sub = tokens.claims()?.sub
  if (!sub) throw new Error('The SSO returned no ID token')
  const userinfo = await client.fetchUserInfo(
    configuration,
    tokens.access_token,
    sub
  )
  setTokenSet(tokens)
  return userOf(userinfo, tokens.id_token)
}

export async function signInSilently(config: AuthConfig): Promise<User> {
  const frame = document.createElement('iframe')
  frame.name = SILENT_NAME
  frame.hidden = true
  try {
    return await signInAt(
      config,
      url => {
        frame.src = url.href
        document.body.append(frame)
        return () => frame.contentWindow
      },
      { prompt: 'none', timeoutMs: SILENT_TIMEOUT_MS }
    )
  } finally {
    frame.remove()
  }
}
