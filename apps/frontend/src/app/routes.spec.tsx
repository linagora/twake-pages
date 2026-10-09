import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { fakePagesApi } from '@/testing/fakePagesApi'
import { renderRoute, WIKI_BASES } from '@/testing/renderWithProviders'

// Below a wiki; :page stands for one of its pages.
const wikiScreens: [path: string, heading: string][] = [
  ['', 'Handbook'],
  ['/pages/:page', 'Release checklist'],
  ['/pages/:page/edit', 'Edit page'],
  ['/pages/:page/history', 'History of Release checklist'],
  ['/pages/:page/history/1', 'Release checklist, version 1'],
  ['/labels/howto', 'Pages labelled howto'],
  ['/search?q=release', 'Search this wiki'],
  ['/trash', 'Trash']
]

/** Renders a path below a wiki of the person, and answers the wiki's own. */
function renderInWiki(base: (typeof WIKI_BASES)[number], path: string) {
  const pagesApi = fakePagesApi()
  const wiki = pagesApi.withWiki({ name: 'Handbook' })
  const page = pagesApi.withPage(wiki.id, { title: 'Release checklist' })
  const wikiPath = `${base}/${wiki.id}`
  renderRoute(wikiPath + path.replace(':page', page.id), { pagesApi })
  return wikiPath
}

describe('the routes', () => {
  it.each([
    ['/', 'Twake Pages', 'Twake Pages'],
    ['/search?q=release', 'Search', 'Search - Twake Pages'],
    ['/notifications', 'Notifications', 'Notifications - Twake Pages']
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
    'show /wikis/<wiki>%s as its screen',
    async (path, heading) => {
      renderInWiki('/wikis', path)

      expect(
        await screen.findByRole('heading', { level: 1, name: heading })
      ).toBeVisible()
      await waitFor(() => {
        expect(document.title).toBe(`${heading} - Twake Pages`)
      })
    }
  )

  it.each(wikiScreens)(
    'show /embed/wikis/<wiki>%s as its screen, in the frame of TwakeSpace',
    async (path, heading) => {
      renderInWiki('/embed/wikis', path)

      expect(
        await screen.findByRole('heading', { level: 1, name: heading })
      ).toBeVisible()
      expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    }
  )

  it.each(WIKI_BASES)(
    'lead from %s/<wiki> to the home page, the search and the trash of the wiki',
    async base => {
      const wikiPath = renderInWiki(base, '/pages/:page')

      const wiki = within(
        await screen.findByRole('navigation', { name: 'Wiki' })
      )
      expect(wiki.getByRole('link', { name: 'Home page' })).toHaveAttribute(
        'href',
        wikiPath
      )
      expect(wiki.getByRole('link', { name: 'Search' })).toHaveAttribute(
        'href',
        `${wikiPath}/search`
      )
      expect(wiki.getByRole('link', { name: 'Trash' })).toHaveAttribute(
        'href',
        `${wikiPath}/trash`
      )
    }
  )
})
