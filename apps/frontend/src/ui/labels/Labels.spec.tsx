import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiError } from '@/application/pages'
import { fakePagesApi } from '@/testing/fakePagesApi'
import { typeIn } from '@/testing/forms'
import { renderRoute, WIKI_BASES } from '@/testing/renderWithProviders'

const BOB = 'bob@example.com'

/** The Handbook, whose Onboarding page carries these labels. */
async function onboardingLabelled(names: string[]) {
  const pagesApi = fakePagesApi()
  const wiki = pagesApi.withWiki({ name: 'Handbook' })
  const onboarding = pagesApi.withPage(wiki.id, { title: 'Onboarding' })
  await pagesApi.setLabels(onboarding.id, names)
  return { pagesApi, wiki, onboarding }
}

/** The Handbook, its Laptops page labelled howto, and Onboarding with none. */
async function handbookWithHowTo() {
  const pagesApi = fakePagesApi()
  const wiki = pagesApi.withWiki({ name: 'Handbook' })
  const laptops = pagesApi.withPage(wiki.id, { title: 'Laptops' })
  await pagesApi.setLabels(laptops.id, ['howto'])
  const onboarding = pagesApi.withPage(wiki.id, { title: 'Onboarding' })
  return { pagesApi, wiki, onboarding }
}

async function openLabels(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: 'Edit labels' }))
  return screen.findByRole('dialog', { name: 'Labels of Onboarding' })
}

// The picker hides the rest of the screen from assistive technologies.
const shownLabels = async () =>
  within(await screen.findByRole('list', { name: 'Page labels', hidden: true }))
    .getAllByRole('link', { hidden: true })
    .map(link => link.textContent)

/** The Handbook, which Bob runs with the person, and its labelled Onboarding. */
async function sharedHandbook() {
  const pagesApi = fakePagesApi()
  const wiki = pagesApi.withWiki({
    name: 'Handbook',
    members: { [BOB]: 'admin' }
  })
  const onboarding = pagesApi.withPage(wiki.id, { title: 'Onboarding' })
  // Labelled, the page still shows its labels once they cannot change.
  await pagesApi.setLabels(onboarding.id, ['howto'])
  return { pagesApi, bob: pagesApi.signedInAs(BOB), wiki, onboarding }
}

describe('the labels of a page', () => {
  it.each(WIKI_BASES)(
    'show on the page at %s/<wiki>/pages/<page>, each leading to its pages',
    async base => {
      const { pagesApi, wiki, onboarding } = await onboardingLabelled([
        'howto',
        'hr'
      ])
      renderRoute(`${base}/${wiki.id}/pages/${onboarding.id}`, { pagesApi })

      const labels = within(
        await screen.findByRole('list', { name: 'Page labels' })
      )
      expect(
        labels.getAllByRole('link').map(link => link.getAttribute('href'))
      ).toEqual([
        `${base}/${wiki.id}/labels/howto`,
        `${base}/${wiki.id}/labels/hr`
      ])
      expect(labels.getByRole('link', { name: 'howto' })).toBeVisible()
    }
  )

  it('show to a viewer, who cannot change them', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({
      name: 'Handbook',
      role: 'viewer',
      members: { [BOB]: 'editor' }
    })
    const onboarding = pagesApi.withPage(wiki.id, { title: 'Onboarding' })
    await pagesApi.signedInAs(BOB).setLabels(onboarding.id, ['howto'])
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}`, { pagesApi })

    expect(await shownLabels()).toEqual(['howto'])
    // Named after the wiki once its role is known.
    await screen.findByRole('link', { name: 'Handbook' })
    expect(
      screen.queryByRole('button', { name: 'Edit labels' })
    ).not.toBeInTheDocument()
  })

  it('show not at all to a viewer of a page that has none', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Handbook', role: 'viewer' })
    const onboarding = pagesApi.withPage(wiki.id, { title: 'Onboarding' })
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}`, { pagesApi })

    await screen.findByRole('link', { name: 'Handbook' })
    expect(screen.queryByText('No labels')).not.toBeInTheDocument()
  })

  it('cannot be changed on a page in the trash', async () => {
    const { pagesApi, wiki, onboarding } = await onboardingLabelled(['howto'])
    await pagesApi.deletePage(onboarding.id)
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}`, { pagesApi })

    await screen.findByText('This page is in the trash.')
    await screen.findByRole('link', { name: 'Handbook' })
    expect(await shownLabels()).toEqual(['howto'])
    expect(
      screen.queryByRole('button', { name: 'Edit labels' })
    ).not.toBeInTheDocument()
  })
})

describe('the labels picker', () => {
  it('gives the page a label of the wiki, and stays open', async () => {
    const { pagesApi, wiki, onboarding } = await handbookWithHowTo()
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}`, { pagesApi })

    const picker = within(await openLabels())
    const howto = await picker.findByRole('menuitemcheckbox', {
      name: 'howto'
    })
    expect(howto).not.toBeChecked()
    fireEvent.click(howto)

    expect(await shownLabels()).toEqual(['howto'])
    expect(pagesApi.setLabels).toHaveBeenLastCalledWith(onboarding.id, [
      'howto'
    ])
    expect(howto).toBeChecked()
    expect(
      screen.getByRole('dialog', { name: 'Labels of Onboarding' })
    ).toBeVisible()
  })

  it('closes once the page goes to the trash elsewhere', async () => {
    const { pagesApi, bob, wiki, onboarding } = await sharedHandbook()
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}`, { pagesApi })
    await openLabels()

    await act(() => bob.deletePage(onboarding.id))

    expect(await screen.findByText('This page is in the trash.')).toBeVisible()
    expect(
      screen.queryByRole('dialog', { name: 'Labels of Onboarding' })
    ).not.toBeInTheDocument()
  })

  it('closes once the person is no editor of the wiki any more', async () => {
    const { pagesApi, bob, wiki, onboarding } = await sharedHandbook()
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}`, { pagesApi })
    await openLabels()

    await act(() => bob.setMemberRole(wiki.id, pagesApi.person.id, 'viewer'))

    // The picker hides the rest of the screen from assistive technologies.
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Edit labels', hidden: true })
      ).not.toBeInTheDocument()
    })
    expect(
      screen.queryByRole('dialog', { name: 'Labels of Onboarding' })
    ).not.toBeInTheDocument()
  })

  it('takes a label off the page in one click', async () => {
    const { pagesApi, wiki, onboarding } = await onboardingLabelled([
      'howto',
      'hr'
    ])
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}`, { pagesApi })

    const picker = within(await openLabels())
    const howto = await picker.findByRole('menuitemcheckbox', {
      name: 'howto'
    })
    expect(howto).toBeChecked()
    fireEvent.click(howto)

    await waitFor(async () => {
      expect(await shownLabels()).toEqual(['hr'])
    })
    expect(pagesApi.setLabels).toHaveBeenLastCalledWith(onboarding.id, ['hr'])
  })

  it('creates a label from the search, trimmed and lowercased, and gives it to the page', async () => {
    const { pagesApi, wiki, onboarding } = await handbookWithHowTo()
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}`, { pagesApi })

    const dialog = await openLabels()
    const picker = within(dialog)
    await picker.findByRole('menuitemcheckbox', { name: 'howto' })
    typeIn(dialog, 'Search labels', ' Release ')
    expect(
      picker.queryByRole('menuitemcheckbox', { name: 'howto' })
    ).not.toBeInTheDocument()
    fireEvent.click(picker.getByRole('menuitem', { name: 'Create “release”' }))

    expect(await shownLabels()).toEqual(['release'])
    expect(pagesApi.setLabels).toHaveBeenLastCalledWith(onboarding.id, [
      'release'
    ])
    expect(picker.getByRole('textbox', { name: 'Search labels' })).toHaveValue(
      ''
    )
    expect(
      picker.getByRole('menuitemcheckbox', { name: 'release' })
    ).toBeChecked()
  })

  it('keeps the Create entry disabled, and the name off the labels, while the label is made', async () => {
    const { pagesApi, wiki, onboarding } = await handbookWithHowTo()
    // The label is never made, so that its request stays pending.
    pagesApi.setLabels.mockImplementationOnce(
      () => new Promise(() => undefined)
    )
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}`, { pagesApi })

    const dialog = await openLabels()
    typeIn(dialog, 'Search labels', 'release')
    fireEvent.click(
      within(dialog).getByRole('menuitem', { name: 'Create “release”' })
    )

    await waitFor(() => {
      expect(
        within(dialog).getByRole('menuitem', { name: 'Create “release”' })
      ).toHaveAttribute('aria-disabled', 'true')
    })
    expect(
      within(dialog).queryByRole('menuitemcheckbox', { name: 'release' })
    ).not.toBeInTheDocument()
  })

  it('offers to create only a name no label has', async () => {
    const { pagesApi, wiki, onboarding } = await handbookWithHowTo()
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}`, { pagesApi })

    const dialog = await openLabels()
    await within(dialog).findByRole('menuitemcheckbox', { name: 'howto' })
    typeIn(dialog, 'Search labels', 'HowTo')

    expect(
      within(dialog).getByRole('menuitemcheckbox', { name: 'howto' })
    ).toBeInTheDocument()
    expect(
      within(dialog).queryByRole('menuitem', { name: /^Create/ })
    ).not.toBeInTheDocument()
  })

  it('offers the label a name typed with its accent apart makes, not to create it', async () => {
    const { pagesApi, wiki, onboarding } = await onboardingLabelled([
      '\u00e9quipe'
    ])
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}`, { pagesApi })

    const dialog = await openLabels()
    await within(dialog).findByRole('menuitemcheckbox', {
      name: '\u00e9quipe'
    })
    typeIn(dialog, 'Search labels', 'e\u0301quipe')

    expect(
      within(dialog).getByRole('menuitemcheckbox', { name: '\u00e9quipe' })
    ).toBeChecked()
    expect(
      within(dialog).queryByRole('menuitem', { name: /^Create/ })
    ).not.toBeInTheDocument()
  })

  it('highlights the searched part of each label', async () => {
    const { pagesApi, wiki, onboarding } = await handbookWithHowTo()
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}`, { pagesApi })

    const dialog = await openLabels()
    await within(dialog).findByRole('menuitemcheckbox', { name: 'howto' })
    typeIn(dialog, 'Search labels', 'OW')

    const option = within(dialog).getByRole('menuitemcheckbox', {
      name: 'howto'
    })
    expect(
      [...option.querySelectorAll('mark')].map(mark => mark.textContent)
    ).toEqual(['ow'])
  })

  it('tells how to create a label in a wiki that has none', async () => {
    const { pagesApi, wiki, onboarding } = await onboardingLabelled([])
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}`, { pagesApi })

    const dialog = await openLabels()

    expect(
      await within(dialog).findByText('Type a name to create a label.')
    ).toBeVisible()
  })

  it.each([
    ['a name with a blank', 'how to', 'how to'],
    [
      'a name of 50 characters that makes 51 once lowercased',
      '\u0130' + 'a'.repeat(49),
      'i\u0307' + 'a'.repeat(49)
    ]
  ])(
    'says why %s cannot be a label, and keeps the search',
    async (_, typed, name) => {
      const { pagesApi, wiki, onboarding } = await onboardingLabelled(['hr'])
      renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}`, { pagesApi })

      const dialog = await openLabels()
      typeIn(dialog, 'Search labels', typed)
      fireEvent.click(
        within(dialog).getByRole('menuitem', { name: `Create “${name}”` })
      )

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'A label is 1 to 50 letters, digits, hyphens or underscores.'
      )
      expect(
        within(dialog).getByRole('menuitem', { name: `Create “${name}”` })
      ).toBeVisible()
      expect(await shownLabels()).toEqual(['hr'])
    }
  )

  it('takes back why a name cannot be a label once the name changes', async () => {
    const { pagesApi, wiki, onboarding } = await onboardingLabelled(['hr'])
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}`, { pagesApi })

    const dialog = await openLabels()
    typeIn(dialog, 'Search labels', 'how to')
    fireEvent.click(
      within(dialog).getByRole('menuitem', { name: 'Create “how to”' })
    )
    await within(dialog).findByRole('alert')
    typeIn(dialog, 'Search labels', 'how-to')

    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says that a page carries at most 50 labels, without saving a 51st', async () => {
    const names = Array.from(
      { length: 50 },
      (_, index) => `label-${String(index + 1).padStart(2, '0')}`
    )
    const { pagesApi, wiki, onboarding } = await onboardingLabelled(names)
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}`, { pagesApi })

    const dialog = await openLabels()
    typeIn(dialog, 'Search labels', 'release')
    fireEvent.click(
      within(dialog).getByRole('menuitem', { name: 'Create “release”' })
    )

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'A page carries at most 50 labels.'
    )
    expect(pagesApi.setLabels).not.toHaveBeenCalledWith(
      onboarding.id,
      expect.arrayContaining(['release'])
    )
  })

  it('says when the labels could not be saved, and shows those the page carries', async () => {
    const { pagesApi, wiki, onboarding } = await handbookWithHowTo()
    pagesApi.setLabels.mockRejectedValueOnce(new ApiError(500, null))
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}`, { pagesApi })

    const picker = within(await openLabels())
    fireEvent.click(
      await picker.findByRole('menuitemcheckbox', { name: 'howto' })
    )

    expect(await picker.findByRole('alert')).toHaveTextContent(
      'The labels could not be saved.'
    )
    expect(
      picker.getByRole('menuitemcheckbox', { name: 'howto' })
    ).not.toBeChecked()
  })

  it('keeps saying the labels could not be saved as the person searches', async () => {
    const { pagesApi, wiki, onboarding } = await handbookWithHowTo()
    pagesApi.setLabels.mockRejectedValueOnce(new ApiError(500, null))
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}`, { pagesApi })

    const dialog = await openLabels()
    fireEvent.click(
      await within(dialog).findByRole('menuitemcheckbox', { name: 'howto' })
    )
    await within(dialog).findByRole('alert')
    typeIn(dialog, 'Search labels', 'how')

    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'The labels could not be saved.'
    )
  })

  it('says when the labels of the wiki could not be loaded, and loads them again', async () => {
    const { pagesApi, wiki, onboarding } = await handbookWithHowTo()
    pagesApi.listLabels.mockRejectedValueOnce(new ApiError(403, null))
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}`, { pagesApi })

    const picker = within(await openLabels())
    expect(await picker.findByRole('alert')).toHaveTextContent(
      'The labels of the wiki could not be loaded.'
    )
    fireEvent.click(picker.getByRole('button', { name: 'Retry' }))

    expect(
      await picker.findByRole('menuitemcheckbox', { name: 'howto' })
    ).toBeVisible()
    expect(picker.queryByRole('alert')).not.toBeInTheDocument()
  })
})
