import {
  List,
  ListItem,
  ListItemButton,
  ListItemText
} from '@linagora/twake-mui'
import type { ReactElement } from 'react'
import { Outlet, useParams } from 'react-router'

import { ApiError } from '@/application/pages'
import { WikiFrame } from '@/ds/WikiFrame'
import { useI18n } from '@/ui/i18n/useI18n'
import { WikiLabels } from '@/ui/labels/WikiLabels'
import { BackToWikis, UnavailableScreen } from '@/ui/shell/Problems'
import { EntryLink } from '@/ui/shell/SidebarLink'
import { PageTree } from '@/ui/wiki/PageTree'
import { useLiveWiki, useWiki } from '@/ui/wiki/queries'

/** `back` leads to the person's wikis, which the frame of TwakeSpace has not. */
export function WikiLayout({ back = true }: { back?: boolean }): ReactElement {
  const { t } = useI18n()
  const { wikiId = '' } = useParams()
  const wiki = useWiki(wikiId)
  // Checked before the data, which a failed reload keeps.
  const missing = wiki.error instanceof ApiError && wiki.error.status === 404
  useLiveWiki(wikiId, !missing)

  if (missing || !wiki.data) {
    return (
      <UnavailableScreen
        query={wiki}
        missing={missing}
        notFound={t('wiki.notFound')}
        loadFailed={t('wiki.loadFailed')}
        action={back ? <BackToWikis /> : undefined}
      />
    )
  }

  return (
    <WikiFrame
      sidebar={
        <nav aria-label={t('wiki.nav')}>
          <List>
            <WikiLink to="." end label={t('wiki.home')} />
            <WikiLink to="search" label={t('search.title')} />
            <WikiLink to="trash" label={t('trash.title')} />
          </List>
          <PageTree wikiId={wiki.data.id} />
          <WikiLabels wikiId={wiki.data.id} />
        </nav>
      }
    >
      <Outlet />
    </WikiFrame>
  )
}

// Not SidebarLink: below lg, the NavLink of twake-mui draws an entry of the
// phone bottom bar, and this column is a list at every width.
function WikiLink({
  to,
  end = false,
  label
}: {
  to: string
  end?: boolean
  label: string
}): ReactElement {
  return (
    <ListItem disablePadding>
      <EntryLink to={to} end={end}>
        {active => (
          <ListItemButton selected={active} role="presentation" tabIndex={-1}>
            <ListItemText primary={label} />
          </ListItemButton>
        )}
      </EntryLink>
    </ListItem>
  )
}
