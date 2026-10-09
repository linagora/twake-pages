import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/application/pages'
import { findEmptyState, PAGE_NOT_FOUND } from '@/testing/emptyState'
import { fakePagesApi, paragraph } from '@/testing/fakePagesApi'
import { renderRoute, WIKI_BASES } from '@/testing/renderWithProviders'
import { followZone } from '@/ui/settings/zone'

/**
 * Onboarding, which Bob renamed Welcome as its version 2, on the evening of
 * March 2, 2100 in Tokyo.
 */
async function onboarding() {
  const pagesApi = fakePagesApi()
  const wiki = pagesApi.withWiki({ members: { 'bob@example.com': 'editor' } })
  const page = pagesApi.withPage(wiki.id, {
    title: 'Onboarding',
    content: [paragraph('Ask for a laptop')]
  })
  // Later than any time the fake gave before, as its times only move on.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2100-03-02T09:30:00Z'))
  await pagesApi.signedInAs('bob@example.com', 'Bob Durand').publish(page.id, {
    baseVersion: 1,
    title: 'Welcome',
    content: [paragraph('Bring your badge')]
  })
  vi.useRealTimers()
  return { pagesApi, wiki, page }
}

/** The versions the history shows, from the top. */
async function findVersions(): Promise<HTMLElement[]> {
  const list = await screen.findByRole('list', { name: 'Versions' })
  return within(list).getAllByRole('listitem')
}

afterEach(() => {
  followZone(null)
})

describe('the history of a page', () => {
  it('lists its versions, newest first', async () => {
    const { pagesApi, wiki, page } = await onboarding()
    await pagesApi.restoreVersion(page.id, 1)
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}/history`, { pagesApi })

    const versions = await findVersions()
    expect(versions).toHaveLength(3)
    expect(versions[0]).toHaveTextContent('Version 3 · Onboarding')
    expect(versions[1]).toHaveTextContent('Version 2 · Welcome')
    expect(versions[2]).toHaveTextContent('Version 1 · Onboarding')
  })

  it('says who published each version, and when, in the timezone of the person', async () => {
    const { pagesApi, wiki, page } = await onboarding()
    followZone('Asia/Tokyo')
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}/history`, { pagesApi })

    const versions = await findVersions()
    expect(versions[0]).toHaveTextContent(
      'Published by Bob Durand on Mar 2, 2100, 6:30 PM'
    )
  })

  it('says which version a restored version restores', async () => {
    const { pagesApi, wiki, page } = await onboarding()
    await pagesApi.restoreVersion(page.id, 1)
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}/history`, { pagesApi })

    const versions = await findVersions()
    expect(versions[0]).toHaveTextContent('Restored from version 1')
    expect(versions[1]).not.toHaveTextContent('Restored')
  })

  it('lists a version published elsewhere while it is open', async () => {
    const { pagesApi, wiki, page } = await onboarding()
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}/history`, { pagesApi })
    await findVersions()

    await act(() =>
      pagesApi.signedInAs('bob@example.com').publish(page.id, {
        baseVersion: 2,
        title: 'Hello',
        content: [paragraph('Bring a pen')]
      })
    )

    await waitFor(() => {
      const list = screen.getByRole('list', { name: 'Versions' })
      expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(
        'Version 3 · Hello'
      )
    })
  })

  it.each(WIKI_BASES)(
    'leads from %s/<wiki>/pages/<page>/history back to the page',
    async base => {
      const { pagesApi, wiki, page } = await onboarding()
      renderRoute(`${base}/${wiki.id}/pages/${page.id}/history`, { pagesApi })

      expect(
        await screen.findByRole('link', { name: 'Back to the page' })
      ).toHaveAttribute('href', `${base}/${wiki.id}/pages/${page.id}`)
    }
  )

  it('shows the home page under the name of its wiki, and leads back to it', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ kind: 'personal' })
    renderRoute(`/wikis/${wiki.id}/pages/${wiki.homePageId}/history`, {
      lang: 'fr',
      pagesApi
    })

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Historique de la page Personnel'
      })
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'Retour à la page' })
    ).toHaveAttribute('href', `/wikis/${wiki.id}`)
  })

  it('is shown for a page in the trash', async () => {
    const { pagesApi, wiki, page } = await onboarding()
    await pagesApi.deletePage(page.id)
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}/history`, { pagesApi })

    expect(await findVersions()).toHaveLength(2)
  })

  it('is not found below another wiki than its own', async () => {
    const { pagesApi, wiki } = await onboarding()
    const other = pagesApi.withWiki({ name: 'Board meetings' })
    const minutes = pagesApi.withPage(other.id, { title: 'Minutes' })
    renderRoute(`/wikis/${wiki.id}/pages/${minutes.id}/history`, { pagesApi })

    expect(await findEmptyState(PAGE_NOT_FOUND)).toBeInTheDocument()
    expect(screen.queryByText(/Minutes/)).not.toBeInTheDocument()
  })

  it('shows placeholders while its versions load', async () => {
    const { pagesApi, wiki, page } = await onboarding()
    pagesApi.listVersions.mockReturnValue(new Promise(() => undefined))
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}/history`, { pagesApi })
    await screen.findByRole('heading', {
      level: 1,
      name: 'History of Welcome'
    })

    expect(
      within(screen.getByRole('main')).getByRole('progressbar', {
        name: 'Loading'
      })
    ).toBeInTheDocument()
  })

  it('says so when its versions cannot be loaded', async () => {
    const { pagesApi, wiki, page } = await onboarding()
    pagesApi.listVersions.mockRejectedValue(new ApiError(403, null))
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}/history`, { pagesApi })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The history could not be loaded.'
    )
  })
})
