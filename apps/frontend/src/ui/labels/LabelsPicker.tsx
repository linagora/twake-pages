import { useState, type ReactElement } from 'react'

import { LabelChip } from '@/ds/LabelChip'
import { PickerOption, PickerPopover } from '@/ds/Picker'
import type { Page } from '@/domain/page'
import { useI18n } from '@/ui/i18n/useI18n'
import { useSetLabels, useWikiLabels } from '@/ui/wiki/queries'

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
  const query = search.trim().toLowerCase()
  const shown = (labels.data ?? [])
    .map(label => label.name)
    .filter(name => name.includes(query))

  const apply = (next: Set<string>) => {
    setChosen(next)
    save.mutate([...next], {
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
    </PickerPopover>
  )
}
