import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { NewPage } from '@/application/pages'
import { findEmptyState } from '@/testing/emptyState'
import {
  fakePagesApi,
  paragraph,
  type FakePagesApi
} from '@/testing/fakePagesApi'
import { renderRoute } from '@/testing/renderWithProviders'

const BOB = 'bob@example.com'
const PAGE_NOT_FOUND = "This page doesn't exist, or you can't open it."
const WIKI_NOT_FOUND = "This wiki doesn't exist, or you can't open it."

/** Alice's Handbook, with its Onboarding page, which Bob runs with her. */
function sharedHandbook() {
  const pagesApi = fakePagesApi()
  const wiki = pagesApi.withWiki({
    name: 'Handbook',
    members: { [BOB]: 'admin' }
  })
  const onboarding = pagesApi.withPage(wiki.id, { title: 'Onboarding' })
  return { pagesApi, bob: pagesApi.signedInAs(BOB), wiki, onboarding }
}

const OFFBOARDING: NewPage = {
  title: 'Offboarding',
  kind: 'document',
  parentId: null
}

/** The stream of the wiki, down until the test reconnects it. */
function streamDown(pagesApi: FakePagesApi) {
  let reconnect: (version: number) => void = () => undefined
  pagesApi.watchWiki.mockImplementation((wikiId, onVersion) => {
    reconnect = onVersion
    return () => undefined
  })
  return {
    reconnect: (version: number) => {
      act(() => {
        reconnect(version)
      })
    }
  }
}

describe('a wiki open in two places', () => {
  it('shows the new version of the open page, published elsewhere', async () => {
    const { pagesApi, bob, wiki, onboarding } = sharedHandbook()
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}`, { pagesApi })
    await screen.findByRole('heading', { level: 1, name: 'Onboarding' })

    await act(() =>
      bob.publish(onboarding.id, {
        baseVersion: 1,
        title: 'Welcome',
        content: [paragraph('Read this first.')]
      })
    )

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Welcome' })
    ).toBeVisible()
    expect(screen.getByText('Read this first.')).toBeVisible()
  })

  it('shows the name and description given elsewhere', async () => {
    const { pagesApi, bob, wiki } = sharedHandbook()
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })
    await screen.findByRole('heading', { level: 1, name: 'Handbook' })

    await act(() =>
      bob.renameWiki(wiki.id, { name: 'Guide', description: 'How we work' })
    )

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Guide' })
    ).toBeVisible()
    expect(screen.getByText('How we work')).toBeVisible()
  })

  it('says the open page is not found once deleted for good elsewhere', async () => {
    const { pagesApi, bob, wiki, onboarding } = sharedHandbook()
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}`, { pagesApi })
    await screen.findByRole('heading', { level: 1, name: 'Onboarding' })

    await act(async () => {
      await bob.deletePage(onboarding.id)
      await bob.purgePage(wiki.id, onboarding.id)
    })

    expect(await findEmptyState(PAGE_NOT_FOUND)).toBeInTheDocument()
  })

  it('says the wiki is not found once deleted elsewhere', async () => {
    const { pagesApi, bob, wiki } = sharedHandbook()
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })
    await screen.findByRole('heading', { level: 1, name: 'Handbook' })

    await act(() => bob.deleteWiki(wiki.id))

    expect(await findEmptyState(WIKI_NOT_FOUND)).toBeInTheDocument()
  })

  it('catches up on a change missed while the stream was reconnecting', async () => {
    const { pagesApi, bob, wiki } = sharedHandbook()
    const stream = streamDown(pagesApi)
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })
    await screen.findByRole('treeitem', { name: 'Onboarding' })

    await bob.createPage(wiki.id, OFFBOARDING)
    stream.reconnect((await bob.getWiki(wiki.id)).version)

    expect(
      await screen.findByRole('treeitem', { name: 'Offboarding' })
    ).toBeVisible()
  })

  it('catches up on the tree when only the wiki was read again since', async () => {
    const { pagesApi, bob, wiki } = sharedHandbook()
    const stream = streamDown(pagesApi)
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })
    await screen.findByRole('treeitem', { name: 'Onboarding' })
    await bob.createPage(wiki.id, OFFBOARDING)
    await bob.renameWiki(wiki.id, { name: 'Guide' })

    // The open page reads the wiki again for its path, not the tree.
    fireEvent.click(screen.getByRole('treeitem', { name: 'Onboarding' }))
    await screen.findByRole('link', { name: 'Guide' })
    stream.reconnect((await bob.getWiki(wiki.id)).version)

    expect(
      await screen.findByRole('treeitem', { name: 'Offboarding' })
    ).toBeVisible()
  })

  it.each(['/wikis', '/embed/wikis'])(
    'shows in the tree a page added elsewhere, at %s/<wiki>',
    async base => {
      const { pagesApi, bob, wiki } = sharedHandbook()
      renderRoute(`${base}/${wiki.id}`, { pagesApi })
      await screen.findByRole('treeitem', { name: 'Onboarding' })

      await act(() => bob.createPage(wiki.id, OFFBOARDING))

      expect(
        await screen.findByRole('treeitem', { name: 'Offboarding' })
      ).toBeVisible()
    }
  )
})
