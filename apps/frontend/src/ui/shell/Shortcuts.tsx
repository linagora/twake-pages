import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography
} from '@linagora/twake-mui'
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  type ReactElement
} from 'react'
import { useNavigate } from 'react-router'

import { useI18n } from '@/ui/i18n/useI18n'

const GO = {
  w: { path: '/', label: 'wikis.title' }
} as const

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

export function useShortcuts(actions: { help: () => void }): void {
  const navigate = useNavigate()
  const going = useRef(false)

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (typing(event.target)) return
    if (going.current) {
      going.current = false
      if (event.key in GO) {
        event.preventDefault()
        void navigate(GO[event.key as keyof typeof GO].path)
      }
      return
    }
    const action = {
      g: () => {
        going.current = true
      },
      '?': actions.help
    }[event.key]
    if (!action) return
    event.preventDefault()
    action()
  })

  useEffect(() => {
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [])
}

export function ShortcutsHelp({
  onClose
}: {
  onClose: () => void
}): ReactElement {
  const { t } = useI18n()
  const titleId = useId()
  const rows = [
    ...Object.entries(GO).map(([key, { label }]) => [
      t('shortcuts.then', { key }),
      t(label)
    ]),
    ['?', t('shortcuts.title')]
  ]
  return (
    <Dialog open onClose={onClose} aria-labelledby={titleId}>
      <DialogTitle id={titleId}>{t('shortcuts.title')}</DialogTitle>
      <DialogContent>
        <dl>
          {rows.map(([keys, label]) => (
            <div key={keys} className="u-flex u-mb-half">
              <Typography component="dt" className="u-w-4 u-mr-1">
                <kbd>{keys}</kbd>
              </Typography>
              <Typography component="dd">{label}</Typography>
            </div>
          ))}
        </dl>
      </DialogContent>
      <DialogActions>
        <Button variant="secondary" onClick={onClose}>
          {t('shortcuts.close')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
