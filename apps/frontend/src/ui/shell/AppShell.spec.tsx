import type { TwakeBarProps } from '@linagora/twake-bar'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakePagesApi } from '@/testing/fakePagesApi'
import { fakeSession, fakeUser } from '@/testing/fakeSession'
import { renderRoute } from '@/testing/renderWithProviders'

const createSdk = vi.hoisted(() => vi.fn(() => ({ status: 'ready' })))
vi.mock('@linagora/twake-sdk', () => ({ createSdk }))

// The bar is tested in its own package: only its wiring matters here
vi.mock('@linagora/twake-bar', () => ({
  SdkProvider: ({ children }: { children: ReactNode }): ReactNode => children,
  TwakeBar: ({ app, slots, onLogOut }: TwakeBarProps): ReactElement => (
    <header role="banner">
      {app.name}
      {slots?.search}
      {slots?.right}
      <button onClick={onLogOut}>Log out</button>
    </header>
  )
}))

describe('AppShell', () => {
  beforeEach(() => {
    createSdk.mockClear()
  })

  it.each(['/', '/no-such-page'])(
    'shows the platform bar and signs out from it on %s',
    async path => {
      const session = fakeSession(() => Promise.resolve(fakeUser('id-token')))
      renderRoute(path, { session })

      const bar = within(await screen.findByRole('banner'))
      expect(bar.getByText('Twake Pages')).toBeInTheDocument()
      expect(createSdk).toHaveBeenCalledWith({
        platformURL: 'https://alice.twake.test',
        idToken: 'id-token'
      })
      fireEvent.click(bar.getByRole('button', { name: 'Log out' }))

      expect(session.signOut).toHaveBeenCalled()
    }
  )

  it.each(['/', '/no-such-page'])(
    'keeps its own header, with the account menu, when the SSO did not name the platform, on %s',
    async path => {
      const session = fakeSession()
      renderRoute(path, { session })

      const header = within(await screen.findByRole('banner'))
      fireEvent.click(header.getByRole('button', { name: 'Alice Martin' }))
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }))

      expect(session.signOut).toHaveBeenCalled()
      expect(createSdk).not.toHaveBeenCalled()
    }
  )

  it('shows the name and picture the person chose in Twake Workplace', async () => {
    const pagesApi = fakePagesApi()
    pagesApi.settings.mockResolvedValue({
      version: 1,
      language: null,
      timezone: null,
      theme: 'auto',
      avatar: 'https://avatars.test/alice.png',
      name: 'Alice M.'
    })
    renderRoute('/', { pagesApi })

    const account = await within(await screen.findByRole('banner')).findByRole(
      'button',
      { name: 'Alice M.' }
    )

    expect(account.querySelector('img')).toHaveAttribute(
      'src',
      'https://avatars.test/alice.png'
    )
  })

  it('moves focus into the account menu so Escape closes it', async () => {
    renderRoute('/')

    fireEvent.click(
      within(await screen.findByRole('banner')).getByRole('button', {
        name: 'Alice Martin'
      })
    )
    const signOut = await screen.findByRole('menuitem', { name: 'Sign out' })
    await waitFor(() => {
      expect(signOut).toHaveFocus()
    })
    fireEvent.keyDown(signOut, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull()
    })
  })

  it('closes the account menu when the page changes', async () => {
    renderRoute('/no-such-page')
    fireEvent.click(
      within(await screen.findByRole('banner')).getByRole('button', {
        name: 'Alice Martin'
      })
    )
    await screen.findByRole('menu')

    fireEvent.keyDown(document.body, { key: 'g' })
    fireEvent.keyDown(document.body, { key: 'w' })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Twake Pages' })
    ).toBeVisible()
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull()
    })
  })

  it('links the app name to the home', async () => {
    renderRoute('/no-such-page')

    expect(
      within(await screen.findByRole('banner')).getByRole('link', {
        name: 'Twake Pages'
      })
    ).toHaveAttribute('href', '/')
  })

  it('lists the views in the sidebar and marks the current one', async () => {
    renderRoute('/')

    const nav = within(await screen.findByRole('navigation'))
    expect(
      nav.getAllByRole('link').map(link => link.getAttribute('href'))
    ).toEqual(['/'])
    expect(nav.getByRole('link', { name: 'Wikis' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  it('marks no view as current elsewhere', async () => {
    renderRoute('/no-such-page')

    const nav = within(await screen.findByRole('navigation'))
    expect(nav.getByRole('link', { name: 'Wikis' })).not.toHaveAttribute(
      'aria-current'
    )
  })

  it('follows the UI language in the header, page language and title', async () => {
    renderRoute('/no-such-page', { lang: 'fr' })

    fireEvent.click(
      within(await screen.findByRole('banner')).getByRole('button', {
        name: 'Alice Martin'
      })
    )
    expect(
      await screen.findByRole('menuitem', { name: 'Se déconnecter' })
    ).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('fr')
    await waitFor(() => {
      expect(document.title).toBe('Page introuvable - Twake Pages')
    })
  })
})
