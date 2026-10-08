import { Icon, Left } from '@linagora/twake-icons'
import { Alert, Button, TextField, Typography } from '@linagora/twake-mui'
import { useState, type ReactElement } from 'react'
import {
  Navigate,
  Link as RouterLink,
  useNavigate,
  useParams
} from 'react-router'

import { BlocksEditor } from '@/ds/BlocksEditor'
import { PageHeader } from '@/ds/PageHeader'
import type { Page } from '@/domain/page'
import { useI18n } from '@/ui/i18n/useI18n'
import { useDraft } from '@/ui/page/useDraft'
import { useEditable } from '@/ui/page/useEditable'
import { useWikiPage } from '@/ui/page/useWikiPage'
import { UnavailableScreen } from '@/ui/shell/Problems'
import { useDocumentTitle } from '@/ui/useDocumentTitle'
import { usePublish } from '@/ui/wiki/queries'

export function EditPageScreen(): ReactElement {
  const { t } = useI18n()
  const { wikiId = '', pageId = '' } = useParams()
  const { page, missing } = useWikiPage(wikiId, pageId)
  const editable = useEditable(wikiId, pageId)
  // Each start of the editor takes the page as it is then.
  const [starts, setStarts] = useState(0)

  if (missing || !page.data) {
    return (
      <UnavailableScreen
        query={page}
        missing={missing}
        notFound={t('page.notFound')}
        loadFailed={t('page.loadFailed')}
      />
    )
  }

  // The page as it is, for a person who does not write it, with no draft.
  // The wiki is read by now, as its layout waits for it.
  if (!editable) return <Navigate to={pathOf(page.data)} replace />

  return (
    <PageEditor
      key={`${pageId}.${String(starts)}`}
      wikiId={wikiId}
      page={page.data}
      onRestart={() => {
        setStarts(count => count + 1)
      }}
    />
  )
}

// The home page shows under the name of its wiki.
const pathOf = (page: Page) => (page.home ? '..' : `../pages/${page.id}`)

/** The title and the blocks of a page, written in its draft. */
function PageEditor({
  wikiId,
  page,
  onRestart
}: {
  wikiId: string
  page: Page
  /** Starts the editor again, from the page as it is then. */
  onRestart: () => void
}): ReactElement {
  const { t, lang } = useI18n()
  useDocumentTitle(t('page.edit'))
  const navigate = useNavigate()
  const { kept, start, draft, change, drop } = useDraft(page)
  // Dropped once published, though the person left the editor meanwhile.
  const publish = usePublish(wikiId, page.id, drop)
  const path = pathOf(page)

  const restart = () => {
    drop()
    onRestart()
  }

  return (
    <main className="u-p-2">
      <PageHeader
        back={
          <Button
            component={RouterLink}
            to={path}
            variant="secondary"
            startIcon={<Icon icon={Left} />}
          >
            {t('editor.back')}
          </Button>
        }
        title={
          <Typography variant="h3" component="h1">
            {t('page.edit')}
          </Typography>
        }
        actions={
          <Button
            disabled={publish.isPending || !draft.title.trim()}
            onClick={() => {
              publish.mutate(
                {
                  baseVersion: draft.baseVersion,
                  title: draft.title.trim(),
                  content: draft.content
                },
                {
                  // Unless the person left the editor meanwhile.
                  onSuccess: () => {
                    void navigate(path)
                  }
                }
              )
            }}
          >
            {t('editor.publish')}
          </Button>
        }
      />
      {kept && (
        <Alert
          severity="info"
          className="u-mb-1"
          action={
            <Button variant="text" onClick={restart}>
              {t('editor.discard')}
            </Button>
          }
        >
          {t('editor.draftKept', { number: kept.baseVersion })}
        </Alert>
      )}
      <TextField
        label={t('editor.pageTitle')}
        value={draft.title}
        onChange={event => {
          change({ title: event.target.value })
        }}
        required
        fullWidth
        margin="dense"
        slotProps={{ htmlInput: { maxLength: 200 } }}
      />
      <BlocksEditor
        initial={start.content}
        label={t('editor.content')}
        lang={lang}
        loadingLabel={t('app.loading')}
        onChange={content => {
          change({ content })
        }}
      />
    </main>
  )
}
