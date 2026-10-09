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

/**
 * A time, by its day and its hour, in the person's timezone, as Twake Tasks
 * shows reminders.
 */
export const localTime = (time: string, lang: string): string =>
  new Intl.DateTimeFormat(lang, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: localZone()
  }).format(new Date(time))
