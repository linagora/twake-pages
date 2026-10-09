import { screen, waitFor, within } from '@testing-library/react'

/** The empty state of a page that doesn't exist or the person can't open. */
export const PAGE_NOT_FOUND = "This page doesn't exist, or you can't open it."

export function findEmptyState(title: string): Promise<HTMLElement> {
  return waitFor(() => {
    const state = screen
      .getAllByRole('status')
      .find(element => within(element).queryByText(title))
    if (!state) throw new Error(`No empty state titled "${title}"`)
    return state
  })
}
