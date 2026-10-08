import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderRoute } from '@/testing/renderWithProviders'

const wikiScreens: [path: string, heading: string][] = [
  ['', 'Home page'],
  ['/pages/p1', 'Page'],
  ['/pages/p1/edit', 'Edit page'],
  ['/pages/p1/history', 'Page history'],
  ['/labels/howto', 'Pages labelled howto'],
  ['/search?q=release', 'Search this wiki'],
  ['/trash', 'Trash']
]

describe('the routes', () => {
  it.each([
    ['/', 'Twake Pages', 'Twake Pages'],
    ['/search?q=release', 'Search', 'Search - Twake Pages'],
    ['/notifications', 'Notifications', 'Notifications - Twake Pages'],
    ...wikiScreens.map(([path, heading]) => [
      `/wikis/w1${path}`,
      heading,
      `${heading} - Twake Pages`
    ])
  ])('show %s as its screen', async (path, heading, title) => {
    renderRoute(path)

    expect(
      await screen.findByRole('heading', { level: 1, name: heading })
    ).toBeVisible()
    await waitFor(() => {
      expect(document.title).toBe(title)
    })
  })

  it.each(wikiScreens)(
    'show /embed/wikis/w1%s as its screen, in the frame of TwakeSpace',
    async (path, heading) => {
      renderRoute(`/embed/wikis/w1${path}`)

      expect(
        await screen.findByRole('heading', { level: 1, name: heading })
      ).toBeVisible()
      expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    }
  )

  it.each(['/wikis/w1', '/embed/wikis/w1'])(
    'lead from %s to the home page, the search and the trash of the wiki',
    async base => {
      renderRoute(`${base}/pages/p1`)

      const wiki = within(
        await screen.findByRole('navigation', { name: 'Wiki' })
      )
      expect(wiki.getByRole('link', { name: 'Home page' })).toHaveAttribute(
        'href',
        base
      )
      expect(wiki.getByRole('link', { name: 'Search' })).toHaveAttribute(
        'href',
        `${base}/search`
      )
      expect(wiki.getByRole('link', { name: 'Trash' })).toHaveAttribute(
        'href',
        `${base}/trash`
      )
    }
  )
})
