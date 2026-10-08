import { Typography } from '@linagora/twake-mui'
import type { ReactElement } from 'react'

import { useDocumentTitle } from '@/ui/useDocumentTitle'

export function PlaceholderScreen({ title }: { title: string }): ReactElement {
  useDocumentTitle(title)
  return (
    <main className="u-p-2">
      <Typography variant="h3" component="h1">
        {title}
      </Typography>
    </main>
  )
}
