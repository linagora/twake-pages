import { screen, waitFor, within } from '@testing-library/react'

export function findEmptyState(title: string): Promise<HTMLElement> {
  return waitFor(() => {
    const state = screen
      .getAllByRole('status')
      .find(element => within(element).queryByText(title))
    if (!state) throw new Error(`No empty state titled "${title}"`)
    return state
  })
}
