import { describe, expect, it } from 'vitest'

import { ApiError, EditConflict } from '@/application/pages'
import { buildTree, type TreeNode } from '@/domain/tree'
import {
  fakePagesApi,
  GRIST_ORIGIN,
  paragraph,
  type FakePagesApi
} from '@/testing/fakePagesApi'

type Outline = (string | Outline)[]

// Titles in tree order, each page's children in a list after it.
const outline = (nodes: TreeNode[]): Outline =>
  nodes.flatMap(node =>
    node.children.length > 0
      ? [node.title, outline(node.children)]
      : [node.title]
  )

async function outlineOf(api: FakePagesApi, wikiId: string) {
  return outline(buildTree((await api.getTree(wikiId)).pages))
}

async function badgesOf(api: FakePagesApi) {
  const badges = await api.badges()
  return Object.fromEntries(badges.map(badge => [badge.wikiId, badge.count]))
}

const nothing = { notifications: [], unread: 0 }

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

  describe('sharing', () => {
    it('shows the members to every member, and the invitations to admins', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({ members: { 'bob@example.com': 'viewer' } })
      await api.invite(wiki.id, 'carol@example.com', 'editor')

      const sharing = await api.getMembers(wiki.id)

      expect(
        sharing.members.map(member => [member.email, member.role])
      ).toEqual([
        ['alice@example.com', 'admin'],
        ['bob@example.com', 'viewer']
      ])
      expect(sharing.invites).toMatchObject([
        { email: 'carol@example.com', role: 'editor' }
      ])
      expect(sharing.managed).toBe(false)
      await expect(
        api.signedInAs('bob@example.com').getMembers(wiki.id)
      ).resolves.toMatchObject({ invites: [] })
    })

    it('makes an invitation a membership when its email signs in', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({ name: 'Engineering' })
      await api.invite(wiki.id, 'Carol@Example.com', 'editor')

      const carol = api.signedInAs('carol@example.com', 'Carol Diaz')

      await expect(carol.listWikis()).resolves.toContainEqual(
        expect.objectContaining({ name: 'Engineering', role: 'editor' })
      )
      await expect(api.getMembers(wiki.id)).resolves.toMatchObject({
        members: [
          { email: 'alice@example.com' },
          { email: 'carol@example.com', name: 'Carol Diaz', role: 'editor' }
        ],
        invites: []
      })
    })

    it('never leaves a shared wiki without an admin', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({ members: { 'bob@example.com': 'editor' } })
      const lastAdmin = new ApiError(409, 'last_admin')

      await expect(
        api.setMemberRole(wiki.id, api.person.id, 'editor')
      ).rejects.toEqual(lastAdmin)
      await expect(api.removeMember(wiki.id, api.person.id)).rejects.toEqual(
        lastAdmin
      )
    })

    it('lets a member leave, and only an admin remove someone else', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({
        members: { 'bob@example.com': 'editor', 'carol@example.com': 'viewer' }
      })
      const bob = api.signedInAs('bob@example.com')
      const carol = api.signedInAs('carol@example.com')

      await expect(bob.removeMember(wiki.id, carol.person.id)).rejects.toEqual(
        new ApiError(403, 'forbidden')
      )
      await bob.removeMember(wiki.id, bob.person.id)

      await expect(bob.getWiki(wiki.id)).rejects.toEqual(
        new ApiError(404, 'not_found')
      )
    })

    it('leaves the members of a personal or space wiki alone', async () => {
      const api = fakePagesApi()
      const space = api.withWiki({ kind: 'space' })
      const personal = api.withWiki({ kind: 'personal' })

      await expect(
        api.invite(space.id, 'bob@example.com', 'viewer')
      ).rejects.toEqual(new ApiError(409, 'managed'))
      await expect(api.getMembers(personal.id)).resolves.toMatchObject({
        managed: true
      })
    })

    it('finds people of the organization by name or email', async () => {
      const api = fakePagesApi()
      api.signedInAs('bob@example.com', 'Bob Stone')
      api.signedInAs('carol@example.com', 'Carol Diaz')

      await expect(api.searchPeople('STO')).resolves.toEqual([
        { email: 'bob@example.com', name: 'Bob Stone' }
      ])
      await expect(api.searchPeople('carol@')).resolves.toEqual([
        { email: 'carol@example.com', name: 'Carol Diaz' }
      ])
    })
  })

  describe('pages', () => {
    it('makes a page at version 1, followed by its author', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()

      const page = await api.createPage(wiki.id, {
        title: ' Onboarding ',
        kind: 'document',
        parentId: null,
        content: [paragraph('Welcome')]
      })

      expect(page).toMatchObject({
        wikiId: wiki.id,
        parentId: null,
        home: false,
        title: 'Onboarding',
        content: [paragraph('Welcome')],
        gristUrl: null,
        version: 1,
        createdBy: api.person,
        updatedBy: api.person,
        labels: [],
        ancestors: [],
        following: true,
        favorite: false,
        deletedAt: null
      })
      await expect(api.getPage(page.id)).resolves.toEqual(page)
    })

    it('places a page after or before a sibling, by fractional keys', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const a = api.withPage(wiki.id, { title: 'A' })
      api.withPage(wiki.id, { title: 'B' })
      const at = (afterId?: string, beforeId?: string) => ({
        kind: 'document' as const,
        parentId: null,
        ...(afterId && { afterId }),
        ...(beforeId && { beforeId })
      })

      await api.createPage(wiki.id, { title: 'C', ...at(a.id) })
      await api.createPage(wiki.id, { title: 'D', ...at(undefined, a.id) })

      const { pages } = await api.getTree(wiki.id)
      const titles = pages
        .toSorted((x, y) => (x.position < y.position ? -1 : 1))
        .map(page => page.title)
      expect(titles).toEqual(['D', 'A', 'C', 'B'])
    })

    it('refuses neighbours that are not next to each other under the parent', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const a = api.withPage(wiki.id, { title: 'A' })
      api.withPage(wiki.id, { title: 'B' })
      const c = api.withPage(wiki.id, { title: 'C' })
      const child = api.withPage(wiki.id, { title: 'Child', parentId: a.id })
      const page = { title: 'New', kind: 'document' as const, parentId: null }
      const stale = new ApiError(409, 'stale_neighbours')

      await expect(
        api.createPage(wiki.id, { ...page, afterId: child.id })
      ).rejects.toEqual(stale)
      await expect(
        api.createPage(wiki.id, { ...page, afterId: a.id, beforeId: c.id })
      ).rejects.toEqual(stale)
    })

    it('needs a live page of the wiki as parent, other than its home page', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const other = api.withPage(api.withWiki().id)
      const page = { title: 'New', kind: 'document' as const }
      const invalidParent = new ApiError(400, 'invalid_parent')

      await expect(
        api.createPage(wiki.id, { ...page, parentId: wiki.homePageId })
      ).rejects.toEqual(invalidParent)
      await expect(
        api.createPage(wiki.id, { ...page, parentId: other.id })
      ).rejects.toEqual(invalidParent)
    })

    it('frames a database from an address on a Grist origin', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const database = {
        title: 'Budget',
        kind: 'database' as const,
        parentId: null
      }

      await expect(
        api.createPage(wiki.id, {
          ...database,
          gristUrl: `${GRIST_ORIGIN}/o/docs/budget`
        })
      ).resolves.toMatchObject({
        content: [],
        gristUrl: `${GRIST_ORIGIN}/o/docs/budget`
      })
      await expect(
        api.createPage(wiki.id, {
          ...database,
          gristUrl: 'https://evil.example.com/o/docs/budget'
        })
      ).rejects.toEqual(new ApiError(400, 'invalid_grist_url'))
    })

    it('lists the ancestors of a page, from the top of the tree', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const onboarding = api.withPage(wiki.id, { title: 'Onboarding' })
      const laptop = api.withPage(wiki.id, {
        title: 'Laptop',
        parentId: onboarding.id
      })
      const setup = api.withPage(wiki.id, {
        title: 'Setup',
        parentId: laptop.id
      })

      await expect(api.getPage(setup.id)).resolves.toMatchObject({
        ancestors: [
          { id: onboarding.id, title: 'Onboarding' },
          { id: laptop.id, title: 'Laptop' }
        ]
      })
    })

    it('publishes a new version, followed by its author', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({ members: { 'bob@example.com': 'editor' } })
      const page = api.withPage(wiki.id, { title: 'Onboarding' })
      const bob = api.signedInAs('bob@example.com', 'Bob Stone')

      const published = await bob.publish(page.id, {
        baseVersion: 1,
        title: 'Onboarding guide',
        content: [paragraph('Welcome aboard')]
      })

      expect(published).toMatchObject({
        title: 'Onboarding guide',
        content: [paragraph('Welcome aboard')],
        version: 2,
        createdBy: api.person,
        updatedBy: bob.person,
        following: true
      })
    })

    it('refuses to publish over a newer version, telling the current one', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({ members: { 'bob@example.com': 'editor' } })
      const page = api.withPage(wiki.id, { title: 'Onboarding' })
      const draft = { baseVersion: 1, title: 'Onboarding', content: [] }
      await api.signedInAs('bob@example.com').publish(page.id, draft)

      const publishing = api.publish(page.id, draft)

      await expect(publishing).rejects.toBeInstanceOf(EditConflict)
      await expect(publishing).rejects.toMatchObject({
        status: 409,
        current: { number: 2, author: { email: 'bob@example.com' } }
      })
    })

    it('keeps every version, and restores one as a new version', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const page = api.withPage(wiki.id, {
        title: 'Onboarding',
        content: [paragraph('First')]
      })
      await api.publish(page.id, {
        baseVersion: 1,
        title: 'Onboarding guide',
        content: [paragraph('Second')]
      })

      const restored = await api.restoreVersion(page.id, 1)

      expect(restored).toMatchObject({
        title: 'Onboarding',
        content: [paragraph('First')],
        version: 3
      })
      const versions = await api.listVersions(page.id)
      expect(versions.map(each => [each.number, each.restoredFrom])).toEqual([
        [3, 1],
        [2, null],
        [1, null]
      ])
      await expect(api.getVersion(page.id, 2)).resolves.toMatchObject({
        title: 'Onboarding guide',
        content: [paragraph('Second')]
      })
    })

    it('lets viewers read pages, and only editors write them', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({ role: 'viewer' })
      const page = api.withPage(wiki.id, { title: 'Onboarding' })
      const forbidden = new ApiError(403, 'forbidden')

      await expect(api.getPage(page.id)).resolves.toMatchObject({
        title: 'Onboarding'
      })
      await expect(
        api.createPage(wiki.id, {
          title: 'New',
          kind: 'document',
          parentId: null
        })
      ).rejects.toEqual(forbidden)
      await expect(
        api.publish(page.id, { baseVersion: 1, title: 'New', content: [] })
      ).rejects.toEqual(forbidden)
      await expect(api.movePage(page.id, { parentId: null })).rejects.toEqual(
        forbidden
      )
      await expect(api.deletePage(page.id)).rejects.toEqual(forbidden)
      await expect(api.setLabels(page.id, ['howto'])).rejects.toEqual(forbidden)
    })
  })

  describe('moving', () => {
    it('moves a page under another parent, between two of its children', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const onboarding = api.withPage(wiki.id, { title: 'Onboarding' })
      const laptop = api.withPage(wiki.id, {
        title: 'Laptop',
        parentId: onboarding.id
      })
      api.withPage(wiki.id, { title: 'Badge', parentId: onboarding.id })
      const faq = api.withPage(wiki.id, { title: 'FAQ' })

      const placement = await api.movePage(faq.id, {
        parentId: onboarding.id,
        afterId: laptop.id
      })

      await expect(outlineOf(api, wiki.id)).resolves.toEqual([
        'Onboarding',
        ['Laptop', 'FAQ', 'Badge']
      ])
      const { pages } = await api.getTree(wiki.id)
      expect(pages.find(page => page.id === faq.id)).toMatchObject(placement)
      await expect(api.getPage(faq.id)).resolves.toMatchObject({
        ancestors: [{ id: onboarding.id, title: 'Onboarding' }]
      })
    })

    it('moves a page among its siblings, the neighbours seen without it', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const a = api.withPage(wiki.id, { title: 'A' })
      const b = api.withPage(wiki.id, { title: 'B' })
      const c = api.withPage(wiki.id, { title: 'C' })
      const d = api.withPage(wiki.id, { title: 'D' })

      await api.movePage(b.id, {
        parentId: null,
        afterId: c.id,
        beforeId: d.id
      })
      await expect(outlineOf(api, wiki.id)).resolves.toEqual([
        'A',
        'C',
        'B',
        'D'
      ])
      await api.movePage(b.id, {
        parentId: null,
        afterId: a.id,
        beforeId: c.id
      })
      await expect(outlineOf(api, wiki.id)).resolves.toEqual([
        'A',
        'B',
        'C',
        'D'
      ])
      await api.movePage(a.id, { parentId: null })
      await expect(outlineOf(api, wiki.id)).resolves.toEqual([
        'B',
        'C',
        'D',
        'A'
      ])
    })

    it('never moves the home page, nor a page under itself', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const onboarding = api.withPage(wiki.id, { title: 'Onboarding' })
      const laptop = api.withPage(wiki.id, {
        title: 'Laptop',
        parentId: onboarding.id
      })
      const invalidParent = new ApiError(400, 'invalid_parent')

      await expect(
        api.movePage(wiki.homePageId, { parentId: onboarding.id })
      ).rejects.toEqual(new ApiError(409, 'home_page'))
      await expect(
        api.movePage(onboarding.id, { parentId: onboarding.id })
      ).rejects.toEqual(invalidParent)
      await expect(
        api.movePage(onboarding.id, { parentId: laptop.id })
      ).rejects.toEqual(invalidParent)
    })
  })

  describe('following and favorites', () => {
    it('lets a member follow a page, and stop following it', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({ members: { 'bob@example.com': 'viewer' } })
      const page = api.withPage(wiki.id)
      const bob = api.signedInAs('bob@example.com')

      await bob.setFollowing(page.id, true)
      await api.setFollowing(page.id, false)

      await expect(bob.getPage(page.id)).resolves.toMatchObject({
        following: true
      })
      await expect(api.getPage(page.id)).resolves.toMatchObject({
        following: false
      })
    })

    it("marks a page as one of the person's favorites", async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({ members: { 'bob@example.com': 'viewer' } })
      const page = api.withPage(wiki.id)
      const bob = api.signedInAs('bob@example.com')

      await api.setFavorite(page.id, true)
      await bob.setFavorite(page.id, true)
      await bob.setFavorite(page.id, false)

      await expect(api.getPage(page.id)).resolves.toMatchObject({
        favorite: true
      })
      await expect(bob.getPage(page.id)).resolves.toMatchObject({
        favorite: false
      })
    })
  })

  describe('trash', () => {
    it('puts a page and its live descendants in the trash, as one branch', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const onboarding = api.withPage(wiki.id, { title: 'Onboarding' })
      const laptop = api.withPage(wiki.id, {
        title: 'Laptop',
        parentId: onboarding.id
      })
      api.withPage(wiki.id, { title: 'Setup', parentId: laptop.id })
      api.withPage(wiki.id, { title: 'FAQ' })

      await api.deletePage(onboarding.id)

      await expect(outlineOf(api, wiki.id)).resolves.toEqual(['FAQ'])
      await expect(api.listTrash(wiki.id)).resolves.toMatchObject([
        {
          id: onboarding.id,
          title: 'Onboarding',
          deletedBy: api.person,
          descendants: 2
        }
      ])
      const deleted = await api.getPage(laptop.id)
      expect(deleted.deletedAt).not.toBeNull()
    })

    it('lists the deleted branches newest first, each with its own pages', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const onboarding = api.withPage(wiki.id, { title: 'Onboarding' })
      const laptop = api.withPage(wiki.id, {
        title: 'Laptop',
        parentId: onboarding.id
      })
      api.withPage(wiki.id, { title: 'Setup', parentId: laptop.id })

      await api.deletePage(laptop.id)
      await api.deletePage(onboarding.id)

      const trash = await api.listTrash(wiki.id)
      expect(trash.map(entry => [entry.title, entry.descendants])).toEqual([
        ['Onboarding', 0],
        ['Laptop', 1]
      ])
    })

    it('restores a branch last under its parent while it is live, else at the top', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const onboarding = api.withPage(wiki.id, { title: 'Onboarding' })
      const laptop = api.withPage(wiki.id, {
        title: 'Laptop',
        parentId: onboarding.id
      })
      api.withPage(wiki.id, { title: 'Setup', parentId: laptop.id })
      api.withPage(wiki.id, { title: 'Badge', parentId: onboarding.id })
      api.withPage(wiki.id, { title: 'FAQ' })

      await api.deletePage(laptop.id)
      await expect(api.restorePage(laptop.id)).resolves.toMatchObject({
        parentId: onboarding.id
      })
      await expect(outlineOf(api, wiki.id)).resolves.toEqual([
        'Onboarding',
        ['Badge', 'Laptop', ['Setup']],
        'FAQ'
      ])

      await api.deletePage(laptop.id)
      await api.deletePage(onboarding.id)
      await expect(api.restorePage(laptop.id)).resolves.toMatchObject({
        parentId: null
      })
      await expect(outlineOf(api, wiki.id)).resolves.toEqual([
        'FAQ',
        'Laptop',
        ['Setup']
      ])
      await expect(api.listTrash(wiki.id)).resolves.toMatchObject([
        { title: 'Onboarding', descendants: 1 }
      ])
    })

    it('restores and purges only the root of a deleted branch', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const onboarding = api.withPage(wiki.id, { title: 'Onboarding' })
      const laptop = api.withPage(wiki.id, {
        title: 'Laptop',
        parentId: onboarding.id
      })
      const faq = api.withPage(wiki.id, { title: 'FAQ' })
      const notInTrash = new ApiError(409, 'not_in_trash')
      await api.deletePage(onboarding.id)

      await expect(api.restorePage(laptop.id)).rejects.toEqual(notInTrash)
      await expect(api.restorePage(faq.id)).rejects.toEqual(notInTrash)
      await expect(api.purgePage(wiki.id, laptop.id)).rejects.toEqual(
        notInTrash
      )
    })

    it('lets admins delete branches for good', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({ members: { 'bob@example.com': 'editor' } })
      const onboarding = api.withPage(wiki.id, { title: 'Onboarding' })
      const laptop = api.withPage(wiki.id, {
        title: 'Laptop',
        parentId: onboarding.id
      })
      const faq = api.withPage(wiki.id, { title: 'FAQ' })
      await api.deletePage(onboarding.id)
      await api.deletePage(faq.id)

      await expect(
        api.signedInAs('bob@example.com').purgePage(wiki.id, onboarding.id)
      ).rejects.toEqual(new ApiError(403, 'forbidden'))
      await api.purgePage(wiki.id, onboarding.id)

      await expect(api.listTrash(wiki.id)).resolves.toMatchObject([
        { title: 'FAQ' }
      ])
      await expect(api.getPage(laptop.id)).rejects.toEqual(
        new ApiError(404, 'not_found')
      )
      await api.emptyTrash(wiki.id)
      await expect(api.listTrash(wiki.id)).resolves.toEqual([])
    })

    it('never deletes the home page', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()

      await expect(api.deletePage(wiki.homePageId)).rejects.toEqual(
        new ApiError(409, 'home_page')
      )
    })

    it('leaves the pages in the trash as they are', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const onboarding = api.withPage(wiki.id, { title: 'Onboarding' })
      await api.deletePage(onboarding.id)
      const inTrash = new ApiError(409, 'in_trash')

      await expect(
        api.publish(onboarding.id, {
          baseVersion: 1,
          title: 'New',
          content: []
        })
      ).rejects.toEqual(inTrash)
      await expect(api.restoreVersion(onboarding.id, 1)).rejects.toEqual(
        inTrash
      )
      await expect(
        api.movePage(onboarding.id, { parentId: null })
      ).rejects.toEqual(inTrash)
      await expect(api.deletePage(onboarding.id)).rejects.toEqual(inTrash)
      await expect(api.setLabels(onboarding.id, ['howto'])).rejects.toEqual(
        inTrash
      )
      await expect(
        api.addComment(onboarding.id, { body: 'Hello' })
      ).rejects.toEqual(inTrash)
      await expect(
        api.createPage(wiki.id, {
          title: 'Laptop',
          kind: 'document',
          parentId: onboarding.id
        })
      ).rejects.toEqual(new ApiError(400, 'invalid_parent'))
    })
  })

  describe('labels', () => {
    it('labels a page with trimmed, lowercased names, sorted', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const page = api.withPage(wiki.id)

      const labels = await api.setLabels(page.id, [
        ' Laptop ',
        'HowTo',
        'howto',
        'équipe_2'
      ])

      expect(labels).toEqual(['équipe_2', 'howto', 'laptop'])
      await expect(api.getPage(page.id)).resolves.toMatchObject({ labels })
    })

    it('refuses names other than 1 to 50 letters, digits, - and _', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const page = api.withPage(wiki.id)
      const invalidLabel = new ApiError(400, 'invalid_label')

      await expect(api.setLabels(page.id, ['how to'])).rejects.toEqual(
        invalidLabel
      )
      await expect(api.setLabels(page.id, [' '])).rejects.toEqual(invalidLabel)
      await expect(api.setLabels(page.id, ['a'.repeat(51)])).rejects.toEqual(
        invalidLabel
      )
    })

    it('lists the labels of a wiki and their live pages', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const setup = api.withPage(wiki.id, { title: 'Setup' })
      const badge = api.withPage(wiki.id, { title: 'Badge' })
      const faq = api.withPage(wiki.id, { title: 'FAQ' })
      await api.setLabels(setup.id, ['howto', 'laptop'])
      await api.setLabels(badge.id, ['howto'])
      await api.setLabels(faq.id, ['howto'])
      await api.deletePage(faq.id)

      await expect(api.listLabels(wiki.id)).resolves.toEqual([
        { name: 'howto', pages: 2 },
        { name: 'laptop', pages: 1 }
      ])
      const pages = await api.pagesWithLabel(wiki.id, 'howto')
      expect(pages.map(page => page.title)).toEqual(['Badge', 'Setup'])
    })

    it('forgets a label no page uses any more', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const page = api.withPage(wiki.id)
      await api.setLabels(page.id, ['howto'])

      await api.setLabels(page.id, [])

      await expect(api.listLabels(wiki.id)).resolves.toEqual([])
      await expect(api.pagesWithLabel(wiki.id, 'howto')).rejects.toEqual(
        new ApiError(404, 'not_found')
      )
    })
  })

  describe('comments', () => {
    it('lists the comments of a page oldest first, replies among them', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({ members: { 'bob@example.com': 'viewer' } })
      const page = api.withPage(wiki.id)
      const bob = api.signedInAs('bob@example.com', 'Bob Stone')

      const question = await bob.addComment(page.id, {
        body: ' Where is the VPN guide? '
      })
      await api.addComment(page.id, {
        body: 'Under Laptop.',
        parentId: question.id
      })
      await bob.addComment(page.id, { body: 'Thanks!' })

      const comments = await api.listComments(page.id)
      expect(
        comments.map(each => [each.body, each.parentId, each.author.email])
      ).toEqual([
        ['Where is the VPN guide?', null, 'bob@example.com'],
        ['Under Laptop.', question.id, 'alice@example.com'],
        ['Thanks!', null, 'bob@example.com']
      ])
    })

    it('answers comments one level deep, on their page', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const page = api.withPage(wiki.id)
      const other = api.withPage(wiki.id)
      const question = await api.addComment(page.id, { body: 'Question' })
      const reply = await api.addComment(page.id, {
        body: 'Answer',
        parentId: question.id
      })
      const invalid = new ApiError(400, 'invalid_request')

      await expect(
        api.addComment(page.id, { body: 'Reply', parentId: reply.id })
      ).rejects.toEqual(invalid)
      await expect(
        api.addComment(other.id, { body: 'Reply', parentId: question.id })
      ).rejects.toEqual(invalid)
      await expect(api.addComment(page.id, { body: '  ' })).rejects.toEqual(
        invalid
      )
    })

    it('makes its author and the members it mentions follow the page', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({
        members: { 'bob@example.com': 'viewer', 'carol@example.com': 'viewer' }
      })
      const page = api.withPage(wiki.id)
      const bob = api.signedInAs('bob@example.com')
      const carol = api.signedInAs('carol@example.com')

      await bob.addComment(page.id, {
        body: 'Ask @Carol@example.com or @dan@example.com'
      })

      await expect(bob.getPage(page.id)).resolves.toMatchObject({
        following: true
      })
      await expect(carol.getPage(page.id)).resolves.toMatchObject({
        following: true
      })
    })

    it('lets only its author edit a comment', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({ members: { 'bob@example.com': 'editor' } })
      const page = api.withPage(wiki.id)
      const comment = await api.addComment(page.id, { body: 'Draft' })

      await expect(
        api.signedInAs('bob@example.com').editComment(comment.id, 'Mine')
      ).rejects.toEqual(new ApiError(403, 'forbidden'))
      const edited = await api.editComment(comment.id, ' Final ')

      expect(edited).toMatchObject({ id: comment.id, body: 'Final' })
      expect(edited.editedAt).not.toBeNull()
    })

    it('deletes a comment with its replies, for its author or an admin', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({
        members: { 'bob@example.com': 'editor', 'carol@example.com': 'viewer' }
      })
      const page = api.withPage(wiki.id)
      const bob = api.signedInAs('bob@example.com')
      const question = await bob.addComment(page.id, { body: 'Question' })
      await api.addComment(page.id, { body: 'Answer', parentId: question.id })
      const remark = await bob.addComment(page.id, { body: 'Remark' })

      await expect(
        api.signedInAs('carol@example.com').deleteComment(remark.id)
      ).rejects.toEqual(new ApiError(403, 'forbidden'))
      await bob.deleteComment(remark.id)
      await api.deleteComment(question.id)

      await expect(api.listComments(page.id)).resolves.toEqual([])
    })
  })

  describe('notifications', () => {
    it('tells the followers of a page about its new versions, restores too', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({
        name: 'Handbook',
        members: { 'bob@example.com': 'editor', 'carol@example.com': 'viewer' }
      })
      const page = api.withPage(wiki.id, { title: 'Onboarding' })
      const bob = api.signedInAs('bob@example.com', 'Bob Stone')
      const carol = api.signedInAs('carol@example.com')

      await bob.publish(page.id, {
        baseVersion: 1,
        title: 'Onboarding',
        content: []
      })
      await api.restoreVersion(page.id, 1)

      await expect(api.listNotifications()).resolves.toMatchObject({
        notifications: [
          {
            reason: 'published',
            page: { id: page.id, title: 'Onboarding' },
            wiki: { id: wiki.id, name: 'Handbook' },
            actor: { email: 'bob@example.com', name: 'Bob Stone' },
            version: 2,
            commentId: null,
            readAt: null
          }
        ],
        unread: 1
      })
      await expect(bob.listNotifications()).resolves.toMatchObject({
        notifications: [{ reason: 'published', version: 3 }]
      })
      await expect(carol.listNotifications()).resolves.toEqual(nothing)
    })

    it('tells the members a comment mentions, and the other followers', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({
        members: { 'bob@example.com': 'viewer', 'carol@example.com': 'viewer' }
      })
      const page = api.withPage(wiki.id)
      const bob = api.signedInAs('bob@example.com')
      const carol = api.signedInAs('carol@example.com')
      const dan = api.signedInAs('dan@example.com')
      await bob.setFollowing(page.id, true)

      const comment = await carol.addComment(page.id, {
        body: '@bob@example.com, see @dan@example.com'
      })

      await expect(api.listNotifications()).resolves.toMatchObject({
        notifications: [
          {
            reason: 'commented',
            commentId: comment.id,
            actor: { email: 'carol@example.com' }
          }
        ]
      })
      await expect(bob.listNotifications()).resolves.toMatchObject({
        notifications: [{ reason: 'mentioned', commentId: comment.id }]
      })
      await expect(carol.listNotifications()).resolves.toEqual(nothing)
      await expect(dan.listNotifications()).resolves.toEqual(nothing)
    })

    it('stops telling people who are no longer members', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({ members: { 'bob@example.com': 'editor' } })
      const page = api.withPage(wiki.id)
      const bob = api.signedInAs('bob@example.com')
      await bob.setFollowing(page.id, true)
      await api.removeMember(wiki.id, bob.person.id)

      await api.publish(page.id, { baseVersion: 1, title: 'New', content: [] })

      await expect(bob.listNotifications()).resolves.toEqual(nothing)
    })

    it('forgets the notifications about deleted comments and left wikis', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({ members: { 'bob@example.com': 'editor' } })
      const page = api.withPage(wiki.id)
      const bob = api.signedInAs('bob@example.com')
      await bob.setFollowing(page.id, true)
      const comment = await api.addComment(page.id, { body: 'Draft ready' })
      await api.publish(page.id, { baseVersion: 1, title: 'New', content: [] })

      await api.deleteComment(comment.id)

      await expect(bob.listNotifications()).resolves.toMatchObject({
        notifications: [{ reason: 'published' }],
        unread: 1
      })
      await bob.removeMember(wiki.id, bob.person.id)
      await expect(bob.listNotifications()).resolves.toEqual(nothing)
      await expect(bob.badges()).resolves.toEqual([])
    })

    it('marks notifications read by id, by wiki or all, counting the unread per wiki', async () => {
      const api = fakePagesApi()
      const members = { 'bob@example.com': 'editor' } as const
      const handbook = api.withWiki({ name: 'Handbook', members })
      const guide = api.withWiki({ name: 'Guide', members })
      const onboarding = api.withPage(handbook.id, { title: 'Onboarding' })
      const setup = api.withPage(guide.id, { title: 'Setup' })
      const bob = api.signedInAs('bob@example.com')
      const draft = { title: 'New', content: [] }
      await bob.publish(onboarding.id, { ...draft, baseVersion: 1 })
      await bob.publish(setup.id, { ...draft, baseVersion: 1 })
      await bob.publish(onboarding.id, { ...draft, baseVersion: 2 })
      const { notifications } = await api.listNotifications()
      const latest = notifications.filter(each => each.version === 3)

      await api.markRead({ ids: latest.map(each => each.id) })

      const read = await api.listNotifications()
      expect(read.notifications.map(each => each.readAt === null)).toEqual([
        false,
        true,
        true
      ])
      expect(read.unread).toBe(2)
      expect(await badgesOf(api)).toEqual({ [handbook.id]: 1, [guide.id]: 1 })
      await expect(api.listWikis()).resolves.toContainEqual(
        expect.objectContaining({ id: guide.id, unread: 1 })
      )
      await api.markRead({ wikiId: guide.id })
      expect(await badgesOf(api)).toEqual({ [handbook.id]: 1 })
      await api.markRead({ all: true })
      expect(await badgesOf(api)).toEqual({})
    })

    it('lists the 100 newest notifications, and counts every unread one', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({ members: { 'bob@example.com': 'editor' } })
      const page = api.withPage(wiki.id)
      const bob = api.signedInAs('bob@example.com')
      for (let baseVersion = 1; baseVersion <= 101; baseVersion += 1) {
        await bob.publish(page.id, { baseVersion, title: 'New', content: [] })
      }

      const { notifications, unread } = await api.listNotifications()

      expect(notifications).toHaveLength(100)
      expect(notifications[0]?.version).toBe(102)
      expect(unread).toBe(101)
    })
  })
})
