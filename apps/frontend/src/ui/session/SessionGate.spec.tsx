import { readFileSync } from 'node:fs'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeSession, fakeUser } from '@/testing/fakeSession'
import { renderWithProviders } from '@/testing/renderWithProviders'

const page = new DOMParser().parseFromString(
  readFileSync('index.html', 'utf8'),
  'text/html'
)

const neverSignedIn = () => fakeSession(() => new Promise(() => undefined))

const failing = () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  return fakeSession(() => Promise.reject(new Error('bad state')))
}

describe('SessionGate', () => {
  beforeEach(() => {
    document.body.innerHTML = page.body.innerHTML
    window.history.replaceState(null, '', '/')
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('takes over the page splash while signing in, in the user language', () => {
    renderWithProviders(<p>app</p>, { session: neverSignedIn(), lang: 'fr' })

    expect(document.getElementById('splash')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Connexion en cours…')
    expect(screen.getByText('Twake Pages')).toBeInTheDocument()
    expect(screen.queryByText('app')).not.toBeInTheDocument()
  })

  it('says it is opening a wiki', () => {
    window.history.replaceState(null, '', '/wikis/w1')
    renderWithProviders(<p>app</p>, { session: neverSignedIn() })

    expect(screen.getByRole('status')).toHaveTextContent('Opening your wiki')
  })

  it('keeps saying it on the way back from the sign-in page', () => {
    window.history.replaceState(null, '', '/wikis/w1')
    renderWithProviders(<p>app</p>, { session: neverSignedIn() }).unmount()
    window.history.replaceState(null, '', '/auth/callback?code=c&state=s')

    renderWithProviders(<p>app</p>, { session: neverSignedIn() })

    expect(screen.getByRole('status')).toHaveTextContent('Opening your wiki')
  })

  it('reassures when the sign-in takes a while, then offers a way out', () => {
    vi.useFakeTimers()
    renderWithProviders(<p>app</p>, { session: neverSignedIn() })

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByRole('status')).toHaveTextContent(
      'Still connecting to your account…'
    )

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(
      screen.getByRole('heading', { name: 'This is taking longer than usual' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('The sign-in service is slow to answer.')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Try again' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Back to sign-in' })
    ).toBeInTheDocument()
  })

  it('keeps saying it is slow when the sign-in gives up afterwards', async () => {
    vi.useFakeTimers()
    let giveUp: (error: Error) => void = () => undefined
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const session = fakeSession(
      () =>
        new Promise((_, reject) => {
          giveUp = reject
        })
    )
    renderWithProviders(<p>app</p>, { session })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000)
      giveUp(new Error('discovery timed out'))
    })

    expect(
      screen.getByRole('heading', { name: 'This is taking longer than usual' })
    ).toBeInTheDocument()
  })

  it('waits for the sign-in before showing the app', async () => {
    let finish: (value: null) => void = () => undefined
    const session = fakeSession(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    renderWithProviders(<p>app</p>, { session })

    await act(async () => {
      finish(null)
      await Promise.resolve()
    })
    expect(screen.queryByText('app')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows the app once signed in, starting the sign-in once', async () => {
    const session = fakeSession()
    renderWithProviders(<p>app</p>, { session })

    expect(await screen.findByText('app')).toBeInTheDocument()
    expect(session.start).toHaveBeenCalledTimes(1)
  })

  it('fades the splash out over the app, then removes it', async () => {
    vi.useFakeTimers()
    renderWithProviders(<p>app</p>)
    await act(() => Promise.resolve())

    expect(screen.getByText('app')).toBeInTheDocument()
    expect(screen.getByText('Twake Pages')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(screen.queryByText('Twake Pages')).not.toBeInTheDocument()
  })

  it('explains a failed sign-in and offers to sign in again', async () => {
    const session = failing()
    renderWithProviders(<p>app</p>, { session })

    expect(
      await screen.findByRole('heading', { name: 'We couldn’t sign you in' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Something went wrong while connecting to your account.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign-in' }))

    expect(session.signIn).toHaveBeenCalled()
  })

  it('shows the app when signing in again succeeds without leaving the page', async () => {
    const session = failing()
    vi.mocked(session.signIn).mockResolvedValue(fakeUser())
    renderWithProviders(<p>app</p>, { session })

    fireEvent.click(
      await screen.findByRole('button', { name: 'Back to sign-in' })
    )

    expect(await screen.findByText('app')).toBeInTheDocument()
  })

  it('signs in again when another tab signs out', async () => {
    const session = fakeSession()
    renderWithProviders(<p>app</p>, { session })
    await screen.findByText('app')
    await act(() => Promise.resolve())

    session.endElsewhere()

    expect(session.signIn).toHaveBeenCalled()
  })
})
