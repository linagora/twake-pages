import { screen, within } from '@testing-library/react'

/** The titles on the path to the open page, from its wiki down. */
export function pathToThePage(): string[] {
  return within(screen.getByRole('navigation', { name: 'Path to this page' }))
    .getAllByRole('link')
    .map(link => link.textContent)
}
