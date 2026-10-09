import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { fakePagesApi } from '@/testing/fakePagesApi'
import { renderRoute, WIKI_BASES } from '@/testing/renderWithProviders'

/** The Handbook, whose Onboarding page carries these labels. */
async function onboardingLabelled(names: string[]) {
  const pagesApi = fakePagesApi()
  const wiki = pagesApi.withWiki({ name: 'Handbook' })
  const onboarding = pagesApi.withPage(wiki.id, { title: 'Onboarding' })
  await pagesApi.setLabels(onboarding.id, names)
  return { pagesApi, wiki, onboarding }
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
})
