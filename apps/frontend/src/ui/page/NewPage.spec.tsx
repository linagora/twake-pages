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
}

/** The Engineering wiki, open on its home page. */
function engineering({
  base = '/wikis',
  role = 'admin',
  lang = 'en'
}: Opening = {}) {
  const pagesApi = fakePagesApi()
  const wiki = pagesApi.withWiki({ name: 'Engineering', role })
  return {
    pagesApi,
    wiki,
    ...renderRoute(`${base}/${wiki.id}`, { pagesApi, lang })
  }
}

describe('a new page', () => {
  it.each(['/wikis', '/embed/wikis'])(
    'opens once created at the top of the tree, from the home page at %s/<wiki>',
    async base => {
      const { pagesApi, wiki, router } = engineering({ base })

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
    engineering()

    const dialog = await openNewPage()
    const create = within(dialog).getByRole('button', { name: 'Create' })
    expect(create).toBeDisabled()

    typeIn(dialog, 'Title', '   ')

    expect(create).toBeDisabled()
  })

  it('says so when it cannot be created', async () => {
    const { pagesApi } = engineering()
    pagesApi.createPage.mockRejectedValue(new ApiError(403, 'forbidden'))

    const dialog = await openNewPage()
    typeIn(dialog, 'Title', 'Onboarding')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The page could not be created.'
    )
  })

  it('is not made when the dialog is closed', async () => {
    const { pagesApi } = engineering()

    const dialog = await openNewPage()
    typeIn(dialog, 'Title', 'Onboarding')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument()
    })
    expect(pagesApi.createPage).not.toHaveBeenCalled()
  })

  it('cannot be created by a viewer of the wiki', async () => {
    engineering({ role: 'viewer' })

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
    engineering()

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
    engineering()

    const dialog = await openNewPage()
    typeIn(dialog, 'Title', 'Onboarding')
    chooseIn(dialog, 'Template', template)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await screen.findByRole('heading', { level: 1, name: 'Onboarding' })
    expect(sections()).toEqual(titles)
  })

  it('is written in the language of the person', async () => {
    engineering({ lang: 'fr' })

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
