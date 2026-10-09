import { screen, within } from '@testing-library/react'

/** The search field of the app bar, once the bar shows. */
export async function findAppSearch(): Promise<HTMLElement> {
  return within(await screen.findByRole('banner')).getByRole('searchbox', {
    name: 'Search'
  })
}
