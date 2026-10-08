export {}

declare global {
  interface Window {
    SSO_BASE_URL?: string
    SSO_CLIENT_ID?: string
    SSO_SCOPE?: string
    SSO_REDIRECT_URI?: string
    SSO_POST_LOGOUT_REDIRECT?: string
  }
}
