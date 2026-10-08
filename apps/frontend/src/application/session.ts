export interface User {
  name: string | null
  email: string | null
  /** The address of the person's Twake Workplace instance, like `alice.twake.app`. */
  workplaceFqdn: string | null
  /** OIDC id token, exchanged on the platform for a token of its own. */
  idToken: string | null
}

export interface SessionService {
  /** Resolves to null when the browser is being sent to the SSO. */
  start: () => Promise<User | null>
  /** Resolves to null when the browser is being sent to the SSO. */
  signIn: () => Promise<User | null>
  signOut: () => Promise<void>
  onEndedElsewhere: (onEnded: () => void) => () => void
}
