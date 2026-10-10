import { ApiError, type Refusal } from '@/application/pages'
import type { TranslationKey } from '@/ui/i18n/useI18n'

/** The words of `refusals` for the refusal `error` carries, else `otherwise`. */
export function failureKey(
  error: Error,
  refusals: Partial<Record<Refusal, TranslationKey>>,
  otherwise: TranslationKey
): TranslationKey {
  const refused = error instanceof ApiError ? error.code : null
  return (
    Object.entries(refusals).find(([refusal]) => refusal === refused)?.[1] ??
    otherwise
  )
}
