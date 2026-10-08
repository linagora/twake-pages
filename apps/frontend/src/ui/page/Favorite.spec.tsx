import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { fakePagesApi } from '@/testing/fakePagesApi'
import { renderRoute } from '@/testing/renderWithProviders'

describe('a favorite', () => {
  it('shows as one on its page', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Handbook' })
    const plans = pagesApi.withPage(wiki.id, { title: 'Plans' })
    await pagesApi.setFavorite(plans.id, true)
    renderRoute(`/wikis/${wiki.id}/pages/${plans.id}`, { pagesApi })

    expect(
      await screen.findByRole('button', { name: 'Remove from favorites' })
    ).toBeVisible()
  })

  it('is added from its page, and taken out again', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Handbook' })
    const plans = pagesApi.withPage(wiki.id, { title: 'Plans' })
    renderRoute(`/wikis/${wiki.id}/pages/${plans.id}`, { pagesApi })

    fireEvent.click(
      await screen.findByRole('button', { name: 'Add to favorites' })
    )
    const remove = await screen.findByRole('button', {
      name: 'Remove from favorites'
    })
    const marked = await pagesApi.favorites()
    fireEvent.click(remove)
    await screen.findByRole('button', { name: 'Add to favorites' })

    expect({
      marked: marked.map(page => page.id),
      left: await pagesApi.favorites()
    }).toEqual({ marked: [plans.id], left: [] })
  })

  it('is kept by a viewer too', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ role: 'viewer' })
    const plans = pagesApi.withPage(wiki.id, { title: 'Plans' })
    renderRoute(`/wikis/${wiki.id}/pages/${plans.id}`, { pagesApi })

    fireEvent.click(
      await screen.findByRole('button', { name: 'Add to favorites' })
    )
    await screen.findByRole('button', { name: 'Remove from favorites' })

    expect((await pagesApi.favorites()).map(page => page.id)).toEqual([
      plans.id
    ])
  })

  it('is changed once for a click made while the backend answers', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Handbook' })
    const plans = pagesApi.withPage(wiki.id, { title: 'Plans' })
    const setFavorite = pagesApi.setFavorite.getMockImplementation()
    let answer = (): void => undefined
    pagesApi.setFavorite.mockImplementationOnce(async (pageId, favorite) => {
      await new Promise<void>(resolve => {
        answer = resolve
      })
      await setFavorite?.(pageId, favorite)
    })
    renderRoute(`/wikis/${wiki.id}/pages/${plans.id}`, { pagesApi })

    const add = await screen.findByRole('button', { name: 'Add to favorites' })
    fireEvent.click(add)
    // The next click comes in a later task, once the change shows as pending.
    await act(
      () =>
        new Promise(resolve => {
          setTimeout(resolve, 0)
        })
    )
    fireEvent.click(add)
    act(() => {
      answer()
    })

    expect(
      await screen.findByRole('button', { name: 'Remove from favorites' })
    ).toBeVisible()
    expect(pagesApi.setFavorite).toHaveBeenCalledTimes(1)
  })
})
