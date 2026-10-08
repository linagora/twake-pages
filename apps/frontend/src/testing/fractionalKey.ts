// Base 62 digits in code unit order, so that keys compare with <.
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * A key strictly between two others, null meaning no bound: the fractional
 * keys the backend orders pages with. A key never ends with the zero digit,
 * so there is always room between two of them.
 */
export function keyBetween(lower: string | null, upper: string | null) {
  return midpoint(lower ?? '', upper)
}

function midpoint(lower: string, upper: string | null): string {
  if (upper !== null) {
    let shared = 0
    while ((lower.charAt(shared) || '0') === upper.charAt(shared)) shared += 1
    if (shared > 0) {
      return (
        upper.slice(0, shared) +
        midpoint(lower.slice(shared), upper.slice(shared))
      )
    }
  }
  const low = lower === '' ? 0 : DIGITS.indexOf(lower.charAt(0))
  const high = upper === null ? DIGITS.length : DIGITS.indexOf(upper.charAt(0))
  if (high - low > 1) return DIGITS.charAt(Math.round((low + high) / 2))
  if (upper !== null && upper.length > 1) return upper.charAt(0)
  return DIGITS.charAt(low) + midpoint(lower.slice(1), null)
}
