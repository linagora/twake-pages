import { fakePagesApi } from '@/testing/fakePagesApi'
import { renderRoute } from '@/testing/renderWithProviders'

const BOB = 'bob@example.com'

/**
 * The Engineering wiki, open on `open`: Onboarding, with Laptop setup and
 * First week under it, then Releases, with its Checklist. Bob edits it too.
 */
export function engineering(
  open: 'Laptop setup' | 'Onboarding' = 'Laptop setup'
) {
  const pagesApi = fakePagesApi()
  const wiki = pagesApi.withWiki({
    name: 'Engineering',
    members: { [BOB]: 'editor' }
  })
  const onboarding = pagesApi.withPage(wiki.id, { title: 'Onboarding' })
  const laptop = pagesApi.withPage(wiki.id, {
    title: 'Laptop setup',
    parentId: onboarding.id
  })
  pagesApi.withPage(wiki.id, { title: 'First week', parentId: onboarding.id })
  const releases = pagesApi.withPage(wiki.id, { title: 'Releases' })
  const checklist = pagesApi.withPage(wiki.id, {
    title: 'Checklist',
    parentId: releases.id
  })
  const page = open === 'Onboarding' ? onboarding : laptop
  renderRoute(`/wikis/${wiki.id}/pages/${page.id}`, { pagesApi })
  return {
    pagesApi,
    bob: pagesApi.signedInAs(BOB),
    wiki,
    onboarding,
    laptop,
    releases,
    checklist
  }
}
