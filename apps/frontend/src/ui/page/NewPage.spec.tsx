import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiError } from '@/application/pages'
import type { Role } from '@/domain/wiki'
import { BUDGET, fakePagesApi, GRIST_ORIGIN } from '@/testing/fakePagesApi'
import { chooseIn, typeIn } from '@/testing/forms'
import { renderRoute, WIKI_BASES } from '@/testing/renderWithProviders'
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
  /** Where the pages frame Grist documents from. */
  gristOrigins?: readonly string[]
}

/** The Engineering wiki, open on its home page or on the page asked for. */
async function engineering({
  base = '/wikis',
  role = 'admin',
  lang = 'en',
  parent: placed,
  open,
  gristOrigins = [GRIST_ORIGIN]
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
    ...renderRoute(path, { pagesApi, lang, gristOrigins })
  }
}

describe('a new page', () => {
  it.each(WIKI_BASES)(
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

/**
 * The headings one level below the title of the open page: those of its
 * blocks, once BlockNote shows them, then that of its comments, which shows
 * at once.
 */
const findSections = async () => {
  const main = screen.getByRole('main')
  await waitFor(() => {
    expect(within(main).queryByRole('progressbar')).not.toBeInTheDocument()
  })
  return within(main)
    .getAllByRole('heading', { level: 2 })
    .map(heading => heading.textContent)
}

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
    expect(await findSections()).toEqual([...titles, 'Comments'])
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
    expect(await findSections()).toEqual([
      'Avant de commencer',
      'Étapes',
      'En cas de problème',
      'Commentaires'
    ])
  })
})

describe('a new database page', () => {
  it('is one of the two types offered, a page unless another is chosen', async () => {
    await engineering()

    const dialog = await openNewPage()
    const type = within(dialog).getByRole('combobox', { name: 'Type' })

    expect(type).toHaveDisplayValue('Page')
    expect(
      within(type)
        .getAllByRole('option')
        .map(option => option.textContent)
    ).toEqual(['Page', 'Database'])
  })

  it('opens once created at a Grist address, framing its document', async () => {
    const { pagesApi, wiki } = await engineering()

    const dialog = await openNewPage()
    typeIn(dialog, 'Title', 'Budget')
    chooseIn(dialog, 'Type', 'Database')
    typeIn(dialog, 'Grist address', ` ${BUDGET} `)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Budget' })
    ).toBeVisible()
    expect(await screen.findByTitle('Grist document')).toHaveAttribute(
      'src',
      BUDGET
    )
    expect(pagesApi.createPage).toHaveBeenCalledWith(wiki.id, {
      title: 'Budget',
      kind: 'database',
      parentId: null,
      gristUrl: BUDGET
    })
  })

  it('takes a Grist address in place of a template', async () => {
    await engineering()

    const dialog = await openNewPage()
    chooseIn(dialog, 'Type', 'Database')

    expect(
      within(dialog).getByRole('textbox', { name: 'Grist address' })
    ).toBeVisible()
    expect(
      within(dialog).queryByRole('combobox', { name: 'Template' })
    ).not.toBeInTheDocument()
  })

  it('needs a Grist address', async () => {
    await engineering()

    const dialog = await openNewPage()
    typeIn(dialog, 'Title', 'Budget')
    chooseIn(dialog, 'Type', 'Database')
    const create = within(dialog).getByRole('button', { name: 'Create' })
    expect(create).toBeDisabled()

    typeIn(dialog, 'Grist address', '   ')

    expect(create).toBeDisabled()
  })

  it('is refused off the Grist origins, which its field names until the address changes', async () => {
    await engineering()

    const dialog = await openNewPage()
    typeIn(dialog, 'Title', 'Budget')
    chooseIn(dialog, 'Type', 'Database')
    typeIn(dialog, 'Grist address', 'https://docs.example.com/o/docs/4kq2')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    const address = within(dialog).getByRole('textbox', {
      name: 'Grist address'
    })
    await waitFor(() => {
      expect(address).toHaveAccessibleDescription(
        'Twake Pages shows Grist documents from https://grist.example.com only.'
      )
    })
    expect(address).toBeInvalid()
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()

    typeIn(dialog, 'Grist address', BUDGET)

    expect(address).toHaveAccessibleDescription(
      'The address of a Grist document, or of one of its pages'
    )
    expect(address).toBeValid()
  })

  it('is not offered where the pages frame no Grist', async () => {
    await engineering({ gristOrigins: [] })

    const dialog = await openNewPage()

    expect(
      within(dialog).getByRole('combobox', { name: 'Template' })
    ).toBeVisible()
    expect(
      within(dialog).queryByRole('combobox', { name: 'Type' })
    ).not.toBeInTheDocument()
  })
})

describe('a child page', () => {
  it.each(WIKI_BASES)(
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
    await screen.findByRole('treeitem', { name: 'Onboarding' })

    expect(
      screen.queryByRole('button', { name: 'Page options' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTitle('New page under Onboarding')
    ).not.toBeInTheDocument()
  })

  it.each(WIKI_BASES)(
    'opens once created under its parent, from the tree at %s/<wiki>',
    async base => {
      const { pagesApi, wiki, parent, router } = await engineering({
        base,
        parent: 'live'
      })

      fireEvent.click(await screen.findByTitle('New page under Onboarding'))
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
})
