import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb, inTenant } from '../../infra/db.ts'
import {
  aPage,
  aPageIn,
  aUser,
  aWikiOf,
  joinWiki,
  malformedOrUnknownIds,
  pageOf,
  putInTheTrash,
  setLabels,
  someoneOfEachTenant,
  startApp,
  versionOf,
  type TestUser
} from '../../testing/app.ts'
import { labels } from './schema.ts'

let api: Awaited<ReturnType<typeof startApp>>
const { sql, db } = createDb(inject('databaseUrl'))

beforeAll(async () => {
  api = await startApp()
})

afterAll(async () => {
  await api.close()
  await sql.end()
})

// No route shows a label no live page carries, so the names of the wiki's
// labels are read from their table.
const labelNamesIn = async (user: TestUser, wikiId: string) => {
  const rows = await inTenant(db, user, tx =>
    tx
      .select({ name: labels.name })
      .from(labels)
      .where(eq(labels.wikiId, wikiId))
      .orderBy(asc(labels.name))
  )
  return rows.map(({ name }) => name)
}

/** A page labelled through the API, then put in the trash, by its id. */
const aLabelledPageInTheTrash = async (
  user: TestUser,
  wikiId: string,
  names: string[]
) => {
  const pageId = await aPage(api, user, wikiId, { title: 'Drafts' })
  await setLabels(api, user, pageId, names)
  await inTenant(db, user, tx => putInTheTrash(tx, user, pageId))
  return pageId
}

describe('PUT /pages/:pageId/labels', () => {
  it.each(someoneOfEachTenant)(
    'gives the page its labels, trimmed, lowercased and sorted, %s',
    async (_case, someone) => {
      const alice = someone()
      const wiki = await aWikiOf(api, alice)
      const pageId = await aPage(api, alice, wiki.id, { title: 'Onboarding' })

      const response = await setLabels(api, alice, pageId, [
        ' HowTo ',
        'team-a',
        'howto',
        'Draft'
      ])

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        labels: ['draft', 'howto', 'team-a']
      })
      expect((await pageOf(api, alice, pageId)).labels).toEqual([
        'draft',
        'howto',
        'team-a'
      ])
    }
  )

  it.each([
    ['the letters and digits of another alphabet', 'Ångström_2', 'ångström_2'],
    ['the marks written with letters, as in Hindi', 'हिंदी', 'हिंदी'],
    [
      'a capital lowercased to a letter and a mark',
      'İstanbul',
      'i\u0307stanbul'
    ]
  ])('takes %s', async (_case, name, label) => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)

    const response = await setLabels(api, alice, wiki.homePageId, [name])

    expect(response.json()).toEqual({ labels: [label] })
  })

  it('makes one label of an "é" written in one character or in two', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    await setLabels(api, alice, onboarding, ['\u00e9quipe'])

    const response = await setLabels(api, alice, wiki.homePageId, [
      'e\u0301quipe'
    ])

    expect(response.json()).toEqual({ labels: ['\u00e9quipe'] })
    expect(await labelNamesIn(alice, wiki.id)).toEqual(['\u00e9quipe'])
  })

  it('takes off the labels it does not name, and leaves other pages theirs', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    const holidays = await aPage(api, alice, wiki.id, { title: 'Holidays' })
    await setLabels(api, alice, onboarding, ['howto', 'draft'])
    await setLabels(api, alice, holidays, ['howto'])

    const response = await setLabels(api, alice, onboarding, ['hr'])

    expect(response.json()).toEqual({ labels: ['hr'] })
    expect((await pageOf(api, alice, holidays)).labels).toEqual(['howto'])
  })

  it.each(someoneOfEachTenant)(
    'deletes the labels no page carries any more, %s',
    async (_case, someone) => {
      const alice = someone()
      const wiki = await aWikiOf(api, alice)
      const onboarding = await aPage(api, alice, wiki.id, {
        title: 'Onboarding'
      })
      const holidays = await aPage(api, alice, wiki.id, { title: 'Holidays' })
      await setLabels(api, alice, onboarding, ['howto', 'draft'])
      await setLabels(api, alice, holidays, ['howto'])

      await setLabels(api, alice, onboarding, [])

      expect(await labelNamesIn(alice, wiki.id)).toEqual(['howto'])
      expect((await pageOf(api, alice, holidays)).labels).toEqual(['howto'])
    }
  )

  it('keeps a label a page in the trash still carries', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const drafts = await aLabelledPageInTheTrash(alice, wiki.id, ['old'])
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    await setLabels(api, alice, onboarding, ['old'])

    await setLabels(api, alice, onboarding, [])

    expect(await labelNamesIn(alice, wiki.id)).toEqual(['old'])
    expect((await pageOf(api, alice, drafts)).labels).toEqual(['old'])
  })

  it('moves the wiki’s version, so every open page shows the labels live', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const before = await versionOf(api, alice, wiki.id)

    await setLabels(api, alice, wiki.homePageId, ['howto'])

    expect(await versionOf(api, alice, wiki.id)).toBeGreaterThan(before)
  })

  it('answers in_trash for a page in the trash', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const drafts = await aPageIn(db, alice, wiki.id, {
      title: 'Drafts',
      position: 'a0',
      deleted: true
    })
    const before = await versionOf(api, alice, wiki.id)

    const response = await setLabels(api, alice, drafts, ['howto'])

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'in_trash' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('lets an editor of the wiki label a page', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')

    const response = await setLabels(api, bob, wiki.homePageId, ['howto'])

    expect(response.statusCode).toBe(200)
    expect((await pageOf(api, alice, wiki.homePageId)).labels).toEqual([
      'howto'
    ])
  })

  it('answers forbidden to a viewer of the wiki', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'viewer')
    const before = await versionOf(api, alice, wiki.id)

    const response = await setLabels(api, bob, wiki.homePageId, ['howto'])

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'forbidden' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('answers not_found to someone who is no member', async () => {
    const alice = aUser()
    const outsider = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    const before = await versionOf(api, alice, wiki.id)

    const response = await setLabels(api, outsider, wiki.homePageId, ['howto'])

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('answers not_found once the wiki is deleted', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    await api.as(alice).delete(`/wikis/${wiki.id}`)

    const response = await setLabels(api, alice, wiki.homePageId, ['howto'])

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })

  it.each(malformedOrUnknownIds)(
    'answers not_found for a page with %s',
    async (_case, pageId) => {
      const response = await setLabels(api, aUser(), pageId, ['howto'])

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
    }
  )

  it.each([
    ['a blank name', ' '],
    ['a name over 50 characters', 'a'.repeat(51)],
    ['a blank inside a name', 'how to'],
    ['a dot', 'how.to'],
    ['a NUL character', 'how\u0000to'],
    ['a fraction', '½'],
    ['a superscript digit', 'x²'],
    ['a Roman numeral', 'Ⅻ']
  ])('answers invalid_label for %s', async (_case, name) => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const before = await versionOf(api, alice, wiki.id)

    const response = await setLabels(api, alice, wiki.homePageId, [
      'howto',
      name
    ])

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_label' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it.each([
    ['no names', {}],
    ['names that are not text', { names: [1] }],
    [
      'more than 50 names',
      { names: Array.from({ length: 51 }, (_, index) => `n${String(index)}`) }
    ]
  ])('answers invalid_request for %s', async (_case, body) => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const before = await versionOf(api, alice, wiki.id)

    const response = await api
      .as(alice)
      .put(`/pages/${wiki.homePageId}/labels`, body)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_request' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })
})
