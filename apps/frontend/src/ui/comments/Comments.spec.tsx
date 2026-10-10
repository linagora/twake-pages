import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/application/pages'
import type { Role } from '@/domain/wiki'
import { fakePagesApi, type FakePagesApi } from '@/testing/fakePagesApi'
import { fakeSession, fakeUser } from '@/testing/fakeSession'
import { typeIn } from '@/testing/forms'
import { renderRoute } from '@/testing/renderWithProviders'
import { followZone } from '@/ui/settings/zone'

const BOB = 'bob@example.com'
const ALBERT = 'albert@example.com'
const JEAN = 'jean_dupont@example.com'

/** Alice, signed in with her email written in capitals. */
const aliceInCapitals = () =>
  fakeSession(() =>
    Promise.resolve({ ...fakeUser(), email: 'ALICE@EXAMPLE.COM' })
  )

/**
 * Onboarding, in a wiki where Bob Durand is an editor, and Albert Roux and
 * Jean Dupont, whose email has an underscore, are viewers.
 */
function onboarding(role: Role = 'admin') {
  const pagesApi = fakePagesApi()
  const wiki = pagesApi.withWiki({
    role,
    members: { [BOB]: 'editor', [ALBERT]: 'viewer', [JEAN]: 'viewer' }
  })
  pagesApi.signedInAs(ALBERT, 'Albert Roux')
  pagesApi.signedInAs(JEAN, 'Jean Dupont')
  const page = pagesApi.withPage(wiki.id, { title: 'Onboarding' })
  return { pagesApi, wiki, page, bob: pagesApi.signedInAs(BOB, 'Bob Durand') }
}

/** The comments shown, each reply under its comment, from the top. */
async function findComments(): Promise<HTMLElement[]> {
  const list = await screen.findByRole('list', { name: 'Comments' })
  return within(list).getAllByRole('article')
}

/** The one comment shown of this author. */
async function findCommentBy(author: string): Promise<HTMLElement> {
  const list = await screen.findByRole('list', { name: 'Comments' })
  return within(list).getByRole('article', { name: author })
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
    expect(
      screen.queryByRole('button', { name: 'Reply' })
    ).not.toBeInTheDocument()
  })
})

describe('a reply', () => {
  it('answers a comment, and shows under it', async () => {
    const { pagesApi, wiki, page, bob } = onboarding('viewer')
    const question = await bob.addComment(page.id, { body: 'Which laptop?' })
    await pagesApi.addComment(page.id, { body: 'Welcome, Bob.' })
    silenceStream(pagesApi)
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const asked = await findCommentBy('Bob Durand')

    fireEvent.click(within(asked).getByRole('button', { name: 'Reply' }))
    const form = screen.getByRole('form', { name: 'Reply to Bob Durand' })
    expect(within(form).getByRole('textbox', { name: 'Reply' })).toHaveFocus()
    typeIn(form, 'Reply', ' The one on the desk. ')
    fireEvent.click(within(form).getByRole('button', { name: 'Send' }))

    const replies = await screen.findByRole('list', { name: 'Replies' })
    expect(
      within(replies).getByRole('article', { name: 'Alice Martin' })
    ).toHaveTextContent('The one on the desk.')
    expect((await findComments()).map(comment => comment.textContent)).toEqual([
      expect.stringContaining('Which laptop?'),
      expect.stringContaining('The one on the desk.'),
      expect.stringContaining('Welcome, Bob.')
    ])
    expect(pagesApi.addComment).toHaveBeenCalledWith(page.id, {
      body: 'The one on the desk.',
      parentId: question.id
    })
    await waitFor(() => {
      expect(form).not.toBeInTheDocument()
    })
  })

  it('answers a comment, never a reply', async () => {
    const { pagesApi, wiki, page, bob } = onboarding()
    const question = await bob.addComment(page.id, { body: 'Which laptop?' })
    await pagesApi.addComment(page.id, {
      body: 'The one on the desk.',
      parentId: question.id
    })
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })

    const asked = await findCommentBy('Bob Durand')
    const answer = await findCommentBy('Alice Martin')

    expect(within(asked).getByRole('button', { name: 'Reply' })).toBeVisible()
    expect(
      within(answer).queryByRole('button', { name: 'Reply' })
    ).not.toBeInTheDocument()
  })

  it('is written to one comment at a time', async () => {
    const { pagesApi, wiki, page, bob } = onboarding()
    await bob.addComment(page.id, { body: 'Which laptop?' })
    await pagesApi.addComment(page.id, { body: 'Which badge?' })
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const laptop = await findCommentBy('Bob Durand')
    const badge = await findCommentBy('Alice Martin')

    fireEvent.click(within(laptop).getByRole('button', { name: 'Reply' }))
    fireEvent.click(within(badge).getByRole('button', { name: 'Reply' }))

    expect(
      screen.getByRole('form', { name: 'Reply to Alice Martin' })
    ).toBeVisible()
    expect(
      screen.queryByRole('form', { name: 'Reply to Bob Durand' })
    ).not.toBeInTheDocument()
    expect(screen.getAllByRole('textbox', { name: 'Reply' })).toHaveLength(1)
  })

  it('is dropped by Cancel, unsent', async () => {
    const { pagesApi, wiki, page, bob } = onboarding()
    await bob.addComment(page.id, { body: 'Which laptop?' })
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const asked = await findCommentBy('Bob Durand')

    fireEvent.click(within(asked).getByRole('button', { name: 'Reply' }))
    const form = screen.getByRole('form', { name: 'Reply to Bob Durand' })
    typeIn(form, 'Reply', 'The one on the desk.')
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }))
    await aMoment()

    expect(form).not.toBeInTheDocument()
    expect(pagesApi.addComment).not.toHaveBeenCalled()
  })

  it('says so when the comment it answers was deleted elsewhere, and keeps the text', async () => {
    const { pagesApi, wiki, page, bob } = onboarding()
    const question = await bob.addComment(page.id, { body: 'Which laptop?' })
    silenceStream(pagesApi)
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const asked = await findCommentBy('Bob Durand')
    fireEvent.click(within(asked).getByRole('button', { name: 'Reply' }))
    await bob.deleteComment(question.id)

    const form = screen.getByRole('form', { name: 'Reply to Bob Durand' })
    typeIn(form, 'Reply', 'The one on the desk.')
    fireEvent.click(within(form).getByRole('button', { name: 'Send' }))

    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'The comment could not be sent.'
    )
    expect(within(form).getByRole('textbox', { name: 'Reply' })).toHaveValue(
      'The one on the desk.'
    )
  })

  it('is closed when the page goes to the trash elsewhere', async () => {
    const { pagesApi, wiki, page, bob } = onboarding()
    await bob.addComment(page.id, { body: 'Which laptop?' })
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const asked = await findCommentBy('Bob Durand')
    fireEvent.click(within(asked).getByRole('button', { name: 'Reply' }))
    const form = screen.getByRole('form', { name: 'Reply to Bob Durand' })

    await act(() => bob.deletePage(page.id))

    await waitFor(() => {
      expect(form).not.toBeInTheDocument()
    })
    expect(
      screen.queryByRole('textbox', { name: 'Comment' })
    ).not.toBeInTheDocument()
  })
})

describe('an edit', () => {
  it("is offered on the person's own comments only, replies among them, though they are an admin", async () => {
    const { pagesApi, wiki, page, bob } = onboarding()
    const question = await bob.addComment(page.id, { body: 'Which laptop?' })
    await pagesApi.addComment(page.id, {
      body: 'The one on the desk.',
      parentId: question.id
    })
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })

    const asked = await findCommentBy('Bob Durand')
    const answer = await findCommentBy('Alice Martin')

    expect(within(answer).getByRole('button', { name: 'Edit' })).toBeVisible()
    expect(
      within(asked).queryByRole('button', { name: 'Edit' })
    ).not.toBeInTheDocument()
  })

  it("tells the person's own comments by their email, whatever its case", async () => {
    const { pagesApi, wiki, page } = onboarding()
    await pagesApi.addComment(page.id, { body: 'Which laptop?' })
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, {
      pagesApi,
      session: aliceInCapitals()
    })

    const comment = await findCommentBy('Alice Martin')

    expect(within(comment).getByRole('button', { name: 'Edit' })).toBeVisible()
  })

  it('is saved trimmed, and shows the comment edited', async () => {
    const { pagesApi, wiki, page } = onboarding()
    const mine = await pagesApi.addComment(page.id, { body: 'Which laptop?' })
    silenceStream(pagesApi)
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const comment = await findCommentBy('Alice Martin')

    fireEvent.click(within(comment).getByRole('button', { name: 'Edit' }))
    const field = within(comment).getByRole('textbox', {
      name: 'Edit comment'
    })
    expect(field).toHaveValue('Which laptop?')
    expect(field).toHaveFocus()
    typeIn(comment, 'Edit comment', ' Which laptop, please? ')
    fireEvent.click(within(comment).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(field).not.toBeInTheDocument()
    })
    expect(comment).toHaveTextContent('Which laptop, please?')
    expect(comment).toHaveTextContent('edited')
    expect(pagesApi.editComment).toHaveBeenCalledWith(
      mine.id,
      'Which laptop, please?'
    )
  })

  it('opens with the caret at the end of the text', async () => {
    const { pagesApi, wiki, page } = onboarding()
    await pagesApi.addComment(page.id, { body: 'Which laptop?' })
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const comment = await findCommentBy('Alice Martin')

    fireEvent.click(within(comment).getByRole('button', { name: 'Edit' }))

    const field = within(comment).getByRole('textbox', {
      name: 'Edit comment'
    })
    expect(field).toHaveFocus()
    expect(field).toHaveProperty('selectionStart', 'Which laptop?'.length)
    expect(field).toHaveProperty('selectionEnd', 'Which laptop?'.length)
  })

  it('is not saved blank', async () => {
    const { pagesApi, wiki, page } = onboarding()
    await pagesApi.addComment(page.id, { body: 'Which laptop?' })
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const comment = await findCommentBy('Alice Martin')

    fireEvent.click(within(comment).getByRole('button', { name: 'Edit' }))
    typeIn(comment, 'Edit comment', ' \n ')

    expect(within(comment).getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('is dropped by Cancel, unsaved', async () => {
    const { pagesApi, wiki, page } = onboarding()
    await pagesApi.addComment(page.id, { body: 'Which laptop?' })
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const comment = await findCommentBy('Alice Martin')

    fireEvent.click(within(comment).getByRole('button', { name: 'Edit' }))
    typeIn(comment, 'Edit comment', 'Which laptop, please?')
    fireEvent.click(within(comment).getByRole('button', { name: 'Cancel' }))
    await aMoment()

    expect(
      within(comment).queryByRole('textbox', { name: 'Edit comment' })
    ).not.toBeInTheDocument()
    expect(comment).toHaveTextContent('Which laptop?')
    expect(pagesApi.editComment).not.toHaveBeenCalled()
  })

  it('says so when it cannot be saved, and keeps the text', async () => {
    const { pagesApi, wiki, page } = onboarding()
    const mine = await pagesApi.addComment(page.id, { body: 'Which laptop?' })
    silenceStream(pagesApi)
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const comment = await findCommentBy('Alice Martin')
    fireEvent.click(within(comment).getByRole('button', { name: 'Edit' }))
    // Deleted elsewhere, which the open page does not hear of.
    await pagesApi.deleteComment(mine.id)

    typeIn(comment, 'Edit comment', 'Which laptop, please?')
    fireEvent.click(within(comment).getByRole('button', { name: 'Save' }))

    expect(await within(comment).findByRole('alert')).toHaveTextContent(
      'The comment could not be saved.'
    )
    expect(
      within(comment).getByRole('textbox', { name: 'Edit comment' })
    ).toHaveValue('Which laptop, please?')
  })

  it('is not offered on a page in the trash', async () => {
    const { pagesApi, wiki, page, bob } = onboarding()
    await pagesApi.addComment(page.id, { body: 'Which laptop?' })
    await bob.deletePage(page.id)
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })

    const comment = await findCommentBy('Alice Martin')

    expect(comment).toHaveTextContent('Which laptop?')
    expect(
      within(comment).queryByRole('button', { name: 'Edit' })
    ).not.toBeInTheDocument()
  })

  it('is closed when the page goes to the trash elsewhere', async () => {
    const { pagesApi, wiki, page, bob } = onboarding()
    await pagesApi.addComment(page.id, { body: 'Which laptop?' })
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const comment = await findCommentBy('Alice Martin')
    fireEvent.click(within(comment).getByRole('button', { name: 'Edit' }))
    const field = within(comment).getByRole('textbox', {
      name: 'Edit comment'
    })

    await act(() => bob.deletePage(page.id))

    await waitFor(() => {
      expect(field).not.toBeInTheDocument()
    })
    expect(comment).toHaveTextContent('Which laptop?')
  })
})

describe('a deletion', () => {
  /** Asks to delete the comment, and finds the dialog that makes sure. */
  async function askToDelete(comment: HTMLElement): Promise<HTMLElement> {
    fireEvent.click(within(comment).getByRole('button', { name: 'Delete' }))
    return screen.findByRole('dialog', { name: 'Delete this comment?' })
  }

  it("is offered on the person's own comments, and on no one else's to an editor", async () => {
    const { pagesApi, wiki, page, bob } = onboarding('editor')
    await bob.addComment(page.id, { body: 'Which laptop?' })
    await pagesApi.addComment(page.id, { body: 'Welcome, Bob.' })
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })

    const asked = await findCommentBy('Bob Durand')
    const welcome = await findCommentBy('Alice Martin')

    expect(
      within(welcome).getByRole('button', { name: 'Delete' })
    ).toBeVisible()
    expect(
      within(asked).queryByRole('button', { name: 'Delete' })
    ).not.toBeInTheDocument()
  })

  it("is offered on anyone's comment to an admin, replies among them", async () => {
    const { pagesApi, wiki, page, bob } = onboarding()
    const question = await pagesApi.addComment(page.id, {
      body: 'Which laptop?'
    })
    await bob.addComment(page.id, {
      body: 'The one on the desk.',
      parentId: question.id
    })
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })

    const answer = await findCommentBy('Bob Durand')

    expect(within(answer).getByRole('button', { name: 'Delete' })).toBeVisible()
  })

  it('takes the comment and its replies, once sure', async () => {
    const { pagesApi, wiki, page, bob } = onboarding()
    const question = await bob.addComment(page.id, { body: 'Which laptop?' })
    await pagesApi.addComment(page.id, {
      body: 'The one on the desk.',
      parentId: question.id
    })
    await pagesApi.addComment(page.id, { body: 'Welcome, Bob.' })
    silenceStream(pagesApi)
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const asked = await findCommentBy('Bob Durand')

    const dialog = await askToDelete(asked)
    expect(dialog).toHaveTextContent(
      'Its replies go with it. This cannot be undone.'
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(asked).not.toBeInTheDocument()
    })
    expect((await findComments()).map(comment => comment.textContent)).toEqual([
      expect.stringContaining('Welcome, Bob.')
    ])
    expect(pagesApi.deleteComment).toHaveBeenCalledWith(question.id)
  })

  it('warns only that it cannot be undone, for a comment no one answered', async () => {
    const { pagesApi, wiki, page } = onboarding()
    await pagesApi.addComment(page.id, { body: 'Which laptop?' })
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })

    const dialog = await askToDelete(await findCommentBy('Alice Martin'))

    expect(dialog).toHaveTextContent('This cannot be undone.')
    expect(dialog).not.toHaveTextContent('Its replies go with it.')
  })

  it('keeps the comment when not sure', async () => {
    const { pagesApi, wiki, page } = onboarding()
    await pagesApi.addComment(page.id, { body: 'Which laptop?' })
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const comment = await findCommentBy('Alice Martin')

    const dialog = await askToDelete(comment)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await aMoment()

    expect(dialog).not.toBeInTheDocument()
    expect(comment).toHaveTextContent('Which laptop?')
    expect(pagesApi.deleteComment).not.toHaveBeenCalled()
  })

  it('says so when the comment cannot be deleted', async () => {
    const { pagesApi, wiki, page, bob } = onboarding()
    await pagesApi.addComment(page.id, { body: 'Which laptop?' })
    silenceStream(pagesApi)
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const comment = await findCommentBy('Alice Martin')
    // Sent to the trash elsewhere, which the open page does not hear of.
    await bob.deletePage(page.id)

    const dialog = await askToDelete(comment)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The comment could not be deleted.'
    )
    expect(comment).toHaveTextContent('Which laptop?')
  })

  it('is asked once, though confirmed again while the backend answers', async () => {
    const { pagesApi, wiki, page } = onboarding()
    await pagesApi.addComment(page.id, { body: 'Which laptop?' })
    const deleteComment = pagesApi.deleteComment.getMockImplementation()
    if (!deleteComment) throw new Error('The fake deletes no comment')
    let answer = (): void => undefined
    pagesApi.deleteComment.mockImplementationOnce(async commentId => {
      await new Promise<void>(resolve => {
        answer = resolve
      })
      return deleteComment(commentId)
    })
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const comment = await findCommentBy('Alice Martin')

    const dialog = await askToDelete(comment)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    // Confirmed again in a later task, once the deletion shows as pending.
    await aMoment()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    act(() => {
      answer()
    })

    await waitFor(() => {
      expect(comment).not.toBeInTheDocument()
    })
    expect(pagesApi.deleteComment).toHaveBeenCalledTimes(1)
  })

  it('is not offered on a page in the trash', async () => {
    const { pagesApi, wiki, page, bob } = onboarding()
    await pagesApi.addComment(page.id, { body: 'Which laptop?' })
    await bob.deletePage(page.id)
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })

    const comment = await findCommentBy('Alice Martin')

    expect(comment).toHaveTextContent('Which laptop?')
    expect(
      within(comment).queryByRole('button', { name: 'Delete' })
    ).not.toBeInTheDocument()
  })

  it('is closed when the page goes to the trash elsewhere', async () => {
    const { pagesApi, wiki, page, bob } = onboarding()
    await pagesApi.addComment(page.id, { body: 'Which laptop?' })
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const comment = await findCommentBy('Alice Martin')
    const dialog = await askToDelete(comment)

    await act(() => bob.deletePage(page.id))

    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument()
    })
    expect(comment).toHaveTextContent('Which laptop?')
  })
})

describe('the list of people to mention', () => {
  /** Alice's field for a new comment on Onboarding, focused, with `text` in. */
  async function typeInComment(text: string, session = fakeSession()) {
    const { pagesApi, wiki, page } = onboarding()
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi, session })
    const comments = await findCommentSection()
    const field = within(comments).getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Comment'
    })
    act(() => {
      field.focus()
    })
    typeIn(comments, 'Comment', text)
    return { pagesApi, page, comments, field }
  }

  /** The list, once the members it suggests are loaded. */
  const findList = () =>
    screen.findByRole('listbox', { name: 'People to mention' })

  /** The rank of each option shown as selected, from the top. */
  const selectedAmong = (options: HTMLElement[]) =>
    options.flatMap((option, index) =>
      option.getAttribute('aria-selected') === 'true' ? [index] : []
    )

  it('opens as @ is typed, and writes the email of the member picked', async () => {
    const { pagesApi, page, comments, field } =
      await typeInComment('Thanks @ali')

    const list = await findList()
    expect(within(list).getAllByRole('option')).toHaveLength(1)
    fireEvent.click(
      within(list).getByRole('option', {
        name: 'Alice Martin alice@example.com'
      })
    )

    expect(field).toHaveValue('Thanks @alice@example.com ')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    fireEvent.click(within(comments).getByRole('button', { name: 'Send' }))
    await waitFor(() => {
      expect(pagesApi.addComment).toHaveBeenCalledWith(page.id, {
        body: 'Thanks @alice@example.com'
      })
    })
  })

  it('puts a space after the mention, and the caret after it', async () => {
    const { field } = await typeInComment('Hi @ali, thanks')
    // The caret goes back after "@ali", as the arrow keys move it.
    field.setSelectionRange(7, 7)
    fireEvent.keyUp(field, { key: 'ArrowLeft' })

    fireEvent.click(within(await findList()).getByRole('option'))

    expect(field).toHaveValue('Hi @alice@example.com , thanks')
    expect(field.selectionStart).toBe(22)
  })

  it('puts the best match first, and the person last, whatever the case of their email', async () => {
    const { comments } = await typeInComment('@dup', aliceInCapitals())
    expect(
      within(await findList())
        .getAllByRole('option')
        .map(option => option.textContent)
    ).toEqual([
      expect.stringContaining('Jean Dupont'),
      expect.stringContaining('Bob Durand')
    ])

    typeIn(comments, 'Comment', '@al')

    // Mentioning yourself tells nobody.
    expect(
      within(screen.getByRole('listbox'))
        .getAllByRole('option')
        .map(option => option.textContent)
    ).toEqual([
      expect.stringContaining('Albert Roux'),
      expect.stringContaining('Bob Durand'),
      expect.stringContaining('Jean Dupont'),
      expect.stringContaining('Alice Martin')
    ])
  })

  it('moves with the arrows, and picks with Enter without sending', async () => {
    const { pagesApi, field } = await typeInComment('@al')
    const options = within(await findList()).getAllByRole('option')
    expect(selectedAmong(options)).toEqual([0])

    // Cancelled, as the caret stays where it is.
    expect(fireEvent.keyDown(field, { key: 'ArrowDown' })).toBe(false)
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(selectedAmong(options)).toEqual([3])
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(selectedAmong(options)).toEqual([0])
    fireEvent.keyDown(field, { key: 'ArrowUp' })
    expect(selectedAmong(options)).toEqual([3])
    fireEvent.keyDown(field, { key: 'ArrowUp' })
    expect(selectedAmong(options)).toEqual([2])
    // Cancelled, as Enter starts no new line.
    expect(fireEvent.keyDown(field, { key: 'Enter' })).toBe(false)

    expect(field).toHaveValue('@jean_dupont@example.com ')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await aMoment()
    expect(pagesApi.addComment).not.toHaveBeenCalled()
  })

  it('starts from the best match again as what is typed changes', async () => {
    const { comments, field } = await typeInComment('@al')
    const options = within(await findList()).getAllByRole('option')
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(selectedAmong(options)).toEqual([2])

    typeIn(comments, 'Comment', '@a')

    const shown = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(shown).toHaveLength(4)
    expect(selectedAmong(shown)).toEqual([0])
  })

  it('picks with Tab, and lets Shift+Tab leave the field', async () => {
    const { field } = await typeInComment('@alb')
    await findList()

    expect(fireEvent.keyDown(field, { key: 'Tab', shiftKey: true })).toBe(true)
    expect(field).toHaveValue('@alb')
    expect(fireEvent.keyDown(field, { key: 'Tab' })).toBe(false)

    expect(field).toHaveValue('@albert@example.com ')
  })

  it('picks on Ctrl+Enter while open, and sends once closed', async () => {
    const { pagesApi, page, field } = await typeInComment('@alb')
    await findList()

    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true })
    expect(field).toHaveValue('@albert@example.com ')
    await aMoment()
    expect(pagesApi.addComment).not.toHaveBeenCalled()
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true })

    await waitFor(() => {
      expect(pagesApi.addComment).toHaveBeenCalledWith(page.id, {
        body: '@albert@example.com'
      })
    })
  })

  it('closes on Escape, and keeps what was typed', async () => {
    const { field } = await typeInComment('@al')
    await findList()

    fireEvent.keyDown(field, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(field).toHaveValue('@al')
  })

  it('stays closed for the mention Escape closed it on, and opens for the next', async () => {
    const { comments, field } = await typeInComment('@al')
    await findList()
    fireEvent.keyDown(field, { key: 'Escape' })

    typeIn(comments, 'Comment', '@alb')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    typeIn(comments, 'Comment', '')
    typeIn(comments, 'Comment', '@alb')

    expect(
      screen.getByRole('listbox', { name: 'People to mention' })
    ).toBeVisible()
  })

  it('does not open when no member matches', async () => {
    const { comments, field } = await typeInComment('@a')
    await findList()

    typeIn(comments, 'Comment', '@zzz')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(field).not.toHaveAttribute('aria-controls')
  })

  it('does not open inside an email', async () => {
    const { comments } = await typeInComment('write to @ali')
    await findList()

    typeIn(comments, 'Comment', 'write to bob@ali')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes as a space ends what was typed', async () => {
    const { comments } = await typeInComment('@al')
    await findList()

    typeIn(comments, 'Comment', '@al ')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('opens after a bracket or a quote, where a mention is read too', async () => {
    const { comments } = await typeInComment('cc (@ali')
    expect(await findList()).toBeVisible()

    typeIn(comments, 'Comment', 'cc "@ali')

    expect(
      screen.getByRole('listbox', { name: 'People to mention' })
    ).toBeVisible()
  })

  it('is announced to a screen reader', async () => {
    const { comments, field } = await typeInComment('Hi')
    expect(field).toHaveAttribute('aria-haspopup', 'listbox')
    expect(field).toHaveAttribute('aria-autocomplete', 'list')
    // aria-expanded is not allowed on a textbox (ARIA 1.2)
    expect(field).not.toHaveAttribute('aria-expanded')
    expect(field).not.toHaveAttribute('aria-controls')

    typeIn(comments, 'Comment', 'Hi @al')

    const list = await findList()
    const [first, second] = within(list).getAllByRole('option')
    expect(field).toHaveAttribute('aria-controls', list.id)
    expect(field).toHaveAttribute('aria-activedescendant', first?.id)
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(field).toHaveAttribute('aria-activedescendant', second?.id)
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(field).not.toHaveAttribute('aria-controls')
    expect(field).not.toHaveAttribute('aria-activedescendant')
  })

  it('closes when the field loses the focus', async () => {
    const { field } = await typeInComment('@al')
    await findList()

    fireEvent.blur(field)

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('suggests eight members at most, by their names', async () => {
    const pagesApi = fakePagesApi()
    // Nine members besides the person, whose emails sort apart from their
    // names.
    const names = [
      'Ivy Moreau',
      'Hugo Petit',
      'Gaël Simon',
      'Fanny Roy',
      'Eva Blanc',
      'Denis Morel',
      'Chloé Faure',
      'Bruno Leroy',
      'Ada Garnier'
    ]
    const emailOf = (index: number) => `member${String(index + 1)}@example.com`
    const wiki = pagesApi.withWiki({
      members: Object.fromEntries(
        names.map((name, index) => [emailOf(index), 'viewer' as const])
      )
    })
    names.forEach((name, index) => {
      pagesApi.signedInAs(emailOf(index), name)
    })
    const page = pagesApi.withPage(wiki.id, { title: 'Onboarding' })
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const comments = await findCommentSection()
    act(() => {
      within(comments).getByRole('textbox', { name: 'Comment' }).focus()
    })

    typeIn(comments, 'Comment', '@')

    expect(
      within(await findList())
        .getAllByRole('option')
        .map(option => option.textContent)
    ).toEqual([
      expect.stringContaining('Ada Garnier'),
      expect.stringContaining('Bruno Leroy'),
      expect.stringContaining('Chloé Faure'),
      expect.stringContaining('Denis Morel'),
      expect.stringContaining('Eva Blanc'),
      expect.stringContaining('Fanny Roy'),
      expect.stringContaining('Gaël Simon'),
      expect.stringContaining('Hugo Petit')
    ])
  })

  it('says so below the field when the members cannot be loaded', async () => {
    const { pagesApi, wiki, page } = onboarding()
    pagesApi.getMembers.mockRejectedValue(new ApiError(403, null))
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const comments = await findCommentSection()

    expect(
      await within(comments).findByText(
        'The people to mention could not be loaded.'
      )
    ).toBeVisible()
    expect(
      within(comments).getByRole('textbox', { name: 'Comment' })
    ).toHaveAccessibleDescription('The people to mention could not be loaded.')
  })

  it('opens in a reply too', async () => {
    const { pagesApi, wiki, page, bob } = onboarding()
    await bob.addComment(page.id, { body: 'Which laptop?' })
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    const asked = await findCommentBy('Bob Durand')

    // The field of a reply takes the focus as it opens.
    fireEvent.click(within(asked).getByRole('button', { name: 'Reply' }))
    typeIn(
      screen.getByRole('form', { name: 'Reply to Bob Durand' }),
      'Reply',
      '@bob'
    )

    expect(
      within(await findList()).getByRole('option', {
        name: 'Bob Durand bob@example.com'
      })
    ).toBeVisible()
  })
})

describe('a mention', () => {
  /** Bob's comment, as the page shows it. */
  async function bobWrites(body: string): Promise<HTMLElement> {
    const { pagesApi, wiki, page, bob } = onboarding()
    await bob.addComment(page.id, { body })
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
    return findCommentBy('Bob Durand')
  }

  it('shows the member by their name, with their email as its title', async () => {
    const comment = await bobWrites('Thanks @alice@example.com, it is done.')

    const mention = await within(comment).findByText('@Alice Martin')

    expect(mention).toHaveAttribute('title', 'alice@example.com')
    expect(comment).toHaveTextContent('Thanks @Alice Martin, it is done.')
    expect(comment).not.toHaveTextContent('alice@example.com')
  })

  it('shows a member whose email has an underscore', async () => {
    const comment = await bobWrites('cc @jean_dupont@example.com')

    expect(await within(comment).findByText('@Jean Dupont')).toHaveAttribute(
      'title',
      'jean_dupont@example.com'
    )
  })

  it('reads the email in any case, and titles it as written', async () => {
    const comment = await bobWrites('@Albert@Example.com ok?')

    expect(await within(comment).findByText('@Albert Roux')).toHaveAttribute(
      'title',
      'Albert@Example.com'
    )
  })

  it('finds a member whose email the wiki gives in capitals', async () => {
    const { pagesApi, wiki, page, bob } = onboarding()
    const getMembers = pagesApi.getMembers.getMockImplementation()
    if (!getMembers) throw new Error('The fake lists no members')
    // The backend reads a member's email in any case, where the fake
    // lowercases every email it is given.
    pagesApi.getMembers.mockImplementation(async wikiId => {
      const sharing = await getMembers(wikiId)
      return {
        ...sharing,
        members: sharing.members.map(member =>
          member.email === ALBERT
            ? { ...member, email: 'Albert@Example.COM' }
            : member
        )
      }
    })
    await bob.addComment(page.id, { body: 'cc @albert@example.com' })
    renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })

    const comment = await findCommentBy('Bob Durand')

    expect(await within(comment).findByText('@Albert Roux')).toHaveAttribute(
      'title',
      'albert@example.com'
    )
  })

  it('keeps the email of someone who is no member as it was typed', async () => {
    const comment = await bobWrites(
      'Ask @ghost@example.com or mail ghost@example.com, cc @alice@example.com'
    )
    await within(comment).findByText('@Alice Martin')

    expect(comment).toHaveTextContent(
      'Ask @ghost@example.com or mail ghost@example.com, cc @Alice Martin'
    )
    expect(
      within(comment).queryByTitle('ghost@example.com')
    ).not.toBeInTheDocument()
  })

  it('takes no address inside a word for a mention', async () => {
    const comment = await bobWrites(
      'write to bob@alice@example.com, cc @jean_dupont@example.com'
    )
    await within(comment).findByText('@Jean Dupont')

    expect(comment).toHaveTextContent('write to bob@alice@example.com')
    expect(within(comment).queryByText('@Alice Martin')).not.toBeInTheDocument()
  })
})
