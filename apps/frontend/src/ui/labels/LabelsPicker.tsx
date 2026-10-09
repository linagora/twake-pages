import { Typography } from '@linagora/twake-mui'
import { useState, type ReactElement } from 'react'

import { ApiError } from '@/application/pages'
import { LabelChip } from '@/ds/LabelChip'
import {
  PickerCreate,
  PickerEmpty,
  PickerError,
  PickerOption,
  PickerPopover
} from '@/ds/Picker'
import { MAX_LABELS, normalizeLabelName, type Page } from '@/domain/page'
import { useI18n } from '@/ui/i18n/useI18n'
import { useSetLabels, useWikiLabels } from '@/ui/wiki/queries'

/**
 * As Twake Tasks' picker of a task's labels, but a label is made by giving it
 * to the page, as the backend makes a label it is given the name of.
 */
export function LabelsPicker({
  page,
  anchor,
  onClose
}: {
  page: Page
  anchor: HTMLElement
  onClose: () => void
}): ReactElement {
  const { t } = useI18n()
  const labels = useWikiLabels(page.wikiId)
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState(() => new Set(page.labels))
  // Twake Tasks says only that the save failed: the picker says why, without
  // asking the backend, which takes at most MAX_LABELS names.
  const [tooMany, setTooMany] = useState(false)
  // Making a label saves the page's labels too, but on its own, as making a
  // label is in Twake Tasks, so that what it says of a name goes as the name
  // changes.
  const create = useSetLabels(page)
  const save = useSetLabels(page)
  // The search read as the backend reads a label name, so that a name the wiki
  // has, in capitals or with an accent typed apart, is not offered to create.
  const query = normalizeLabelName(search)
  // A name searched for shows among the labels once the backend has made it one.
  const names = (labels.data ?? []).map(label => label.name)
  const shown = names.filter(name => name.includes(query))
  const creatable = query !== '' && !names.includes(query)
  const invalid =
    create.error instanceof ApiError && create.error.code === 'invalid_label'

  const apply = (
    change: typeof save,
    next: Set<string>,
    onSaved?: () => void
  ) => {
    setTooMany(next.size > MAX_LABELS)
    if (next.size > MAX_LABELS) return
    setChosen(next)
    change.mutate([...next], {
      onSuccess: () => {
        onSaved?.()
      },
      onError: () => {
        setChosen(new Set(page.labels))
      }
    })
  }
  const toggle = (name: string) => {
    const next = new Set(chosen)
    if (!next.delete(name)) next.add(name)
    apply(save, next)
  }

  return (
    <PickerPopover
      label={t('labels.picker', { title: page.title })}
      anchor={anchor}
      onClose={onClose}
      searchLabel={t('labels.search')}
      search={search}
      onSearch={value => {
        setSearch(value)
        create.reset()
      }}
      footer={
        (labels.isError || tooMany || create.isError || save.isError) && (
          <>
            {labels.isError && (
              <PickerError
                retryLabel={t('labels.retry')}
                onRetry={() => {
                  void labels.refetch()
                }}
              >
                {t('labels.loadFailed')}
              </PickerError>
            )}
            {(tooMany || create.isError || save.isError) && (
              <Typography role="alert" variant="caption" color="error">
                {tooMany
                  ? t('labels.tooMany', { max: MAX_LABELS })
                  : invalid
                    ? t('labels.invalid')
                    : t('labels.saveFailed')}
              </Typography>
            )}
          </>
        )
      }
    >
      {shown.map(name => (
        <PickerOption
          key={name}
          checked={chosen.has(name)}
          onToggle={() => {
            toggle(name)
          }}
        >
          <LabelChip name={name} highlight={query} />
        </PickerOption>
      ))}
      {creatable && (
        <PickerCreate
          disabled={create.isPending}
          onCreate={() => {
            apply(create, new Set(chosen).add(query), () => {
              setSearch('')
            })
          }}
        >
          {t('labels.create', { name: query })}
        </PickerCreate>
      )}
      {labels.isSuccess && shown.length === 0 && !creatable && (
        <PickerEmpty>{t('labels.hint')}</PickerEmpty>
      )}
    </PickerPopover>
  )
}
