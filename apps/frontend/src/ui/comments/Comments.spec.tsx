import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/application/pages'
import { fakePagesApi } from '@/testing/fakePagesApi'
import { renderRoute } from '@/testing/renderWithProviders'
import { followZone } from '@/ui/settings/zone'

const BOB = 'bob@example.com'

/** Onboarding, in a wiki where Bob Durand is an editor. */
function onboarding() {
  const pagesApi = fakePagesApi()
  const wiki = pagesApi.withWiki({ members: { [BOB]: 'editor' } })
  const page = pagesApi.withPage(wiki.id, { title: 'Onboarding' })
  return { pagesApi, wiki, page, bob: pagesApi.signedInAs(BOB, 'Bob Durand') }
}

/** The comments shown, each reply under its comment, from the top. */
async function findComments(): Promise<HTMLElement[]> {
  const list = await screen.findByRole('list', { name: 'Comments' })
  return within(list).getAllByRole('article')
}

afterEach(() => {
  followZone(null)
})

describe('the comments of a page', () => {
  it('show who wrote what, oldest first', async () => {
    const { pagesApi, wiki, page, bob } = onboarding()
    await bob.addComment(page.id, { body: 'Which laptop?' })
    await pagesApi.addComment(page.id, { body: 'The one on the desk.' })
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })

    const comments = await findComments()

    expect(comments.map(comment => comment.getAttribute('aria-label'))).toEqual(
      ['Bob Durand', 'Alice Martin']
    )
    expect(comments[0]).toHaveTextContent('Which laptop?')
    expect(comments[1]).toHaveTextContent('The one on the desk.')
  })

  it('show each reply under the comment it answers', async () => {
    const { pagesApi, wiki, page, bob } = onboarding()
    const question = await bob.addComment(page.id, { body: 'Which laptop?' })
    await bob.addComment(page.id, { body: 'Which badge?' })
    await pagesApi.addComment(page.id, {
      body: 'The one on the desk.',
      parentId: question.id
    })
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })

    const comments = await findComments()
    const replies = screen.getByRole('list', { name: 'Replies' })

    expect(comments.map(comment => comment.textContent)).toEqual([
      expect.stringContaining('Which laptop?'),
      expect.stringContaining('The one on the desk.'),
      expect.stringContaining('Which badge?')
    ])
    expect(within(replies).getByRole('article')).toHaveTextContent(
      'The one on the desk.'
    )
  })

  it('tell which comment was edited', async () => {
    const { pagesApi, wiki, page, bob } = onboarding()
    const question = await bob.addComment(page.id, { body: 'Which laptop?' })
    await bob.editComment(question.id, 'Which laptop, please?')
    await pagesApi.addComment(page.id, { body: 'The one on the desk.' })
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })

    const [edited, answer] = await findComments()

    expect(edited).toHaveTextContent('Which laptop, please?')
    expect(edited).toHaveTextContent('edited')
    expect(answer).not.toHaveTextContent('edited')
  })

  it('say when each comment was written, in the timezone of the person', async () => {
    const { pagesApi, wiki, page, bob } = onboarding()
    // Later than any time the fake gave before, as its times only move on.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2100-03-02T09:30:00Z'))
    await bob.addComment(page.id, { body: 'Which laptop?' })
    vi.useRealTimers()
    followZone('Asia/Tokyo')
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })

    const [comment] = await findComments()

    expect(comment).toHaveTextContent('Bob Durand · Mar 2, 2100, 6:30 PM')
  })

  it('say so when they cannot be loaded', async () => {
    const { pagesApi, wiki, page } = onboarding()
    pagesApi.listComments.mockRejectedValue(new ApiError(403, null))
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The comments could not be loaded.'
    )
  })
})
