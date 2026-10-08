export interface Wiki {
  id: string
  name: string
}

/** The person's Twake Workplace settings; null where they never chose. */
export interface UserSettings {
  version: number
  language: string | null
  timezone: string | null
  theme: 'light' | 'dark' | 'auto'
  avatar: string | null
  name: string | null
}

/** Rejects with an ApiError when the backend refuses the request. */
export interface PagesApi {
  settings: () => Promise<UserSettings>
  /** Calls back with the settings' version now, then with each new one. */
  watchSettings: (onVersion: (version: number) => void) => () => void
  listWikis: () => Promise<Wiki[]>
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(status: number, code: string | null) {
    super(`API answered ${String(status)}${code ? ` ${code}` : ''}`)
    this.status = status
    this.code = code
  }
}
