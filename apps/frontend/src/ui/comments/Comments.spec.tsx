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
