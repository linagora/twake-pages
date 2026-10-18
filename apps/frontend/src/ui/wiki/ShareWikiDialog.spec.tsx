import {
  act,
  fireEvent,
  screen,
  waitFor,
  waitForElementToBeRemoved,
  within
} from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiError } from '@/application/pages'
import { fakePagesApi, type FakePagesApi } from '@/testing/fakePagesApi'
import { renderRoute } from '@/testing/renderWithProviders'

const WIKI_NOT_FOUND = "This wiki doesn't exist, or you can't open it."

// How a member who does not share the wiki opens its members.
const READ_ONLY = { button: 'Members', dialog: 'People with access' }

/** Opens the dialog of the wiki's members from its home page. */
async function openSharing(
  pagesApi: FakePagesApi,
  wikiId: string,
  { button = 'Share', dialog = 'Share Engineering' } = {}
) {
  renderRoute(`/wikis/${wikiId}`, { pagesApi })
  fireEvent.click(await screen.findByRole('button', { name: button }))
  return within(await screen.findByRole('dialog', { name: dialog }))
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

  it('suggests the people of the organization who signed in, by name or email, and invites the one chosen', async () => {
    const pagesApi = fakePagesApi()
    await pagesApi.signedInAs('bob@example.com', 'Bob Stone').listWikis()
    const wiki = pagesApi.withWiki({ name: 'Engineering' })
    const dialog = await openSharing(pagesApi, wiki.id)
    const form = within(dialog.getByRole('form', { name: 'Invite' }))

    fireEvent.change(form.getByRole('combobox', { name: 'Email' }), {
      target: { value: 'stone' }
    })
    fireEvent.click(
      await screen.findByRole('option', { name: 'Bob Stone bob@example.com' })
    )
    fireEvent.click(form.getByRole('button', { name: 'Invite' }))

    expect(await dialog.findByText('Invited bob@example.com.')).toBeVisible()
  })

  it('tells when the suggestions could not be loaded, and still invites the email typed', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Engineering' })
    pagesApi.searchPeople.mockRejectedValue(new ApiError(403, null))
    const dialog = await openSharing(pagesApi, wiki.id)
    const form = within(dialog.getByRole('form', { name: 'Invite' }))
    const email = form.getByRole('combobox', { name: 'Email' })

    fireEvent.change(email, { target: { value: 'bob@example.com' } })

    expect(
      await form.findByText('The suggestions could not be loaded.')
    ).toBeVisible()
    expect(email).toHaveAccessibleDescription(
      'The suggestions could not be loaded.'
    )
    fireEvent.click(form.getByRole('button', { name: 'Invite' }))
    expect(await dialog.findByText('Invited bob@example.com.')).toBeVisible()
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
    const answered = new Promise<void>(resolve => {
      answer = resolve
    })
    pagesApi.removeMember.mockImplementationOnce(async (wikiId, userId) => {
      await removeMember?.(wikiId, userId)
      await answered
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

  it('lets the admin cancel an invitation', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Engineering' })
    await pagesApi.invite(wiki.id, 'eve@example.com', 'editor')
    const dialog = await openSharing(pagesApi, wiki.id)
    const eve = await dialog.findByRole('listitem', { name: 'eve@example.com' })

    fireEvent.click(within(eve).getByRole('button', { name: 'Role: Editor' }))
    expect(screen.queryByRole('menuitem', { name: 'Viewer' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel invitation' }))

    await waitForElementToBeRemoved(eve)
    await expect(pagesApi.getMembers(wiki.id)).resolves.toMatchObject({
      invites: []
    })
  })

  it('tells the admin that only people of their organization are invited, and keeps the email', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Engineering' })
    const dialog = await openSharing(pagesApi, wiki.id)
    const form = within(dialog.getByRole('form', { name: 'Invite' }))
    const email = form.getByRole('combobox', { name: 'Email' })

    fireEvent.change(email, { target: { value: 'bob@elsewhere.com' } })
    fireEvent.click(form.getByRole('button', { name: 'Invite' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent(
      'Only people of your organization can be invited.'
    )
    expect(email).toHaveValue('bob@elsewhere.com')
    expect(dialog.queryByRole('status')).toBeNull()
  })

  it('tells the admin that an email the browser takes but the backend refuses is not valid, and keeps it', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Engineering' })
    const dialog = await openSharing(pagesApi, wiki.id)
    const form = within(dialog.getByRole('form', { name: 'Invite' }))
    const email = form.getByRole('combobox', { name: 'Email' })

    fireEvent.change(email, { target: { value: 'bob@example' } })
    fireEvent.click(form.getByRole('button', { name: 'Invite' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent(
      'This email address is not valid.'
    )
    expect(email).toHaveValue('bob@example')
  })

  it('tells the last admin that a wiki keeps one', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({
      name: 'Engineering',
      members: { 'bob@example.com': 'editor' }
    })
    const dialog = await openSharing(pagesApi, wiki.id)
    const alice = within(
      await dialog.findByRole('listitem', { name: 'Alice Martin' })
    )

    fireEvent.click(alice.getByRole('button', { name: 'Role: Admin' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Editor' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent(
      'A wiki keeps at least one admin.'
    )
    expect(alice.getByRole('button', { name: 'Role: Admin' })).toBeVisible()
  })

  it('keeps the last admin who removes themself on the wiki, and tells why', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({
      name: 'Engineering',
      members: { 'bob@example.com': 'editor' }
    })
    const { router } = renderRoute(`/wikis/${wiki.id}`, { pagesApi })
    fireEvent.click(await screen.findByRole('button', { name: 'Share' }))
    const dialog = within(
      await screen.findByRole('dialog', { name: 'Share Engineering' })
    )
    const alice = within(
      await dialog.findByRole('listitem', { name: 'Alice Martin' })
    )

    fireEvent.click(alice.getByRole('button', { name: 'Role: Admin' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent(
      'A wiki keeps at least one admin.'
    )
    expect(router.state.location.pathname).toBe(`/wikis/${wiki.id}`)
    expect(alice.getByRole('button', { name: 'Role: Admin' })).toBeVisible()
  })

  it('tells that a change was not saved, and shows the members as they now are', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({
      name: 'Engineering',
      members: { 'bob@example.com': 'viewer', 'carol@example.com': 'admin' }
    })
    const bob = pagesApi.signedInAs('bob@example.com')
    const carol = pagesApi.signedInAs('carol@example.com')
    // Down, so the dialog still shows bob once carol removed him.
    pagesApi.watchWiki.mockImplementation(() => () => undefined)
    const dialog = await openSharing(pagesApi, wiki.id)
    const bobRow = within(
      await dialog.findByRole('listitem', { name: 'bob@example.com' })
    )
    await carol.removeMember(wiki.id, bob.person.id)

    fireEvent.click(bobRow.getByRole('button', { name: 'Role: Viewer' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Editor' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent(
      'The change could not be saved.'
    )
    expect(
      dialog.queryByRole('listitem', { name: 'bob@example.com' })
    ).toBeNull()
  })

  it('tells only why the last change failed', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({
      name: 'Engineering',
      members: { 'bob@example.com': 'editor' }
    })
    const dialog = await openSharing(pagesApi, wiki.id)
    const alice = within(
      await dialog.findByRole('listitem', { name: 'Alice Martin' })
    )
    fireEvent.click(alice.getByRole('button', { name: 'Role: Admin' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    await dialog.findByRole('alert')
    const form = within(dialog.getByRole('form', { name: 'Invite' }))

    fireEvent.change(form.getByRole('combobox', { name: 'Email' }), {
      target: { value: 'bob@elsewhere.com' }
    })
    fireEvent.click(form.getByRole('button', { name: 'Invite' }))

    await waitFor(() => {
      expect(dialog.getByRole('alert')).toHaveTextContent(
        'Only people of your organization can be invited.'
      )
    })
  })

  it('tells when the members could not be loaded', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Engineering' })
    pagesApi.getMembers.mockRejectedValue(new ApiError(403, null))

    const dialog = await openSharing(pagesApi, wiki.id)

    expect(await dialog.findByRole('alert')).toHaveTextContent(
      'The members could not be loaded.'
    )
  })

  it.each(['editor', 'viewer'] as const)(
    'shows the members, read only, to a member who is %s',
    async role => {
      const pagesApi = fakePagesApi()
      const wiki = pagesApi.withWiki({
        name: 'Engineering',
        role,
        members: { 'bob@example.com': 'admin' }
      })

      const dialog = await openSharing(pagesApi, wiki.id, READ_ONLY)

      expect(
        await dialog.findByRole('listitem', { name: 'bob@example.com' })
      ).toHaveTextContent('Admin')
      expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
      expect(dialog.queryByRole('form', { name: 'Invite' })).toBeNull()
      expect(dialog.queryByRole('button', { name: /^Role: / })).toBeNull()
    }
  )

  it('hides the invitations from an admin made an editor, before the members are read again', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({
      name: 'Engineering',
      members: { 'carol@example.com': 'admin' }
    })
    await pagesApi.invite(wiki.id, 'erin@example.com', 'viewer')
    const carol = pagesApi.signedInAs('carol@example.com')
    const dialog = await openSharing(pagesApi, wiki.id)
    await dialog.findByRole('listitem', { name: 'erin@example.com' })
    pagesApi.getMembers.mockImplementation(() => new Promise(() => undefined))

    await act(() => carol.setMemberRole(wiki.id, pagesApi.person.id, 'editor'))

    expect(
      await screen.findByRole('dialog', { name: 'People with access' })
    ).toBeVisible()
    expect(
      dialog.getByRole('listitem', { name: 'carol@example.com' })
    ).toHaveTextContent('Admin')
    expect(
      dialog.queryByRole('listitem', { name: 'erin@example.com' })
    ).toBeNull()
  })

  it('shows the members of a space wiki read only, as coming from its space', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({
      name: 'Engineering',
      kind: 'space',
      members: { 'bob@example.com': 'viewer' }
    })

    const dialog = await openSharing(pagesApi, wiki.id, READ_ONLY)

    expect(
      dialog.getByText('The members of this wiki come from its space.')
    ).toBeVisible()
    expect(
      await dialog.findByRole('listitem', { name: 'bob@example.com' })
    ).toHaveTextContent('Viewer')
    expect(dialog.queryByRole('form', { name: 'Invite' })).toBeNull()
    expect(dialog.queryByRole('button', { name: /^Role: / })).toBeNull()
  })

  it('offers no sharing of the personal wiki', async () => {
    const pagesApi = fakePagesApi()
    const personal = pagesApi.withWiki({ kind: 'personal' })
    renderRoute(`/wikis/${personal.id}`, { pagesApi })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Personal' })
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Members' })).toBeNull()
  })
})
