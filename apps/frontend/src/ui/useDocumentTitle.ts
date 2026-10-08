import { useEffect } from 'react'

import { useI18n } from '@/ui/i18n/useI18n'

export function useDocumentTitle(view: string | null): void {
  const { t } = useI18n()
  const appName = t('app.name')
  useEffect(() => {
    const previous = document.title
    document.title = view ? `${view} - ${appName}` : appName
    return () => {
      document.title = previous
    }
  }, [view, appName])
}
