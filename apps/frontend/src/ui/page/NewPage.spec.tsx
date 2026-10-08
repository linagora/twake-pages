import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiError } from '@/application/pages'
import type { Role } from '@/domain/wiki'
import { fakePagesApi } from '@/testing/fakePagesApi'
import { chooseIn, typeIn } from '@/testing/forms'
import { renderRoute } from '@/testing/renderWithProviders'
import type { SupportedLanguage } from '@/ui/i18n/languages'

/** Opens the dialog of a new page from the home page of the wiki. */
async function openNewPage(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: 'New page' }))
  return screen.getByRole('dialog', { name: 'New page' })
}

interface Opening {
  /** Where the routes start: `/wikis`, or `/embed/wikis` in TwakeSpace. */
  base?: string
  role?: Role
  lang?: SupportedLanguage
  /** Onboarding, a page at the top of the tree, live or in the trash. */
  parent?: 'live' | 'in the trash'
  /** The page opened at its own path, in place of the wiki on its home page. */
  open?: 'parent' | 'home page'
}

/** The Engineering wiki, open on its home page or on the page asked for. */
async function engineering({
  base = '/wikis',
  role = 'admin',
  lang = 'en',
  parent: placed,
  open
}: Opening = {}) {
  const pagesApi = fakePagesApi()
  const wiki = pagesApi.withWiki({ name: 'Engineering', role })
  const parent = placed && pagesApi.withPage(wiki.id, { title: 'Onboarding' })
  if (parent && placed === 'in the trash') await pagesApi.deletePage(parent.id)
  let path = `${base}/${wiki.id}`
  if (open === 'parent' && parent) path += `/pages/${parent.id}`
  if (open === 'home page') path += `/pages/${wiki.homePageId}`
  return {
    pagesApi,
    wiki,
    parent,
    ...renderRoute(path, { pagesApi, lang })
  }
}

describe('a new page', () => {
  it.each(['/wikis', '/embed/wikis'])(
    'opens once created at the top of the tree, from the home page at %s/<wiki>',
    async base => {
      const { pagesApi, wiki, router } = await engineering({ base })

      const dialog = await openNewPage()
      typeIn(dialog, 'Title', ' Onboarding ')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Onboarding' })
      ).toBeVisible()
      const page = screen.getByRole('treeitem', { name: 'Onboarding' })
      expect(page).toHaveAttribute('aria-level', '1')
      expect(page).toHaveAttribute('aria-current', 'page')
      expect(router.state.location.pathname).toBe(page.getAttribute('href'))
      expect(pagesApi.createPage).toHaveBeenCalledWith(wiki.id, {
        title: 'Onboarding',
        kind: 'document',
        parentId: null,
        content: []
      })
    }
  )

  it('needs a title', async () => {
    await engineering()

    const dialog = await openNewPage()
    const create = within(dialog).getByRole('button', { name: 'Create' })
    expect(create).toBeDisabled()

    typeIn(dialog, 'Title', '   ')

    expect(create).toBeDisabled()
  })

  it('says so when it cannot be created', async () => {
    const { pagesApi } = await engineering()
    pagesApi.createPage.mockRejectedValue(new ApiError(403, 'forbidden'))

    const dialog = await openNewPage()
    typeIn(dialog, 'Title', 'Onboarding')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The page could not be created.'
    )
  })

  it('is not made when the dialog is closed', async () => {
    const { pagesApi } = await engineering()

    const dialog = await openNewPage()
    typeIn(dialog, 'Title', 'Onboarding')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument()
    })
    expect(pagesApi.createPage).not.toHaveBeenCalled()
  })

  it('cannot be created by a viewer of the wiki', async () => {
    await engineering({ role: 'viewer' })

    await screen.findByRole('heading', { level: 1, name: 'Engineering' })

    expect(
      screen.queryByRole('button', { name: 'New page' })
    ).not.toBeInTheDocument()
  })
})

/** The headings of the blocks of the open page, one level below its title. */
const sections = () =>
  within(screen.getByRole('main'))
    .getAllByRole('heading', { level: 2 })
    .map(heading => heading.textContent)

describe('the template of a new page', () => {
  it('is one of six, blank unless another is chosen', async () => {
    await engineering()

    const dialog = await openNewPage()
    const template = within(dialog).getByRole('combobox', { name: 'Template' })

    expect(template).toHaveDisplayValue('Blank')
    expect(
      within(template)
        .getAllByRole('option')
        .map(option => option.textContent)
    ).toEqual([
      'Blank',
      'Meeting notes',
      'Decision',
      'How-to',
      'Retrospective',
      'Requirements'
    ])
  })

  it.each([
    ['Meeting notes', ['Attendees', 'Agenda', 'Notes', 'Action items']],
    ['Decision', ['Context', 'Options', 'Decision', 'Consequences']],
    ['How-to', ['Before you start', 'Steps', 'If something goes wrong']],
    ['Retrospective', ['What went well', 'What could be better', 'Actions']],
    ['Requirements', ['Goal', 'Requirements', 'Out of scope', 'Open questions']]
  ])('gives the page made from %s its sections', async (template, titles) => {
    await engineering()

    const dialog = await openNewPage()
    typeIn(dialog, 'Title', 'Onboarding')
    chooseIn(dialog, 'Template', template)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await screen.findByRole('heading', { level: 1, name: 'Onboarding' })
    expect(sections()).toEqual(titles)
  })

  it('is written in the language of the person', async () => {
    await engineering({ lang: 'fr' })

    fireEvent.click(
      await screen.findByRole('button', { name: 'Nouvelle page' })
    )
    const dialog = screen.getByRole('dialog', { name: 'Nouvelle page' })
    typeIn(dialog, 'Titre', 'Arrivée')
    chooseIn(dialog, 'Modèle', 'Guide pratique')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Créer' }))

    await screen.findByRole('heading', { level: 1, name: 'Arrivée' })
    expect(sections()).toEqual([
      'Avant de commencer',
      'Étapes',
      'En cas de problème'
    ])
  })
})

describe('a child page', () => {
  it.each(['/wikis', '/embed/wikis'])(
    'opens once created under its parent, from the menu of the parent at %s/<wiki>',
    async base => {
      const { pagesApi, wiki, parent, router } = await engineering({
        base,
        parent: 'live',
        open: 'parent'
      })

      fireEvent.click(
        await screen.findByRole('button', { name: 'Page options' })
      )
      fireEvent.click(screen.getByRole('menuitem', { name: 'New child page' }))
      const dialog = screen.getByRole('dialog', {
        name: 'New page under Onboarding'
      })
      typeIn(dialog, 'Title', 'Laptop setup')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Laptop setup' })
      ).toBeVisible()
      const child = within(
        screen.getByRole('group', { name: 'Onboarding' })
      ).getByRole('treeitem', { name: 'Laptop setup' })
      expect(child).toHaveAttribute('aria-level', '2')
      expect(child).toHaveAttribute('aria-current', 'page')
      expect(router.state.location.pathname).toBe(child.getAttribute('href'))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(pagesApi.createPage).toHaveBeenCalledWith(wiki.id, {
        title: 'Laptop setup',
        kind: 'document',
        parentId: parent?.id,
        content: []
      })
    }
  )

  it('cannot be made under a page in the trash', async () => {
    await engineering({ parent: 'in the trash', open: 'parent' })

    await screen.findByText('This page is in the trash.')

    expect(
      screen.queryByRole('button', { name: 'Page options' })
    ).not.toBeInTheDocument()
  })

  it('cannot be made under the home page', async () => {
    await engineering({ open: 'home page' })

    await screen.findByRole('heading', { level: 1, name: 'Engineering' })

    expect(
      screen.queryByRole('button', { name: 'Page options' })
    ).not.toBeInTheDocument()
  })

  it('cannot be made by a viewer of the wiki', async () => {
    await engineering({ role: 'viewer', parent: 'live', open: 'parent' })

    await screen.findByRole('heading', { level: 1, name: 'Onboarding' })

    expect(
      screen.queryByRole('button', { name: 'Page options' })
    ).not.toBeInTheDocument()
  })
})
