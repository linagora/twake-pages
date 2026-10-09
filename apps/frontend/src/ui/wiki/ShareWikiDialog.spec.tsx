import { act, fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { fakePagesApi, type FakePagesApi } from '@/testing/fakePagesApi'
import { renderRoute } from '@/testing/renderWithProviders'

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
})
