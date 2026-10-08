import {
  addAuthorization,
  configureAuth,
  logOut,
  onSessionEndedElsewhere,
  type AuthConfig
} from '@linagora/twake-oidc'

import {
  isLoginRequired,
  POPUP_NAME,
  signInAt,
  signInSilently
} from '@/adapters/oidc/ssoFrame'
import type { SessionService } from '@/application/session'

export type EmbedSession = SessionService & {
  /** On a 401, signs in again silently and retries once. */
  send: (request: Request) => Promise<Response>
}

export const isEmbedded = (): boolean =>
  window.location.pathname.startsWith('/embed/')

// The embed never leaves its page for the SSO: a browser shows an error page,
// with no way back, in a frame the SSO refuses to be shown in. A popup goes
// instead when the SSO needs to show its portal.
//
// `onLoginRequired` tells TwakeSpace when the SSO wants the person to sign in.
export function embedSession(
  config: AuthConfig,
  onLoginRequired: () => void
): EmbedSession {
  configureAuth(config)
  // TwakeSpace is told once per load of the frame, which asks the SSO nothing
  // more until TwakeSpace reloads it
  let expired = false
  const expiredListeners = new Set<() => void>()

  // Unlike Tasks, which only has its popup: when the SSO wants the person to
  // sign in, TwakeSpace signs them in again at the top level and reloads its
  // frames (ADR 010). An SSO that never answers is left to the popup, since
  // signing in again would not let it show in the frame.
  const signInSilentlyOrTellTwakeSpace = () =>
    signInSilently(config).catch((error: unknown) => {
      if (isLoginRequired(error) && !expired) {
        expired = true
        onLoginRequired()
        expiredListeners.forEach(listener => {
          listener()
        })
      }
      throw error
    })

  return {
    start: signInSilentlyOrTellTwakeSpace,
    signIn() {
      // Opened before any await, while the click still allows a popup
      const popup = window.open('', POPUP_NAME, 'popup,width=480,height=640')
      if (!popup) return Promise.reject(new Error('popup blocked'))
      return signInAt(
        config,
        url => {
          popup.location.href = url.href
          return () => popup
        },
        {}
      ).finally(() => {
        popup.close()
      })
    },
    signOut: logOut,
    onEndedElsewhere: onSessionEndedElsewhere,
    onExpired(listener) {
      expiredListeners.add(listener)
      return () => {
        expiredListeners.delete(listener)
      }
    },
    async send(request) {
      const retry = request.clone()
      addAuthorization(request)
      const response = await fetch(request)
      if (
        expired ||
        response.status !== 401 ||
        !request.headers.has('Authorization')
      ) {
        return response
      }
      try {
        await signInSilentlyOrTellTwakeSpace()
      } catch {
        return response
      }
      addAuthorization(retry)
      return fetch(retry)
    }
  }
}
