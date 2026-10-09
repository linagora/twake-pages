import { expect, test } from '@playwright/test'
import { publishText } from './editor.ts'
import { pageEvents } from './platform.ts'
import { aliceSpaceWiki } from './space.ts'

test('puts page.published on the activity exchange, with the wiki as container, for a page published in a space wiki', async ({
  page
}) => {
  const { wikiId, name } = await aliceSpaceWiki(page)
  await page
    .getByRole('list', { name: 'Wikis' })
    .getByText(name, { exact: true })
    .click()
  // The editor of the home page is at /wikis/<wiki>/pages/<page>/edit.
  const edit = page.getByRole('link', { name: 'Edit page' })
  const pageId = (await edit.getAttribute('href'))?.split('/').at(-2) ?? ''

  await publishText(page, 'Sprint goals')

  await expect(() => {
    expect(pageEvents('published', pageId)).toEqual([
      expect.objectContaining({
        data: {
          object: {
            type: 'page',
            id: pageId,
            title: name,
            container: { kind: 'wiki', id: wikiId }
          },
          version: 2,
          preview: 'Sprint goals'
        }
      })
    ])
  }).toPass({ timeout: 15_000 })
})
