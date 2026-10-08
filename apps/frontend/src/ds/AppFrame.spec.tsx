import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppFrame } from '@/ds/AppFrame'
import { renderWithProviders } from '@/testing/renderWithProviders'

describe('AppFrame', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders without leaking style props to the DOM', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    renderWithProviders(
      <AppFrame topBar={<header>Top</header>} sidebar={<nav>Side</nav>}>
        <p>Body</p>
      </AppFrame>
    )

    expect(await screen.findByText('Body')).toBeInTheDocument()
    expect(error).not.toHaveBeenCalled()
  })
})
