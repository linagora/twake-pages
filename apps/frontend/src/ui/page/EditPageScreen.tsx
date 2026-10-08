import { Icon, Left } from '@linagora/twake-icons'
import { Button, TextField, Typography } from '@linagora/twake-mui'
import { useState, type ReactElement } from 'react'
import {
  Navigate,
  Link as RouterLink,
  useNavigate,
  useParams
} from 'react-router'

import { BlocksEditor } from '@/ds/BlocksEditor'
import { editableBlocks } from '@/ds/editorBlocks'
import { PageHeader } from '@/ds/PageHeader'
import type { Page } from '@/domain/page'
import { useI18n } from '@/ui/i18n/useI18n'
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

  // The page as it is, for a person who does not write it. The wiki is read
  // by now, as its layout waits for it.
  if (!editable) return <Navigate to={pathOf(page.data)} replace />

  return <PageEditor key={pageId} wikiId={wikiId} page={page.data} />
}

// The home page shows under the name of its wiki.
const pathOf = (page: Page) => (page.home ? '..' : `../pages/${page.id}`)

/**
 * The title and the blocks of a page, written from the version it shows
 * first: a newer one, published meanwhile, does not move the draft.
 */
function PageEditor({
  wikiId,
  page
}: {
  wikiId: string
  page: Page
}): ReactElement {
  const { t, lang } = useI18n()
  useDocumentTitle(t('page.edit'))
  const navigate = useNavigate()
  const publish = usePublish(wikiId, page.id)
  const [start] = useState(() => ({
    ...page,
    content: editableBlocks(page.content)
  }))
  const [title, setTitle] = useState(start.title)
  const [blocks, setBlocks] = useState(start.content)
  const path = pathOf(start)

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
            disabled={publish.isPending || !title.trim()}
            onClick={() => {
              publish.mutate(
                {
                  baseVersion: start.version,
                  title: title.trim(),
                  content: blocks
                },
                {
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
      <TextField
        label={t('editor.pageTitle')}
        value={title}
        onChange={event => {
          setTitle(event.target.value)
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
        onChange={setBlocks}
      />
    </main>
  )
}
