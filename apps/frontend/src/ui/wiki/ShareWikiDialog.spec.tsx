import {
  act,
  fireEvent,
  screen,
  waitFor,
  waitForElementToBeRemoved,
  within
} from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { fakePagesApi, type FakePagesApi } from '@/testing/fakePagesApi'
import { renderRoute } from '@/testing/renderWithProviders'

const WIKI_NOT_FOUND = "This wiki doesn't exist, or you can't open it."

/** Opens the dialog of the wiki's members from its home page. */
async function openSharing(pagesApi: FakePagesApi, wikiId: string) {
  renderRoute(`/wikis/${wikiId}`, { pagesApi })
  fireEvent.click(await screen.findByRole('button', { name: 'Share' }))
  return within(
    await screen.findByRole('dialog', { name: 'Share Engineering' })
  )
}

describe('ShareWikiDialog', () => {
  it('lets the admin invite an email with a role', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Engineering' })
    const dialog = await openSharing(pagesApi, wiki.id)
    const form = within(dialog.getByRole('form', { name: 'Invite' }))

    fireEvent.change(form.getByRole('combobox', { name: 'Email' }), {
      target: { value: 'bob@example.com' }
    })
    fireEvent.click(form.getByRole('button', { name: 'Role: Viewer' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Editor' }))
    fireEvent.click(form.getByRole('button', { name: 'Invite' }))

    expect(await dialog.findByText('Invited bob@example.com.')).toBeVisible()
    const bob = await dialog.findByRole('listitem', {
      name: 'bob@example.com'
    })
    expect(bob).toHaveTextContent('Invitation')
    expect(
      within(bob).getByRole('button', { name: 'Role: Editor' })
    ).toBeVisible()
    await expect(pagesApi.getMembers(wiki.id)).resolves.toMatchObject({
      invites: [{ email: 'bob@example.com', role: 'editor' }]
    })
  })

  it('shows the invitations another admin makes as they are made', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({
      name: 'Engineering',
      members: { 'carol@example.com': 'admin' }
    })
    await pagesApi.invite(wiki.id, 'erin@example.com', 'viewer')
    const carol = pagesApi.signedInAs('carol@example.com')
    const dialog = await openSharing(pagesApi, wiki.id)
    await dialog.findByRole('listitem', { name: 'erin@example.com' })

    await act(() => carol.invite(wiki.id, 'dave@example.com', 'editor'))

    expect(
      await dialog.findByRole('listitem', { name: 'dave@example.com' })
    ).toHaveTextContent('Invitation')
  })

  it('lets the admin change the role of a member', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({
      name: 'Engineering',
      members: { 'bob@example.com': 'viewer' }
    })
    pagesApi.signedInAs('bob@example.com', 'Bob Stone')
    const dialog = await openSharing(pagesApi, wiki.id)
    const bob = within(
      await dialog.findByRole('listitem', { name: 'Bob Stone' })
    )
    expect(bob.getByText('bob@example.com')).toBeVisible()

    fireEvent.click(bob.getByRole('button', { name: 'Role: Viewer' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Editor' }))

    expect(
      await bob.findByRole('button', { name: 'Role: Editor' })
    ).toBeVisible()
    await expect(pagesApi.getMembers(wiki.id)).resolves.toMatchObject({
      members: [
        { email: 'alice@example.com', role: 'admin' },
        { email: 'bob@example.com', role: 'editor' }
      ]
    })
  })

  it('lets the admin remove a member', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({
      name: 'Engineering',
      members: { 'bob@example.com': 'editor' }
    })
    const dialog = await openSharing(pagesApi, wiki.id)
    const bob = await dialog.findByRole('listitem', { name: 'bob@example.com' })

    fireEvent.click(within(bob).getByRole('button', { name: 'Role: Editor' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))

    await waitForElementToBeRemoved(bob)
    await expect(pagesApi.getMembers(wiki.id)).resolves.toMatchObject({
      members: [{ email: 'alice@example.com' }]
    })
  })

  it('sends an admin who removes themself back to the wikis, as deleting it does', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({
      name: 'Engineering',
      members: { 'bob@example.com': 'admin' }
    })
    const removeMember = pagesApi.removeMember.getMockImplementation()
    let answer = (): void => undefined
    pagesApi.removeMember.mockImplementationOnce(async (wikiId, userId) => {
      await removeMember?.(wikiId, userId)
      await new Promise<void>(resolve => {
        answer = resolve
      })
    })
    const { router } = renderRoute(`/wikis/${wiki.id}`, { pagesApi })
    fireEvent.click(await screen.findByRole('button', { name: 'Share' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Share Engineering'
    })
    const alice = await within(dialog).findByRole('listitem', {
      name: 'Alice Martin'
    })

    fireEvent.click(within(alice).getByRole('button', { name: 'Role: Admin' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    // The stream tells the wiki out of reach before the answer comes.
    expect(await screen.findByText(WIKI_NOT_FOUND)).toBeVisible()
    act(() => {
      answer()
    })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
    const wikis = await screen.findByRole('list', { name: 'Wikis' })
    expect(
      within(wikis)
        .getAllByRole('listitem')
        .map(item => item.textContent)
    ).toEqual(['Personal'])
  })

  it('shows an invited person as a member once they sign in', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Engineering' })
    await pagesApi.invite(wiki.id, 'bob@example.com', 'editor')
    const dialog = await openSharing(pagesApi, wiki.id)
    await dialog.findByRole('listitem', { name: 'bob@example.com' })

    await act(() =>
      pagesApi.signedInAs('bob@example.com', 'Bob Stone').listWikis()
    )

    const bob = await dialog.findByRole('listitem', { name: 'Bob Stone' })
    expect(bob).not.toHaveTextContent('Invitation')
    expect(
      within(bob).getByRole('button', { name: 'Role: Editor' })
    ).toBeVisible()
  })
})
