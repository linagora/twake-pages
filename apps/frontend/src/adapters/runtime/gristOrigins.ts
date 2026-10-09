/** The origin of `value` if it is a bare origin of http or https, else null. */
function bareOrigin(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  const bare =
    ['http:', 'https:'].includes(url.protocol) &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === ''
  return bare ? url.origin : null
}

/**
 * The origins of Grist the pages frame documents from: the runtime writes
 * them in /.env.js, apart by spaces, as an operator writes them in
 * GRIST_URL, the same as the backend's GRIST_ORIGINS. Each is read as the
 * backend reads its own, by its origin; one the backend would not start on
 * is left out.
 */
export function readGristOrigins(
  settings: Pick<Window, 'GRIST_URL'>
): string[] {
  return (settings.GRIST_URL ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .flatMap(value => {
      const origin = bareOrigin(value)
      return origin === null ? [] : [origin]
    })
}
