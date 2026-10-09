import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { fakePagesApi } from '@/testing/fakePagesApi'
import { renderRoute } from '@/testing/renderWithProviders'

describe('following a page', () => {
  it('shows on the page that the person follows it', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Handbook' })
    const plans = pagesApi.withPage(wiki.id, { title: 'Plans' })
    renderRoute(`/wikis/${wiki.id}/pages/${plans.id}`, { pagesApi })

    expect(
      await screen.findByRole('button', { name: 'Following' })
    ).toBeVisible()
  })

  it('starts from its page, and stops again', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Handbook' })
    const plans = pagesApi.withPage(wiki.id, { title: 'Plans' })
    await pagesApi.setFollowing(plans.id, false)
    renderRoute(`/wikis/${wiki.id}/pages/${plans.id}`, { pagesApi })

    fireEvent.click(await screen.findByRole('button', { name: 'Follow' }))
    const following = await screen.findByRole('button', { name: 'Following' })
    const followed = (await pagesApi.getPage(plans.id)).following
    fireEvent.click(following)
    await screen.findByRole('button', { name: 'Follow' })

    expect({
      followed,
      left: (await pagesApi.getPage(plans.id)).following
    }).toEqual({ followed: true, left: false })
  })

  it('is open to a viewer, on a page in the trash too', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({
      role: 'viewer',
      members: { 'bob@example.com': 'editor' }
    })
    const plans = pagesApi.withPage(wiki.id, { title: 'Plans' })
    await pagesApi.setFollowing(plans.id, false)
    await pagesApi.signedInAs('bob@example.com').deletePage(plans.id)
    renderRoute(`/wikis/${wiki.id}/pages/${plans.id}`, { pagesApi })

    fireEvent.click(await screen.findByRole('button', { name: 'Follow' }))
    await screen.findByRole('button', { name: 'Following' })

    expect((await pagesApi.getPage(plans.id)).following).toBe(true)
  })

  it('is changed once for a click made while the backend answers', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Handbook' })
    const plans = pagesApi.withPage(wiki.id, { title: 'Plans' })
    const setFollowing = pagesApi.setFollowing.getMockImplementation()
    let answer = (): void => undefined
    pagesApi.setFollowing.mockImplementationOnce(async (pageId, following) => {
      await new Promise<void>(resolve => {
        answer = resolve
      })
      await setFollowing?.(pageId, following)
    })
    renderRoute(`/wikis/${wiki.id}/pages/${plans.id}`, { pagesApi })

    const stop = await screen.findByRole('button', { name: 'Following' })
    fireEvent.click(stop)
    // The next click comes in a later task, once the change shows as pending.
    await act(
      () =>
        new Promise(resolve => {
          setTimeout(resolve, 0)
        })
    )
    fireEvent.click(stop)
    act(() => {
      answer()
    })

    expect(await screen.findByRole('button', { name: 'Follow' })).toBeVisible()
    expect(pagesApi.setFollowing).toHaveBeenCalledTimes(1)
  })
})
