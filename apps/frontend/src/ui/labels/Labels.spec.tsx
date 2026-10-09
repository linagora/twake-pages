import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

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
})
