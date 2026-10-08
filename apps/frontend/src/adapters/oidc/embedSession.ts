import {
  addAuthorization,
  configureAuth,
  logOut,
  onSessionEndedElsewhere,
  type AuthConfig
} from '@linagora/twake-oidc'

import { POPUP_NAME, signInAt, signInSilently } from '@/adapters/oidc/ssoFrame'
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
export function embedSession(config: AuthConfig): EmbedSession {
  configureAuth(config)

  return {
    start: () => signInSilently(config),
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
    async send(request) {
      const retry = request.clone()
      addAuthorization(request)
      const response = await fetch(request)
      if (response.status !== 401 || !request.headers.has('Authorization')) {
        return response
      }
      try {
        await signInSilently(config)
      } catch {
        return response
      }
      addAuthorization(retry)
      return fetch(retry)
    }
  }
}
