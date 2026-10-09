import { Icon, Left } from '@linagora/twake-icons'
import { Alert, Button, TextField, Typography } from '@linagora/twake-mui'
import { useState, type ReactElement } from 'react'
import {
  Navigate,
  Link as RouterLink,
  useNavigate,
  useParams
} from 'react-router'

import { ApiError, EditConflict } from '@/application/pages'
import { BlocksEditor } from '@/ds/BlocksEditor'
import { PageHeader } from '@/ds/PageHeader'
import { imageHostsNotShown } from '@/domain/images'
import type { Page } from '@/domain/page'
import { useI18n } from '@/ui/i18n/useI18n'
import { useImageSources } from '@/ui/ImageSourcesProvider'
import { ConflictNotice, PublishOverDialog } from '@/ui/page/ConflictNotice'
import { ImagesNotShown } from '@/ui/page/ImagesNotShown'
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
      reload={() => page.refetch({ throwOnError: true })}
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
  reload,
  onRestart
}: {
  wikiId: string
  page: Page
  /** Reads the page again, to start from its current version. */
  reload: () => Promise<unknown>
  /** Starts the editor again, from the page as it is then. */
  onRestart: () => void
}): ReactElement {
  const { t, lang } = useI18n()
  useDocumentTitle(t('page.edit'))
  const navigate = useNavigate()
  const { kept, start, draft, change, drop } = useDraft(page)
  // Dropped once published, though the person left the editor meanwhile.
  const publish = usePublish(wikiId, page.id, drop)
  const [confirming, setConfirming] = useState(false)
  const conflict =
    publish.error instanceof EditConflict ? publish.error.current : null
  const imageSources = useImageSources()
  const hidden = imageHostsNotShown(draft.content, imageSources)
  const blockKind = useBlockKind()
  const path = pathOf(page)

  const restart = () => {
    drop()
    onRestart()
  }

  const publishFrom = (baseVersion: number) => {
    publish.mutate(
      { baseVersion, title: draft.title.trim(), content: draft.content },
      {
        // Unless the person left the editor meanwhile.
        onSuccess: () => {
          void navigate(path)
        }
      }
    )
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
              publishFrom(draft.baseVersion)
            }}
          >
            {t('editor.publish')}
          </Button>
        }
      />
      {conflict ? (
        <ConflictNotice
          current={conflict}
          onReload={() => {
            // A failed read leaves the draft and the notice as they were.
            void reload().then(restart, () => undefined)
          }}
          onPublishOver={() => {
            setConfirming(true)
          }}
        />
      ) : (
        publish.error && <PublishFailure error={publish.error} />
      )}
      {conflict && confirming && (
        <PublishOverDialog
          current={conflict}
          onConfirm={() => {
            setConfirming(false)
            publishFrom(conflict.number)
          }}
          onClose={() => {
            setConfirming(false)
          }}
        />
      )}
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
      {hidden.length > 0 && (
        <ImagesNotShown hosts={hidden} added={imageSources.added} />
      )}
      <BlocksEditor
        initial={start.content}
        label={t('editor.content')}
        lang={lang}
        loadingLabel={t('app.loading')}
        blockKind={blockKind}
        onChange={content => {
          change({ content })
        }}
      />
    </main>
  )
}

/**
 * Names the kind of a block the editor does not write, from its type: those
 * the API knows by their names, any other by its type.
 */
function useBlockKind(): (type: string) => string {
  const { t } = useI18n()
  return type => {
    switch (type) {
      case 'video':
        return t('editor.blockKind.video')
      case 'audio':
        return t('editor.blockKind.audio')
      case 'file':
        return t('editor.blockKind.file')
      case 'gristEmbed':
        return t('editor.blockKind.gristEmbed')
      default:
        return t('editor.blockKind.other', { type })
    }
  }
}

/** Why the page was not published, above the draft it keeps. */
function PublishFailure({ error }: { error: Error }): ReactElement {
  const { t } = useI18n()
  const refused = error instanceof ApiError ? error.code : null
  return (
    <Typography role="alert" color="error" className="u-mb-1">
      {refused === 'invalid_content'
        ? t('editor.invalidContent')
        : t('editor.failed')}
    </Typography>
  )
}
