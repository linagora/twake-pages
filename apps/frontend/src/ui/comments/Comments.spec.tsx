import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/application/pages'
import type { Role } from '@/domain/wiki'
import { fakePagesApi, type FakePagesApi } from '@/testing/fakePagesApi'
import { typeIn } from '@/testing/forms'
import { renderRoute } from '@/testing/renderWithProviders'
import { followZone } from '@/ui/settings/zone'

const BOB = 'bob@example.com'

/** Onboarding, in a wiki where Bob Durand is an editor. */
function onboarding(role: Role = 'admin') {
  const pagesApi = fakePagesApi()
  const wiki = pagesApi.withWiki({ role, members: { [BOB]: 'editor' } })
  const page = pagesApi.withPage(wiki.id, { title: 'Onboarding' })
  return { pagesApi, wiki, page, bob: pagesApi.signedInAs(BOB, 'Bob Durand') }
}

/** The comments shown, each reply under its comment, from the top. */
async function findComments(): Promise<HTMLElement[]> {
  const list = await screen.findByRole('list', { name: 'Comments' })
  return within(list).getAllByRole('article')
}

/** The comments of the open page, their field among them. */
const findCommentSection = () =>
  screen.findByRole('region', { name: 'Comments' })

/** Keeps the wiki's stream silent: only what the screen reads itself shows. */
function silenceStream(pagesApi: FakePagesApi): void {
  pagesApi.watchWiki.mockImplementation(() => () => undefined)
}

/** Lets a request the screen would send go out, before checking none did. */
const aMoment = () =>
  act(
    () =>
      new Promise<void>(resolve => {
        setTimeout(resolve, 0)
      })
  )

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

describe('a new comment', () => {
  it('is written by any member, viewers too, and shows once sent', async () => {
    const { pagesApi, wiki, page } = onboarding('viewer')
    silenceStream(pagesApi)
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const comments = await findCommentSection()

    typeIn(comments, 'Comment', 'Which laptop?')
    fireEvent.click(within(comments).getByRole('button', { name: 'Send' }))

    expect(
      await within(comments).findByRole('article', { name: 'Alice Martin' })
    ).toHaveTextContent('Which laptop?')
    await waitFor(() => {
      expect(
        within(comments).getByRole('textbox', { name: 'Comment' })
      ).toHaveValue('')
    })
  })

  it('makes its author follow the page, which is not read again', async () => {
    const { pagesApi, wiki, page } = onboarding('viewer')
    await pagesApi.setFollowing(page.id, false)
    silenceStream(pagesApi)
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const comments = await findCommentSection()
    await screen.findByRole('button', { name: 'Follow' })

    typeIn(comments, 'Comment', 'Which laptop?')
    // Counted once the field takes the text, which ends the screen's first
    // renders and the reads they make.
    const reads = pagesApi.getPage.mock.calls.length
    fireEvent.click(within(comments).getByRole('button', { name: 'Send' }))

    expect(
      await screen.findByRole('button', { name: 'Following' })
    ).toBeVisible()
    // Reading the page again would count as a visit.
    expect(pagesApi.getPage).toHaveBeenCalledTimes(reads)
  })

  it.each([
    { keys: 'Ctrl+Enter', modifier: { ctrlKey: true } },
    { keys: '⌘+Enter', modifier: { metaKey: true } }
  ])('is sent trimmed with $keys', async ({ modifier }) => {
    const { pagesApi, wiki, page } = onboarding()
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const comments = await findCommentSection()

    typeIn(comments, 'Comment', '\n  Which laptop?  \n')
    fireEvent.keyDown(
      within(comments).getByRole('textbox', { name: 'Comment' }),
      { key: 'Enter', ...modifier }
    )

    expect(
      await within(comments).findByRole('article', { name: 'Alice Martin' })
    ).toHaveTextContent('Which laptop?')
    expect(pagesApi.addComment).toHaveBeenCalledWith(page.id, {
      body: 'Which laptop?'
    })
  })

  it('takes Enter alone as a new line', async () => {
    const { pagesApi, wiki, page } = onboarding()
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const comments = await findCommentSection()

    typeIn(comments, 'Comment', 'Which laptop?')
    fireEvent.keyDown(
      within(comments).getByRole('textbox', { name: 'Comment' }),
      { key: 'Enter' }
    )
    await aMoment()

    expect(pagesApi.addComment).not.toHaveBeenCalled()
  })

  it('is not sent blank, nor longer than 10 000 characters once trimmed', async () => {
    const { pagesApi, wiki, page } = onboarding()
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const comments = await findCommentSection()
    const field = within(comments).getByRole('textbox', { name: 'Comment' })
    const send = within(comments).getByRole('button', { name: 'Send' })

    typeIn(comments, 'Comment', ' \n ')
    expect(send).toBeDisabled()
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true })
    typeIn(comments, 'Comment', 'x'.repeat(10_001))
    expect(send).toBeDisabled()
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true })
    await aMoment()
    typeIn(comments, 'Comment', ` ${'x'.repeat(10_000)} `)

    expect(send).toBeEnabled()
    expect(pagesApi.addComment).not.toHaveBeenCalled()
  })

  it('is sent once, though sent again while the backend answers', async () => {
    const { pagesApi, wiki, page } = onboarding()
    const addComment = pagesApi.addComment.getMockImplementation()
    let answer = (): void => undefined
    pagesApi.addComment.mockImplementationOnce(async (pageId, comment) => {
      await new Promise<void>(resolve => {
        answer = resolve
      })
      if (!addComment) throw new Error('The fake writes no comment')
      return addComment(pageId, comment)
    })
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const comments = await findCommentSection()

    typeIn(comments, 'Comment', 'Which laptop?')
    fireEvent.click(within(comments).getByRole('button', { name: 'Send' }))
    // Sent again in a later task, once the comment shows as pending.
    await aMoment()
    fireEvent.keyDown(
      within(comments).getByRole('textbox', { name: 'Comment' }),
      { key: 'Enter', ctrlKey: true }
    )
    act(() => {
      answer()
    })

    await within(comments).findByRole('article', { name: 'Alice Martin' })
    expect(pagesApi.addComment).toHaveBeenCalledTimes(1)
  })

  it('says so when it cannot be sent, and keeps the text', async () => {
    const { pagesApi, wiki, page, bob } = onboarding()
    silenceStream(pagesApi)
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const comments = await findCommentSection()
    // Sent to the trash elsewhere, which the open page does not hear of.
    await bob.deletePage(page.id)

    typeIn(comments, 'Comment', 'Which laptop?')
    fireEvent.click(within(comments).getByRole('button', { name: 'Send' }))

    expect(await within(comments).findByRole('alert')).toHaveTextContent(
      'The comment could not be sent.'
    )
    expect(
      within(comments).getByRole('textbox', { name: 'Comment' })
    ).toHaveValue('Which laptop?')
  })

  it('cannot be written on a page in the trash, whose comments still show', async () => {
    const { pagesApi, wiki, page, bob } = onboarding()
    await bob.addComment(page.id, { body: 'Which laptop?' })
    await bob.deletePage(page.id)
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })

    const [comment] = await findComments()

    expect(comment).toHaveTextContent('Which laptop?')
    expect(
      screen.queryByRole('textbox', { name: 'Comment' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Send' })
    ).not.toBeInTheDocument()
  })
})
