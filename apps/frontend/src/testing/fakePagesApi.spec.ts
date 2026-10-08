import { describe, expect, it } from 'vitest'

import { ApiError } from '@/application/pages'
import { fakePagesApi } from '@/testing/fakePagesApi'

describe('fakePagesApi', () => {
  describe('wikis', () => {
    it("makes the person's personal wiki on the first list", async () => {
      const api = fakePagesApi()

      const wikis = await api.listWikis()

      expect(wikis).toMatchObject([
        { name: 'Personal', kind: 'personal', role: 'admin', unread: 0 }
      ])
      await expect(api.listWikis()).resolves.toEqual(wikis)
    })

    it('lists the personal wiki first, then the others by name', async () => {
      const api = fakePagesApi()
      api.withWiki({ name: 'Onboarding' })
      api.withWiki({ name: 'Handbook', role: 'viewer' })

      const wikis = await api.listWikis()

      expect(wikis.map(wiki => [wiki.name, wiki.role])).toEqual([
        ['Personal', 'admin'],
        ['Handbook', 'viewer'],
        ['Onboarding', 'admin']
      ])
    })

    it('makes a shared wiki with the person as admin and an empty tree', async () => {
      const api = fakePagesApi()

      const wiki = await api.createWiki({ name: ' Engineering ' })

      expect(wiki).toMatchObject({
        name: 'Engineering',
        description: '',
        kind: 'shared',
        role: 'admin'
      })
      await expect(api.getTree(wiki.id)).resolves.toEqual({
        version: wiki.version,
        pages: []
      })
    })

    it('hides a wiki from people who are no members', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()

      await expect(
        api.signedInAs('bob@example.com').getWiki(wiki.id)
      ).rejects.toEqual(new ApiError(404, 'not_found'))
    })

    it('refuses what the role does not allow', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({ role: 'editor' })

      await expect(api.renameWiki(wiki.id, { name: 'Guide' })).rejects.toEqual(
        new ApiError(403, 'forbidden')
      )
    })

    it('leaves the name of a space wiki and the personal wiki alone', async () => {
      const api = fakePagesApi()
      const space = api.withWiki({ kind: 'space' })
      const personal = api.withWiki({ kind: 'personal' })

      await expect(api.renameWiki(space.id, { name: 'Guide' })).rejects.toEqual(
        new ApiError(409, 'managed')
      )
      await expect(api.deleteWiki(personal.id)).rejects.toEqual(
        new ApiError(409, 'managed')
      )
      await expect(
        api.renameWiki(space.id, { description: 'Our space' })
      ).resolves.toMatchObject({ description: 'Our space' })
    })

    it('lists the live pages of the tree, its home page aside', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const onboarding = api.withPage(wiki.id, { title: 'Onboarding' })
      const laptop = api.withPage(wiki.id, {
        title: 'Laptop',
        parentId: onboarding.id
      })
      const faq = api.withPage(wiki.id, { title: 'FAQ' })

      const tree = await api.getTree(wiki.id)

      expect(tree.pages.map(page => [page.title, page.parentId])).toEqual([
        ['Onboarding', null],
        ['Laptop', onboarding.id],
        ['FAQ', null]
      ])
      expect(tree.pages.map(page => page.id)).not.toContain(wiki.homePageId)
      expect(laptop.parentId).toBe(onboarding.id)
      expect(faq.parentId).toBeNull()
    })

    it("calls back with the wiki's version now, then on each change", async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const versions: number[] = []

      const stop = api.watchWiki(wiki.id, version => versions.push(version))
      await api.renameWiki(wiki.id, { name: 'Guide' })
      stop()
      await api.renameWiki(wiki.id, { name: 'Manual' })

      expect(versions).toEqual([wiki.version, wiki.version + 1])
    })
  })
})
