import { useState, type ReactElement } from 'react'

import { LabelChip } from '@/ds/LabelChip'
import {
  PickerCreate,
  PickerEmpty,
  PickerOption,
  PickerPopover
} from '@/ds/Picker'
import { normalizeLabelName, type Page } from '@/domain/page'
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
  const save = useSetLabels(page)
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState(() => new Set(page.labels))
  // The search read as the backend reads a label name, so that a name the wiki
  // has, in capitals or with an accent typed apart, is not offered to create.
  const query = normalizeLabelName(search)
  // A name searched for shows among the labels once the backend has made it one.
  const names = (labels.data ?? []).map(label => label.name)
  const shown = names.filter(name => name.includes(query))
  const creatable = query !== '' && !names.includes(query)

  const apply = (next: Set<string>, onSaved?: () => void) => {
    setChosen(next)
    save.mutate([...next], {
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
    apply(next)
  }

  return (
    <PickerPopover
      label={t('labels.picker', { title: page.title })}
      anchor={anchor}
      onClose={onClose}
      searchLabel={t('labels.search')}
      search={search}
      onSearch={setSearch}
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
          disabled={save.isPending}
          onCreate={() => {
            apply(new Set(chosen).add(query), () => {
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
