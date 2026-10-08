import { screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderRoute, renderWithProviders } from '@/testing/renderWithProviders'
import { CrashScreen } from '@/ui/shell/Problems'

describe('problem pages', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('says a page does not exist and keeps the app around it', async () => {
    renderRoute('/no-such-page')

    expect(await screen.findByRole('navigation')).toBeInTheDocument()
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Page not found'
    )
    expect(screen.getByRole('link', { name: 'Back to wikis' })).toHaveAttribute(
      'href',
      '/'
    )
  })

  it('offers a reload when a screen breaks', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const Broken = () => {
      throw new Error('boom')
    }
    const router = createMemoryRouter([
      { path: '/', element: <Broken />, errorElement: <CrashScreen /> }
    ])
    renderWithProviders(<RouterProvider router={router} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong'
    )
    expect(screen.getByRole('button', { name: 'Reload' })).toBeVisible()
  })
})
