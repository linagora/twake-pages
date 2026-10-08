let followedZone: string | null = null

function isZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** Shows times in this zone rather than the browser's, unless it is null or unknown. */
export function followZone(zone: string | null): void {
  followedZone = zone && isZone(zone) ? zone : null
}

export const localZone = (): string =>
  followedZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
