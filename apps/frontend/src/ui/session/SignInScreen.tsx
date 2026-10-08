import { Button } from '@linagora/twake-mui'
import { useLayoutEffect, useRef, type ReactElement } from 'react'

import { useI18n } from '@/ui/i18n/useI18n'

export type SignInPhase = 'waiting' | 'failed' | 'timeout'

export interface SignInScreenProps {
  phase: SignInPhase
  status: string
  leaving: boolean
  onRetry: () => void
  onSignIn: () => void
}

const lineAnimation = (line: Element | null): Animation | undefined =>
  line && 'getAnimations' in line ? line.getAnimations()[0] : undefined

export function SignInScreen({
  phase,
  status,
  leaving,
  onRetry,
  onSignIn
}: SignInScreenProps): ReactElement {
  const { t } = useI18n()
  const line = useRef<SVGPathElement>(null)

  // index.html draws this screen before any script runs: carry on from the
  // same point of its loop so the line being written does not jump.
  useLayoutEffect(() => {
    const page = document.getElementById('splash')
    const time = lineAnimation(
      page?.querySelector('.splash-line') ?? null
    )?.currentTime
    const mine = lineAnimation(line.current)
    if (mine && typeof time === 'number') mine.currentTime = time
    page?.remove()
  }, [])

  const classes = ['splash']
  if (phase !== 'waiting') classes.push('splash-stopped')
  if (leaving) classes.push('splash-leaving')

  return (
    <div className={classes.join(' ')} aria-hidden={leaving || undefined}>
      <svg
        className="splash-icon"
        viewBox="0 0 13 16"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M8 0H1.6C.72 0 .008.72.008 1.6L0 14.4c0 .88.712 1.6 1.592 1.6H11.2c.88 0 1.6-.72 1.6-1.6V4.8zm3.2 14.4H1.6V1.6h5.6v4h4z" />
        <path
          ref={line}
          className="splash-line"
          pathLength={1}
          d="M3.2 10.4q.8-1.6 1.6 0t1.6 0 1.6 0 1.6 0"
        />
      </svg>
      {phase === 'waiting' ? (
        <>
          <p className="splash-name">{t('app.name')}</p>
          <p className="splash-status" role="status">
            {status}
          </p>
        </>
      ) : (
        <>
          <h1 className="splash-title">{t(`session.${phase}.title`)}</h1>
          <p className="splash-hint">{t(`session.${phase}.hint`)}</p>
          <div className="splash-actions">
            <Button variant="contained" onClick={onRetry}>
              {t('session.retry')}
            </Button>
            <Button variant="text" onClick={onSignIn}>
              {t('session.backToSignIn')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
