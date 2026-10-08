import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { UserSettings } from '@/application/pages'
import { fakePagesApi, NO_SETTINGS } from '@/testing/fakePagesApi'
import { renderWithProviders } from '@/testing/renderWithProviders'
import { useI18n } from '@/ui/i18n/useI18n'
import { FollowSettings } from '@/ui/settings/FollowSettings'
import { followZone, localZone } from '@/ui/settings/zone'

function Probe() {
  const { t } = useI18n()
  return <p>{`${t('session.signingIn')} ${localZone()}`}</p>
}

function renderWith(settings: Partial<UserSettings>, lang: 'en' | 'fr' = 'en') {
  const pagesApi = fakePagesApi()
  pagesApi.settings = vi.fn(() =>
    Promise.resolve({ ...NO_SETTINGS, ...settings })
  )
  return renderWithProviders(
    <FollowSettings>
      <Probe />
    </FollowSettings>,
    { pagesApi, lang }
  )
}

const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone

afterEach(() => {
  followZone(null)
  document.documentElement.removeAttribute('data-theme')
})

describe('FollowSettings', () => {
  it("speaks the person's language", async () => {
    renderWith({ language: 'fr' })

    expect(await screen.findByText(/^Connexion en cours…/)).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('fr')
  })

  it('keeps the browser language without one, or with one it does not speak', async () => {
    renderWith({ language: 'de' }, 'fr')

    expect(await screen.findByText(/^Connexion en cours…/)).toBeInTheDocument()
  })

  it("takes the person's theme", async () => {
    renderWith({ theme: 'dark' })

    await screen.findByText(/Signing you in/)
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    })
  })

  it("shows times in the person's timezone", async () => {
    renderWith({ timezone: 'Pacific/Kiritimati' })

    expect(
      await screen.findByText('Signing you in… Pacific/Kiritimati')
    ).toBeInTheDocument()
  })

  it('keeps the browser timezone without a valid one', async () => {
    renderWith({ timezone: 'Mars/Olympus_Mons' })

    expect(
      await screen.findByText(`Signing you in… ${browserZone}`)
    ).toBeInTheDocument()
  })

  it('follows a change made in Twake Workplace while the app is open', async () => {
    const pagesApi = fakePagesApi()
    let held: UserSettings = { ...NO_SETTINGS, version: 1, language: 'fr' }
    pagesApi.settings = vi.fn(() => Promise.resolve(held))
    let push: (version: number) => void = () => undefined
    pagesApi.watchSettings = vi.fn(onVersion => {
      push = onVersion
      return () => undefined
    })
    renderWithProviders(
      <FollowSettings>
        <Probe />
      </FollowSettings>,
      { pagesApi }
    )
    await screen.findByText(/^Connexion en cours…/)

    held = { ...held, version: 2, language: 'en' }
    push(1)
    push(2)

    expect(await screen.findByText(/^Signing you in…/)).toBeInTheDocument()
    expect(pagesApi.settings).toHaveBeenCalledTimes(2)
  })

  it('shows the app with the browser settings when they cannot be read', async () => {
    const pagesApi = fakePagesApi()
    pagesApi.settings = vi.fn(() => Promise.reject(new Error('down')))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderWithProviders(
      <FollowSettings>
        <Probe />
      </FollowSettings>,
      { pagesApi }
    )

    expect(
      await screen.findByText(`Signing you in… ${browserZone}`)
    ).toBeInTheDocument()
  })

  it('reads the settings again when the stream answers after a failed read', async () => {
    const pagesApi = fakePagesApi()
    pagesApi.settings = vi
      .fn<typeof pagesApi.settings>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ ...NO_SETTINGS, version: 1, language: 'fr' })
    let push: (version: number) => void = () => undefined
    pagesApi.watchSettings = vi.fn(onVersion => {
      push = onVersion
      return () => undefined
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderWithProviders(
      <FollowSettings>
        <Probe />
      </FollowSettings>,
      { pagesApi }
    )
    await screen.findByText(`Signing you in… ${browserZone}`)

    push(1)

    expect(await screen.findByText(/^Connexion en cours…/)).toBeInTheDocument()
  })
})
