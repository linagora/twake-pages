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
import { fakePagesApi } from '@/testing/fakePagesApi'
import { typeIn } from '@/testing/forms'
import { renderRoute, WIKI_BASES } from '@/testing/renderWithProviders'

const OPTIONS = 'Wiki options'
const WIKI_NOT_FOUND = "This wiki doesn't exist, or you can't open it."

/** Chooses an item of the wiki's menu, and finds the dialog it opens. */
async function choose(item: string, dialog: string): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: OPTIONS }))
  fireEvent.click(screen.getByRole('menuitem', { name: item }))
  return screen.findByRole('dialog', { name: dialog })
}

describe('WikiHomeScreen', () => {
  it('shows the wiki under its name, with what it is for', async () => {
    const pagesApi = fakePagesApi()
    const wiki = await pagesApi.createWiki({
      name: 'Handbook',
      description: 'How we work together'
    })
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Handbook' })
    ).toBeVisible()
    expect(screen.getByText('How we work together')).toBeVisible()
    await waitFor(() => {
      expect(document.title).toBe('Handbook - Twake Pages')
    })
  })

  it('shows no description made of blanks only', async () => {
    const pagesApi = fakePagesApi()
    const wiki = await pagesApi.createWiki({
      name: 'Handbook',
      description: ' \n '
    })
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })

    const version = await screen.findByText('Version 1')

    // Right under the name of the wiki, with no empty line between.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Handbook' })
        .nextElementSibling
    ).toBe(version)
  })

  it('shows the personal wiki under its label, in the language of the person', async () => {
    const pagesApi = fakePagesApi()
    const personal = pagesApi.withWiki({ kind: 'personal' })
    renderRoute(`/wikis/${personal.id}`, { lang: 'fr', pagesApi })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Personnel' })
    ).toBeVisible()
  })

  it('shows the blocks of its home page', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Handbook' })
    await pagesApi.publish(wiki.homePageId, {
      baseVersion: 1,
      title: 'Handbook',
      content: [{ type: 'paragraph', content: 'Start with the onboarding.' }]
    })
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })

    expect(await screen.findByText('Start with the onboarding.')).toBeVisible()
  })

  it('says when its home page holds nothing yet', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Handbook' })
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })

    expect(await screen.findByText('This page is empty.')).toBeVisible()
  })

  it('shows the number of the version of its home page', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Handbook' })
    await pagesApi.publish(wiki.homePageId, {
      baseVersion: 1,
      title: 'Handbook',
      content: []
    })
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })

    expect(await screen.findByText('Version 2')).toBeVisible()
  })

  it.each(WIKI_BASES)(
    'leads from %s/<wiki> to the history of its home page, by the number of its version',
    async base => {
      const pagesApi = fakePagesApi()
      const wiki = pagesApi.withWiki({ name: 'Handbook' })
      renderRoute(`${base}/${wiki.id}`, { pagesApi })

      expect(
        await screen.findByRole('link', { name: 'Version 1' })
      ).toHaveAttribute(
        'href',
        `${base}/${wiki.id}/pages/${wiki.homePageId}/history`
      )
    }
  )
})

describe('the admin of a wiki', () => {
  it('renames a shared wiki, and says what it is for', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Handbook' })
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })

    const dialog = await choose('Edit', 'Edit wiki')
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue(
      'Handbook'
    )
    typeIn(dialog, 'Name', 'Guide')
    typeIn(dialog, 'Description', 'How we work')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitForElementToBeRemoved(dialog)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Guide' })
    ).toBeVisible()
    expect(screen.getByText('How we work')).toBeVisible()
  })

  it.each([
    ['personal', '/wikis'],
    ['space', '/wikis'],
    ['space', '/embed/wikis']
  ] as const)(
    'says what a %s wiki is for at %s/<wiki>, and leaves its name alone',
    async (kind, base) => {
      const pagesApi = fakePagesApi()
      const wiki = pagesApi.withWiki({ name: 'Design Sprint', kind })
      renderRoute(`${base}/${wiki.id}`, { pagesApi })

      const dialog = await choose('Edit', 'Edit wiki')
      expect(
        within(dialog).queryByRole('textbox', { name: 'Name' })
      ).not.toBeInTheDocument()
      typeIn(dialog, 'Description', 'Our sprint notes')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

      await waitForElementToBeRemoved(dialog)
      expect(screen.getByText('Our sprint notes')).toBeVisible()
      expect(pagesApi.renameWiki).toHaveBeenCalledWith(wiki.id, {
        description: 'Our sprint notes'
      })
    }
  )

  it('says so when the wiki cannot be saved', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Handbook' })
    pagesApi.renameWiki.mockRejectedValue(new ApiError(400, 'invalid_request'))
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })

    const dialog = await choose('Edit', 'Edit wiki')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The wiki could not be saved.'
    )
  })

  it('deletes a shared wiki once sure, and goes back to the wikis', async () => {
    const pagesApi = fakePagesApi()
    pagesApi.withWiki({ name: 'Handbook' })
    const { router } = renderRoute('/', { pagesApi })

    fireEvent.click(await screen.findByRole('link', { name: 'Handbook' }))
    const dialog = await choose('Delete', 'Delete Handbook?')
    expect(dialog).toHaveTextContent(
      'Its pages go with it, for every member. This cannot be undone.'
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    const wikis = await screen.findByRole('list', { name: 'Wikis' })
    expect(router.state.location.pathname).toBe('/')
    expect(
      within(wikis)
        .getAllByRole('listitem')
        .map(item => item.textContent)
    ).toEqual(['Personal'])
  })

  it('goes back to the wikis when the stream tells the wiki gone before its answer does', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Handbook' })
    const deleteWiki = pagesApi.deleteWiki.getMockImplementation()
    let answer = (): void => undefined
    const answered = new Promise<void>(resolve => {
      answer = resolve
    })
    pagesApi.deleteWiki.mockImplementationOnce(async wikiId => {
      await deleteWiki?.(wikiId)
      await answered
    })
    const { router } = renderRoute(`/wikis/${wiki.id}`, { pagesApi })

    const dialog = await choose('Delete', 'Delete Handbook?')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText(WIKI_NOT_FOUND)).toBeVisible()
    act(() => {
      answer()
    })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
  })

  it('keeps the wiki when not sure', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Handbook' })
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })

    const dialog = await choose('Delete', 'Delete Handbook?')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument()
    })
    expect(pagesApi.deleteWiki).not.toHaveBeenCalled()
  })

  it('says so when the wiki cannot be deleted', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Handbook' })
    pagesApi.deleteWiki.mockRejectedValue(new ApiError(403, 'forbidden'))
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })

    const dialog = await choose('Delete', 'Delete Handbook?')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The wiki could not be deleted.'
    )
  })

  it.each(['personal', 'space'] as const)(
    'cannot delete a %s wiki, which goes with its person or space',
    async kind => {
      const pagesApi = fakePagesApi()
      const wiki = pagesApi.withWiki({ name: 'Design Sprint', kind })
      renderRoute(`/wikis/${wiki.id}`, { pagesApi })

      fireEvent.click(await screen.findByRole('button', { name: OPTIONS }))

      expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
      expect(
        screen.queryByRole('menuitem', { name: 'Delete' })
      ).not.toBeInTheDocument()
    }
  )

  it.each(['editor', 'viewer'] as const)(
    'is the only one with the options of the wiki, not an %s',
    async role => {
      const pagesApi = fakePagesApi()
      const wiki = pagesApi.withWiki({ name: 'Handbook', role })
      renderRoute(`/wikis/${wiki.id}`, { pagesApi })

      await screen.findByRole('heading', { level: 1, name: 'Handbook' })

      expect(
        screen.queryByRole('button', { name: OPTIONS })
      ).not.toBeInTheDocument()
    }
  )
})

describe('the home page as a favorite', () => {
  it.each(['admin', 'editor', 'viewer'] as const)(
    'is added by a member with the %s role, and taken out again',
    async role => {
      const pagesApi = fakePagesApi()
      const wiki = pagesApi.withWiki({ name: 'Handbook', role })
      renderRoute(`/wikis/${wiki.id}`, { pagesApi })

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
      }).toEqual({ marked: [wiki.homePageId], left: [] })
    }
  )

  it('is read once for the page and its button, which counts one visit', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Handbook' })
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })

    await screen.findByRole('button', { name: 'Add to favorites' })
    expect(await screen.findByText('This page is empty.')).toBeVisible()

    expect(pagesApi.getPage).toHaveBeenCalledTimes(1)
  })
})

describe('the home page as followed', () => {
  it.each(['admin', 'editor', 'viewer'] as const)(
    'is followed by a member with the %s role, and no more',
    async role => {
      const pagesApi = fakePagesApi()
      const wiki = pagesApi.withWiki({ name: 'Handbook', role })
      await pagesApi.setFollowing(wiki.homePageId, false)
      renderRoute(`/wikis/${wiki.id}`, { pagesApi })

      fireEvent.click(await screen.findByRole('button', { name: 'Follow' }))
      const following = await screen.findByRole('button', {
        name: 'Following'
      })
      const followed = (await pagesApi.getPage(wiki.homePageId)).following
      fireEvent.click(following)
      await screen.findByRole('button', { name: 'Follow' })

      expect({
        followed,
        left: (await pagesApi.getPage(wiki.homePageId)).following
      }).toEqual({ followed: true, left: false })
    }
  )
})

describe('the comments of the home page', () => {
  it('show below it', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({
      name: 'Handbook',
      members: { 'bob@example.com': 'editor' }
    })
    await pagesApi
      .signedInAs('bob@example.com', 'Bob Durand')
      .addComment(wiki.homePageId, { body: 'Welcome aboard!' })
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })

    const comments = await screen.findByRole('list', { name: 'Comments' })

    expect(
      within(comments).getByRole('article', { name: 'Bob Durand' })
    ).toHaveTextContent('Welcome aboard!')
  })

  it('are written below it, by any member', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Handbook', role: 'viewer' })
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })
    const comments = await screen.findByRole('region', { name: 'Comments' })

    typeIn(comments, 'Comment', 'Thanks for the welcome.')
    fireEvent.click(within(comments).getByRole('button', { name: 'Send' }))

    expect(
      await within(comments).findByRole('article', { name: 'Alice Martin' })
    ).toHaveTextContent('Thanks for the welcome.')
  })
})

describe('the Edit action of the home page', () => {
  it.each(WIKI_BASES)(
    'leads an editor of the wiki at %s/<wiki> to the editor of its home page',
    async base => {
      const pagesApi = fakePagesApi()
      const wiki = pagesApi.withWiki({ name: 'Handbook', role: 'editor' })
      renderRoute(`${base}/${wiki.id}`, { pagesApi })

      expect(
        await screen.findByRole('link', { name: 'Edit page' })
      ).toHaveAttribute(
        'href',
        `${base}/${wiki.id}/pages/${wiki.homePageId}/edit`
      )
    }
  )

  it('is not offered to a viewer of the wiki', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Handbook', role: 'viewer' })
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })

    await screen.findByText('This page is empty.')
    expect(
      screen.queryByRole('link', { name: 'Edit page' })
    ).not.toBeInTheDocument()
  })
})
