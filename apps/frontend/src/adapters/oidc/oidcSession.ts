import {
  addAuthorization,
  completeLogin,
  configureAuth,
  logOut,
  onSessionEndedElsewhere,
  redirectOnUnauthorized,
  startLogin,
  type AuthConfig
} from '@linagora/twake-oidc'

import { signInSilently } from '@/adapters/oidc/ssoFrame'
import { userOf } from '@/adapters/oidc/user'
import type { SessionService } from '@/application/session'

export type SsoSettings = Pick<
  Window,
  | 'SSO_BASE_URL'
  | 'SSO_CLIENT_ID'
  | 'SSO_SCOPE'
  | 'SSO_REDIRECT_URI'
  | 'SSO_POST_LOGOUT_REDIRECT'
>

export function readSsoConfig(
  settings: SsoSettings,
  apiUrl: string
): AuthConfig {
  const {
    SSO_BASE_URL,
    SSO_CLIENT_ID,
    SSO_SCOPE,
    SSO_REDIRECT_URI,
    SSO_POST_LOGOUT_REDIRECT
  } = settings
  if (
    !SSO_BASE_URL ||
    !SSO_CLIENT_ID ||
    !SSO_SCOPE ||
    !SSO_REDIRECT_URI ||
    !SSO_POST_LOGOUT_REDIRECT
  ) {
    throw new Error(
      '/.env.js must set SSO_BASE_URL, SSO_CLIENT_ID, SSO_SCOPE, SSO_REDIRECT_URI and SSO_POST_LOGOUT_REDIRECT'
    )
  }
  return {
    ssoUrl: SSO_BASE_URL,
    clientId: SSO_CLIENT_ID,
    scope: SSO_SCOPE,
    redirectUri: SSO_REDIRECT_URI,
    postLogoutRedirectUri: SSO_POST_LOGOUT_REDIRECT,
    apiUrl
  }
}

export function oidcSession(config: AuthConfig): SessionService {
  configureAuth(config)
  const redirectPath = new URL(config.redirectUri, window.location.href)
    .pathname

  return {
    async start() {
      if (window.location.pathname === redirectPath) {
        const login = await completeLogin()
        if (login) {
          window.history.replaceState(null, '', login.returnTo)
          return userOf(login.userinfo, login.tokenSet.id_token)
        }
      } else {
        try {
          return await signInSilently(config)
        } catch {
          // No SSO session to reuse: the SSO asks the user to sign in.
        }
      }
      await startLogin()
      return null
    },
    async signIn() {
      await startLogin()
      return null
    },
    signOut: logOut,
    onEndedElsewhere: onSessionEndedElsewhere
  }
}

export async function sendSignedIn(request: Request): Promise<Response> {
  addAuthorization(request)
  const response = await fetch(request)
  await redirectOnUnauthorized(request, undefined, response)
  return response
}
