export const SUPPORTED_LANGUAGES = ['en', 'fr'] as const

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en'

function isSupported(tag: string): tag is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(tag)
}

export function resolveLanguage(
  candidates: readonly (string | null | undefined)[]
): SupportedLanguage {
  for (const candidate of candidates) {
    const primary = candidate?.trim().toLowerCase().split(/[-_]/)[0] ?? ''
    if (isSupported(primary)) return primary
  }
  return DEFAULT_LANGUAGE
}

export function findPreferredLanguage(): SupportedLanguage {
  return resolveLanguage(navigator.languages)
}
