import { useState, type ReactElement } from 'react'
import { useMatch, useNavigate, useSearchParams } from 'react-router'

import { SearchBar } from '@/ds/SearchBar'
import { useI18n } from '@/ui/i18n/useI18n'

/**
 * A field that searches its words once sent, as Twake Tasks' does, and shows
 * the words `searched` whenever they change.
 */
export function SearchField({
  label,
  searched,
  onSearch,
  size = 'medium'
}: {
  label: string
  searched: string
  onSearch: (text: string) => void
  size?: 'small' | 'medium'
}): ReactElement {
  const [text, setText] = useState(searched)
  const [shown, setShown] = useState(searched)
  if (searched !== shown) {
    setShown(searched)
    setText(searched)
  }
  return (
    <SearchBar
      role="search"
      aria-label={label}
      size={size}
      placeholder={label}
      value={text}
      onChange={event => {
        setText(event.target.value)
      }}
      onSubmit={event => {
        event.preventDefault()
        if (!text.trim()) return
        onSearch(text.trim())
      }}
      componentsProps={{
        inputBase: { inputProps: { type: 'search', maxLength: 200 } }
      }}
    />
  )
}

/**
 * The search of every wiki, in the app bar. It shows the words of the search
 * open, and none elsewhere: a wiki's search has its own field, which TwakeSpace
 * shows without the app bar.
 */
export function AppSearchField({
  size
}: {
  size: 'small' | 'medium'
}): ReactElement {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const open = useMatch('/search') !== null
  return (
    <SearchField
      label={t('search.label')}
      searched={open ? (params.get('q')?.trim() ?? '') : ''}
      onSearch={text => {
        void navigate(`/search?${new URLSearchParams({ q: text }).toString()}`)
      }}
      size={size}
    />
  )
}
