export type SignInDestination = { kind: 'wiki' } | null

const SAVED = 'twake-pages.signInDestination'

function describe(path: string): SignInDestination {
  const url = new URL(path, 'http://local')
  if (url.pathname.startsWith('/wikis/')) return { kind: 'wiki' }
  return null
}

// The SSO sends the browser back with only a code, so the way out leaves the
// destination behind for the way back.
export function signInDestination(location: Location): SignInDestination {
  const here = location.pathname + location.search
  const returning = new URLSearchParams(location.search).has('code')
  try {
    if (returning) return describe(sessionStorage.getItem(SAVED) ?? '/')
    sessionStorage.setItem(SAVED, here)
  } catch {
    if (returning) return null
  }
  return describe(here)
}
