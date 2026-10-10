import { describe, expect, it } from 'vitest'

import { ApiError, EditConflict, type NewPage } from '@/application/pages'
import type { Block } from '@/domain/page'
import { FOUND_END, FOUND_START } from '@/domain/search'
import { buildTree, byPosition, type TreeNode } from '@/domain/tree'
import {
  fakePagesApi,
  GRIST_ORIGIN,
  OFF_GRIST_ORIGINS,
  paragraph,
  type FakePagesApi
} from '@/testing/fakePagesApi'

type TreeTitles = (string | TreeTitles)[]

const treeTitles = (nodes: TreeNode[]): TreeTitles =>
  nodes.flatMap(node =>
    node.children.length > 0
      ? [node.title, treeTitles(node.children)]
      : [node.title]
  )

async function treeOf(api: FakePagesApi, wikiId: string) {
  return treeTitles(buildTree((await api.getTree(wikiId)).pages))
}

async function badgesOf(api: FakePagesApi) {
  const badges = await api.badges()
  return Object.fromEntries(badges.map(badge => [badge.wikiId, badge.count]))
}

const nothing = { notifications: [], unread: 0 }

const found = (word: string) => `${FOUND_START}${word}${FOUND_END}`

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

    it('starts a new wiki at version 0, as the backend does', async () => {
      const api = fakePagesApi()

      const created = await api.createWiki({ name: 'Engineering' })

      expect({
        created: created.version,
        seeded: api.withWiki().version,
        personal: api.withWiki({ kind: 'personal' }).version
      }).toEqual({ created: 0, seeded: 0, personal: 0 })
    })

    it('trims the name of a wiki, and keeps its description as given', async () => {
      const api = fakePagesApi()

      const wiki = await api.createWiki({
        name: ' Engineering ',
        description: ' How we build '
      })
      const changed = await api.renameWiki(wiki.id, {
        description: ' Our way '
      })

      expect({
        name: wiki.name,
        description: wiki.description,
        changed: changed.description
      }).toEqual({
        name: 'Engineering',
        description: ' How we build ',
        changed: ' Our way '
      })
    })

    it('refuses a name or a description with a NUL character or a lone surrogate', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const invalid = new ApiError(400, 'invalid_request')

      await expect(api.createWiki({ name: 'Ops\u0000' })).rejects.toEqual(
        invalid
      )
      await expect(
        api.createWiki({ name: 'Ops', description: 'Runbooks \ud83d' })
      ).rejects.toEqual(invalid)
      await expect(
        api.renameWiki(wiki.id, { name: 'Guide\u0000' })
      ).rejects.toEqual(invalid)
      await expect(
        api.renameWiki(wiki.id, { description: 'Runbooks \ud83d' })
      ).rejects.toEqual(invalid)
    })

    it('keeps the name of a wiki when the description given with it is refused', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({ name: 'Handbook' })

      await expect(
        api.renameWiki(wiki.id, { name: 'Guide', description: 'a'.repeat(501) })
      ).rejects.toEqual(new ApiError(400, 'invalid_request'))

      await expect(api.getWiki(wiki.id)).resolves.toMatchObject({
        name: 'Handbook',
        description: wiki.description,
        version: wiki.version
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
      const spaceWiki = api.withWiki({ kind: 'space' })
      const personal = api.withWiki({ kind: 'personal' })

      await expect(
        api.renameWiki(spaceWiki.id, { name: 'Guide' })
      ).rejects.toEqual(new ApiError(409, 'managed'))
      await expect(api.deleteWiki(personal.id)).rejects.toEqual(
        new ApiError(409, 'managed')
      )
      await expect(
        api.renameWiki(spaceWiki.id, { description: 'Our space' })
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

    it('calls back as the wiki is deleted, for its members to see it go', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const versions: number[] = []
      api.watchWiki(wiki.id, version => versions.push(version))

      await api.deleteWiki(wiki.id)

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

    it('moves the version of the wiki as an invitation becomes a membership, as the backend does', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      await api.invite(wiki.id, 'carol@example.com', 'editor')
      const invited = await api.getWiki(wiki.id)

      await api.signedInAs('carol@example.com').listWikis()

      await expect(api.getWiki(wiki.id)).resolves.toMatchObject({
        version: invited.version + 1
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
      const spaceWiki = api.withWiki({ kind: 'space' })
      const personal = api.withWiki({ kind: 'personal' })
      const managed = new ApiError(409, 'managed')

      await expect(
        api.invite(spaceWiki.id, 'bob@example.com', 'viewer')
      ).rejects.toEqual(managed)
      await expect(
        api.cancelInvite(spaceWiki.id, spaceWiki.homePageId)
      ).rejects.toEqual(managed)
      await expect(api.getMembers(personal.id)).resolves.toMatchObject({
        managed: true
      })
    })

    it('refuses what is no email before it looks at the wiki, as the backend checks the body first', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const personal = api.withWiki({ kind: 'personal' })
      const invalid = new ApiError(400, 'invalid_request')

      await expect(
        api.invite(personal.id, 'not an email', 'viewer')
      ).rejects.toEqual(invalid)
      await expect(
        api.invite(wiki.id, ' bob@example.com', 'viewer')
      ).rejects.toEqual(invalid)
    })

    it('invites an email of the domain of the person only', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()

      await expect(
        api.invite(wiki.id, 'bob@elsewhere.com', 'viewer')
      ).rejects.toEqual(new ApiError(400, 'not_same_organization'))
      await expect(api.getMembers(wiki.id)).resolves.toMatchObject({
        invites: []
      })
    })

    it('moves the version of the wiki on each sharing change it takes, one that changes nothing too', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({ members: { 'bob@example.com': 'viewer' } })

      await api.invite(wiki.id, 'bob@example.com', 'editor')
      await api.cancelInvite(wiki.id, wiki.homePageId)

      await expect(api.getWiki(wiki.id)).resolves.toMatchObject({
        version: wiki.version + 2
      })
    })

    it("forgets the favorites and recent visits of the wiki's pages of a member who leaves", async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({ members: { 'bob@example.com': 'editor' } })
      const page = api.withPage(wiki.id, { title: 'Onboarding' })
      const bob = api.signedInAs('bob@example.com')
      await bob.getPage(page.id)
      await bob.setFavorite(page.id, true)

      await api.removeMember(wiki.id, bob.person.id)

      await api.invite(wiki.id, 'bob@example.com', 'editor')
      await bob.listWikis()
      await expect(bob.favorites()).resolves.toEqual([])
      await expect(bob.recent()).resolves.toEqual([])
    })

    it('finds the people of the organization who signed in by name or email, the person asking aside', async () => {
      const api = fakePagesApi()
      await api.listWikis()
      await api.signedInAs('bob@example.com', 'Bob Stone').listWikis()
      await api.signedInAs('carol@example.com', 'Carol Diaz').listWikis()
      // Of another organization, which has another mail domain.
      await api.signedInAs('erin@elsewhere.com', 'Erin Stone').listWikis()
      api.withWiki({ members: { 'dan@example.com': 'viewer' } })

      await expect(api.searchPeople('STO')).resolves.toEqual([
        { email: 'bob@example.com', name: 'Bob Stone' }
      ])
      await expect(api.searchPeople('carol@')).resolves.toEqual([
        { email: 'carol@example.com', name: 'Carol Diaz' }
      ])
      await expect(api.searchPeople('example')).resolves.toEqual([
        { email: 'bob@example.com', name: 'Bob Stone' },
        { email: 'carol@example.com', name: 'Carol Diaz' }
      ])
    })

    it('refuses to find people for a blank query or one over 200 characters', async () => {
      const api = fakePagesApi()
      const invalid = new ApiError(400, 'invalid_request')

      await expect(api.searchPeople(' ')).rejects.toEqual(invalid)
      await expect(api.searchPeople('a'.repeat(201))).rejects.toEqual(invalid)
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
      const titles = pages.toSorted(byPosition).map(page => page.title)
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
    })

    describe('its Grist address', () => {
      const budget = {
        title: 'Budget',
        kind: 'database' as const,
        parentId: null
      }
      const gristUrl = `${GRIST_ORIGIN}/o/docs/budget`
      const offOrigin = 'https://docs.example.com/o/docs/budget'
      const invalidRequest = new ApiError(400, 'invalid_request')
      const invalidGristUrl = new ApiError(400, 'invalid_grist_url')

      it('publishes the next version of a database page at an address', async () => {
        const api = fakePagesApi()
        const wiki = api.withWiki()
        const page = api.withPage(wiki.id, { ...budget, gristUrl })
        const next = `${GRIST_ORIGIN}/o/docs/budget-2027`

        await expect(
          api.publish(page.id, {
            baseVersion: 1,
            title: ' Budget 2027 ',
            gristUrl: next
          })
        ).resolves.toMatchObject({
          title: 'Budget 2027',
          content: [],
          gristUrl: next,
          version: 2
        })
        await expect(api.getVersion(page.id, 1)).resolves.toMatchObject({
          gristUrl
        })
      })

      it.each(OFF_GRIST_ORIGINS)(
        'refuses an address %s, on creation and on publishing',
        async (_case, address) => {
          const api = fakePagesApi()
          const wiki = api.withWiki()
          const page = api.withPage(wiki.id, budget)

          await expect(
            api.createPage(wiki.id, { ...budget, gristUrl: address })
          ).rejects.toEqual(invalidGristUrl)
          await expect(
            api.publish(page.id, {
              baseVersion: 1,
              title: 'Budget',
              gristUrl: address
            })
          ).rejects.toEqual(invalidGristUrl)
        }
      )

      it.each([
        ['with a NUL character', `${gristUrl}\u0000`],
        ['with a lone surrogate', `${gristUrl}\ud83d`]
      ])(
        'refuses an address %s as a malformed body, on creation and on publishing',
        async (_case, address) => {
          const api = fakePagesApi()
          const wiki = api.withWiki()
          const page = api.withPage(wiki.id, budget)

          await expect(
            api.createPage(wiki.id, { ...budget, gristUrl: address })
          ).rejects.toEqual(invalidRequest)
          await expect(
            api.publish(page.id, {
              baseVersion: 1,
              title: 'Budget',
              gristUrl: address
            })
          ).rejects.toEqual(invalidRequest)
        }
      )

      const mixed: [string, NewPage][] = [
        [
          'a database page with blocks',
          { ...budget, gristUrl, content: [paragraph('Q1')] }
        ],
        [
          'a document with a Grist address',
          { ...budget, kind: 'document', gristUrl }
        ],
        ['a database page with no Grist address', budget]
      ]

      it.each(mixed)(
        'refuses to create %s, as a malformed body',
        async (_case, input) => {
          const api = fakePagesApi()
          const wiki = api.withWiki()

          await expect(api.createPage(wiki.id, input)).rejects.toEqual(
            invalidRequest
          )
        }
      )

      it('refuses a draft for the other kind of page, or with both blocks and an address', async () => {
        const api = fakePagesApi()
        const wiki = api.withWiki()
        const database = api.withPage(wiki.id, budget)
        const document = api.withPage(wiki.id, { title: 'Onboarding' })
        const draft = { baseVersion: 1, title: 'Budget' }

        await expect(
          api.publish(database.id, { ...draft, content: [] })
        ).rejects.toEqual(invalidRequest)
        await expect(
          api.publish(document.id, { ...draft, gristUrl })
        ).rejects.toEqual(invalidRequest)
        await expect(
          api.publish(document.id, { ...draft, content: [], gristUrl })
        ).rejects.toEqual(invalidRequest)
      })

      // The page tells its kind after the trash, and before the version the
      // draft started from (docs/api.md).
      it('answers in_trash, not invalid_request, for blocks sent to a database page in the trash', async () => {
        const api = fakePagesApi()
        const wiki = api.withWiki()
        const page = api.withPage(wiki.id, budget)
        await api.deletePage(page.id)
        const before = (await api.getWiki(wiki.id)).version

        await expect(
          api.publish(page.id, {
            baseVersion: 1,
            title: 'Budget',
            content: [paragraph('Q1')]
          })
        ).rejects.toEqual(new ApiError(409, 'in_trash'))
        expect((await api.getWiki(wiki.id)).version).toBe(before)
      })

      it('answers invalid_request, not edit_conflict, for an address sent to a document from an older version', async () => {
        const api = fakePagesApi()
        const wiki = api.withWiki()
        const document = api.withPage(wiki.id, { title: 'Onboarding' })
        await api.publish(document.id, {
          baseVersion: 1,
          title: 'Onboarding',
          content: [paragraph('Ask for a laptop')]
        })
        const before = (await api.getWiki(wiki.id)).version

        await expect(
          api.publish(document.id, {
            baseVersion: 1,
            title: 'Onboarding',
            gristUrl
          })
        ).rejects.toEqual(invalidRequest)
        expect((await api.getWiki(wiki.id)).version).toBe(before)
      })

      it('checks the body, then its blocks or address, before the role and the place, as the backend does', async () => {
        const api = fakePagesApi()
        const wiki = api.withWiki({ role: 'viewer' })
        // A page of another wiki, which no page of this one may be under.
        const elsewhere = { parentId: api.withPage(api.withWiki().id).id }

        await expect(
          api.createPage(wiki.id, {
            ...budget,
            ...elsewhere,
            title: ' ',
            gristUrl: offOrigin
          })
        ).rejects.toEqual(invalidRequest)
        await expect(
          api.createPage(wiki.id, {
            ...budget,
            ...elsewhere,
            gristUrl: offOrigin
          })
        ).rejects.toEqual(invalidGristUrl)
        await expect(
          api.createPage(wiki.id, {
            title: 'Onboarding',
            kind: 'document',
            ...elsewhere,
            content: [paragraph('Steps\u0000')]
          })
        ).rejects.toEqual(new ApiError(400, 'invalid_content'))
        await expect(
          api.createPage(wiki.id, { ...budget, ...elsewhere, gristUrl })
        ).rejects.toEqual(new ApiError(403, 'forbidden'))
      })

      type Arrange = (
        api: FakePagesApi,
        pageId: string
      ) => Promise<FakePagesApi>

      const viewerOrTrash: [string, Arrange][] = [
        [
          'forbidden, to a viewer',
          api => Promise.resolve(api.signedInAs('bob@example.com'))
        ],
        [
          'in_trash, for a page in the trash',
          async (api, pageId) => {
            await api.deletePage(pageId)
            return api
          }
        ]
      ]

      const overANewerVersion: [string, Arrange] = [
        'edit_conflict, over a newer version',
        async (api, pageId) => {
          await api.publish(pageId, {
            baseVersion: 1,
            title: 'Budget',
            gristUrl
          })
          return api
        }
      ]

      // Seeded unchecked, as published while the Grist origins named its own.
      const aBudgetAtAFormerOrigin = (api: FakePagesApi) => {
        const wiki = api.withWiki({ members: { 'bob@example.com': 'viewer' } })
        return api.withPage(wiki.id, {
          ...budget,
          gristUrl: 'https://grist.example.net/o/docs/budget'
        })
      }

      it.each([...viewerOrTrash, overANewerVersion])(
        'answers invalid_grist_url, not %s, for a draft at an address off the Grist origin',
        async (_case, arrange) => {
          const api = fakePagesApi()
          const page = aBudgetAtAFormerOrigin(api)
          const person = await arrange(api, page.id)

          await expect(
            person.publish(page.id, {
              baseVersion: 1,
              title: 'Budget',
              gristUrl: offOrigin
            })
          ).rejects.toEqual(invalidGristUrl)
        }
      )

      it.each(viewerOrTrash)(
        'answers invalid_grist_url, not %s, for a version restored at an address off the Grist origin',
        async (_case, arrange) => {
          const api = fakePagesApi()
          const page = aBudgetAtAFormerOrigin(api)
          const person = await arrange(api, page.id)

          await expect(person.restoreVersion(page.id, 1)).rejects.toEqual(
            invalidGristUrl
          )
        }
      )
    })

    it('refuses a title with a NUL character or a lone surrogate', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const page = { kind: 'document' as const, parentId: null }
      const invalid = new ApiError(400, 'invalid_request')

      await expect(
        api.createPage(wiki.id, { ...page, title: 'On\u0000boarding' })
      ).rejects.toEqual(invalid)
      await expect(
        api.createPage(wiki.id, { ...page, title: 'Onboarding \ud83d' })
      ).rejects.toEqual(invalid)
    })

    it('refuses to publish a title with a NUL character or a lone surrogate', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const page = api.withPage(wiki.id, { title: 'Onboarding' })
      const invalid = new ApiError(400, 'invalid_request')

      await expect(
        api.publish(page.id, {
          baseVersion: 1,
          title: 'On\u0000boarding',
          content: []
        })
      ).rejects.toEqual(invalid)
      await expect(
        api.publish(page.id, {
          baseVersion: 1,
          title: 'Onboarding \ud83d',
          content: []
        })
      ).rejects.toEqual(invalid)
    })

    it('checks the blocks of a draft before its page, as the backend does', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({ role: 'viewer' })
      const page = api.withPage(wiki.id, { title: 'Onboarding' })

      await expect(
        api.publish(page.id, {
          baseVersion: 2,
          title: 'Onboarding',
          content: [paragraph('Steps\u0000')]
        })
      ).rejects.toEqual(new ApiError(400, 'invalid_content'))
    })

    describe('its blocks', () => {
      const linkingTo = (href: string) => ({
        type: 'paragraph',
        content: [{ type: 'link', href, content: [] }],
        children: []
      })

      /** A block whose address is its `url` prop: a media or a Grist embed. */
      const anAddressed = (type: string, url: string) => ({
        type,
        props: { url },
        children: []
      })

      it('takes the links and addresses the backend takes', async () => {
        const api = fakePagesApi()
        const wiki = api.withWiki()
        const content = [
          linkingTo('https://example.com/guide'),
          linkingTo('http://example.com/guide'),
          linkingTo('mailto:alice@example.com'),
          anAddressed('image', 'https://example.com/desk.png'),
          anAddressed('file', ''),
          anAddressed('gristEmbed', `${GRIST_ORIGIN}/o/docs/budget`)
        ]

        await expect(
          api.createPage(wiki.id, {
            title: 'Onboarding',
            kind: 'document',
            parentId: null,
            content
          })
        ).resolves.toMatchObject({ content })
      })

      it.each([
        ['over 2 MiB of JSON', paragraph('a'.repeat(2 * 1024 * 1024))],
        ['a link that is not http, https or mailto', linkingTo('ftp://a.b')],
        [
          'an image whose address is not https',
          anAddressed('image', 'http://example.com/desk.png')
        ],
        ...OFF_GRIST_ORIGINS.map(([where, url]): [string, Block] => [
          `a Grist embed ${where}`,
          anAddressed('gristEmbed', url)
        ]),
        ['a NUL character in a text', paragraph('Steps\u0000')],
        [
          'a lone surrogate in a key',
          { ...paragraph('Steps'), '\udc00level': 2 }
        ]
      ])('refuses %s, on creation and on publishing', async (_case, block) => {
        const api = fakePagesApi()
        const wiki = api.withWiki()
        const page = api.withPage(wiki.id, { title: 'Onboarding' })
        const invalid = new ApiError(400, 'invalid_content')

        await expect(
          api.createPage(wiki.id, {
            title: 'Onboarding',
            kind: 'document',
            parentId: null,
            content: [block]
          })
        ).rejects.toEqual(invalid)
        await expect(
          api.publish(page.id, {
            baseVersion: 1,
            title: 'Onboarding',
            content: [block]
          })
        ).rejects.toEqual(invalid)
      })
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

    it('refuses to restore a version whose blocks or Grist address publishing refuses now', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      // Seeded unchecked, as published while the Grist origins named its own.
      const formerAddress = 'https://grist.example.net/o/docs/budget'
      const page = api.withPage(wiki.id, {
        title: 'Budget',
        content: [
          { type: 'gristEmbed', props: { url: formerAddress }, children: [] }
        ]
      })
      const database = api.withPage(wiki.id, {
        title: 'Budget',
        kind: 'database',
        gristUrl: formerAddress
      })
      const before = (await api.getWiki(wiki.id)).version

      await expect(api.restoreVersion(page.id, 1)).rejects.toEqual(
        new ApiError(400, 'invalid_content')
      )
      await expect(api.restoreVersion(database.id, 1)).rejects.toEqual(
        new ApiError(400, 'invalid_grist_url')
      )
      expect((await api.getWiki(wiki.id)).version).toBe(before)
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

      await expect(treeOf(api, wiki.id)).resolves.toEqual([
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
      await expect(treeOf(api, wiki.id)).resolves.toEqual(['A', 'C', 'B', 'D'])
      await api.movePage(b.id, {
        parentId: null,
        afterId: a.id,
        beforeId: c.id
      })
      await expect(treeOf(api, wiki.id)).resolves.toEqual(['A', 'B', 'C', 'D'])
      await api.movePage(a.id, { parentId: null })
      await expect(treeOf(api, wiki.id)).resolves.toEqual(['B', 'C', 'D', 'A'])
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

      await expect(treeOf(api, wiki.id)).resolves.toEqual(['FAQ'])
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

    it('names the root of the branch a page in the trash went with', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const onboarding = api.withPage(wiki.id, { title: 'Onboarding' })
      const laptop = api.withPage(wiki.id, {
        title: 'Laptop',
        parentId: onboarding.id
      })
      const faq = api.withPage(wiki.id, { title: 'FAQ' })

      await api.deletePage(onboarding.id)

      const pages = await Promise.all(
        [onboarding, laptop, faq].map(page => api.getPage(page.id))
      )
      expect(pages.map(page => page.trashRootId)).toEqual([
        onboarding.id,
        onboarding.id,
        null
      ])
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
      await expect(treeOf(api, wiki.id)).resolves.toEqual([
        'Onboarding',
        ['Badge', 'Laptop', ['Setup']],
        'FAQ'
      ])

      await api.deletePage(laptop.id)
      await api.deletePage(onboarding.id)
      await expect(api.restorePage(laptop.id)).resolves.toMatchObject({
        parentId: null
      })
      await expect(treeOf(api, wiki.id)).resolves.toEqual([
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

    it('brings a branch deleted before under a purged one to the top', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const onboarding = api.withPage(wiki.id, { title: 'Onboarding' })
      const laptop = api.withPage(wiki.id, {
        title: 'Laptop',
        parentId: onboarding.id
      })
      await api.deletePage(laptop.id)
      await api.deletePage(onboarding.id)

      await api.purgePage(wiki.id, onboarding.id)

      await expect(api.getPage(laptop.id)).resolves.toMatchObject({
        parentId: null,
        ancestors: []
      })
      await expect(api.restorePage(laptop.id)).resolves.toMatchObject({
        parentId: null
      })
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
    it('labels a page with names trimmed, lowercased and composed, sorted', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const page = api.withPage(wiki.id)

      const labels = await api.setLabels(page.id, [
        ' Laptop ',
        'HowTo',
        'howto',
        '\u00e9quipe_2',
        'e\u0301quipe_2',
        'हिंदी',
        '\u0130stanbul'
      ])

      expect(labels).toEqual([
        '\u00e9quipe_2',
        'howto',
        'i\u0307stanbul',
        'laptop',
        'हिंदी'
      ])
      await expect(api.getPage(page.id)).resolves.toMatchObject({ labels })
    })

    it('refuses names other than 1 to 50 letters with their marks, decimal digits, - and _', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const page = api.withPage(wiki.id)
      const invalidLabel = new ApiError(400, 'invalid_label')

      for (const name of ['how to', ' ', 'a'.repeat(51), '½', 'x²']) {
        await expect(api.setLabels(page.id, [name])).rejects.toEqual(
          invalidLabel
        )
      }
    })

    it('takes at most 50 names, and checks their count before the page', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const page = api.withPage(wiki.id)
      const names = Array.from(
        { length: 51 },
        (_, index) => `n${String(index)}`
      )
      const invalidRequest = new ApiError(400, 'invalid_request')

      await expect(api.setLabels(page.id, names)).rejects.toEqual(
        invalidRequest
      )
      await expect(api.setLabels('unknown', names)).rejects.toEqual(
        invalidRequest
      )
      await expect(
        api.setLabels(page.id, names.slice(1))
      ).resolves.toHaveLength(50)
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

    it('reads the name of a label as it reads the names it labels a page with', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const setup = api.withPage(wiki.id, { title: 'Setup' })
      await api.setLabels(setup.id, ['howto', '\u00e9quipe'])

      for (const name of [' HowTo ', 'e\u0301quipe']) {
        const pages = await api.pagesWithLabel(wiki.id, name)
        expect(pages.map(page => page.title)).toEqual(['Setup'])
      }
    })

    it('answers no pages for a name no live page carries, unknown ones too', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const page = api.withPage(wiki.id)
      const deleted = api.withPage(wiki.id)
      await api.setLabels(page.id, ['howto'])
      await api.setLabels(deleted.id, ['laptop'])
      await api.deletePage(deleted.id)

      await api.setLabels(page.id, [])

      await expect(api.listLabels(wiki.id)).resolves.toEqual([])
      for (const name of ['howto', 'laptop', 'unknown']) {
        await expect(api.pagesWithLabel(wiki.id, name)).resolves.toEqual([])
      }
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

    it('refuses a body with a NUL character or a lone surrogate', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const page = api.withPage(wiki.id)
      const comment = await api.addComment(page.id, { body: 'Draft' })
      const invalid = new ApiError(400, 'invalid_request')

      for (const body of ['Dr\u0000aft', 'Draft \ud83d']) {
        await expect(api.addComment(page.id, { body })).rejects.toEqual(invalid)
        await expect(api.editComment(comment.id, body)).rejects.toEqual(invalid)
      }
      await expect(api.listComments(page.id)).resolves.toMatchObject([
        { body: 'Draft', editedAt: null }
      ])
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

    it('makes only the members an edit mentions anew follow the page', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({
        members: { 'bob@example.com': 'viewer', 'carol@example.com': 'viewer' }
      })
      const page = api.withPage(wiki.id)
      const bob = api.signedInAs('bob@example.com')
      const carol = api.signedInAs('carol@example.com')
      const comment = await api.addComment(page.id, {
        body: 'Ask @bob@example.com'
      })
      await api.setFollowing(page.id, false)
      await bob.setFollowing(page.id, false)

      await api.editComment(
        comment.id,
        'Ask @Bob@example.com, @carol@example.com'
      )

      await expect(carol.getPage(page.id)).resolves.toMatchObject({
        following: true
      })
      await expect(bob.getPage(page.id)).resolves.toMatchObject({
        following: false
      })
      await expect(api.getPage(page.id)).resolves.toMatchObject({
        following: false
      })
    })

    it('makes the author an edit mentions for the first time follow the page again', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const page = api.withPage(wiki.id)
      const comment = await api.addComment(page.id, { body: 'Plan' })
      await api.setFollowing(page.id, false)

      await api.editComment(comment.id, 'Plan, @alice@example.com?')

      await expect(api.getPage(page.id)).resolves.toMatchObject({
        following: true
      })
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
      const comment = await bob.addComment(page.id, { body: 'Thanks' })

      await expect(
        api.signedInAs('carol@example.com').deleteComment(comment.id)
      ).rejects.toEqual(new ApiError(403, 'forbidden'))
      await bob.deleteComment(comment.id)
      await api.deleteComment(question.id)

      await expect(api.listComments(page.id)).resolves.toEqual([])
    })

    it('refuses a comment on a page in the trash after its body, before its parent', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const page = api.withPage(wiki.id)
      const question = await api.addComment(page.id, { body: 'Question' })
      const answer = await api.addComment(page.id, {
        body: 'Answer',
        parentId: question.id
      })
      await api.deletePage(page.id)

      await expect(api.addComment(page.id, { body: ' ' })).rejects.toEqual(
        new ApiError(400, 'invalid_request')
      )
      await expect(
        api.addComment(page.id, { body: 'Thanks', parentId: answer.id })
      ).rejects.toEqual(new ApiError(409, 'in_trash'))
    })

    it('refuses to change a comment on a page in the trash after its body and who may change it', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({
        members: { 'bob@example.com': 'editor', 'carol@example.com': 'viewer' }
      })
      const page = api.withPage(wiki.id)
      const bob = api.signedInAs('bob@example.com')
      const carol = api.signedInAs('carol@example.com')
      const draft = await bob.addComment(page.id, { body: 'Draft' })
      await api.deletePage(page.id)
      const forbidden = new ApiError(403, 'forbidden')
      const inTrash = new ApiError(409, 'in_trash')

      await expect(api.editComment(draft.id, ' ')).rejects.toEqual(
        new ApiError(400, 'invalid_request')
      )
      await expect(api.editComment(draft.id, 'Final')).rejects.toEqual(
        forbidden
      )
      await expect(carol.deleteComment(draft.id)).rejects.toEqual(forbidden)
      await expect(bob.editComment(draft.id, 'Final')).rejects.toEqual(inTrash)
      await expect(bob.deleteComment(draft.id)).rejects.toEqual(inTrash)
      await expect(api.deleteComment(draft.id)).rejects.toEqual(inTrash)
      await expect(api.listComments(page.id)).resolves.toMatchObject([
        { id: draft.id, body: 'Draft' }
      ])
    })

    it('refuses a malformed body before a page out of reach, keeping the version', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const page = api.withPage(wiki.id)
      const draft = await api.addComment(page.id, { body: 'Draft' })
      const dan = api.signedInAs('dan@example.com')
      const invalid = new ApiError(400, 'invalid_request')
      const before = (await api.getWiki(wiki.id)).version

      await expect(dan.addComment(page.id, { body: ' ' })).rejects.toEqual(
        invalid
      )
      await expect(dan.editComment(draft.id, ' ')).rejects.toEqual(invalid)
      expect((await api.getWiki(wiki.id)).version).toBe(before)
    })

    it('refuses a malformed edit, and someone who is no member, before a page in the trash, keeping the version', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const page = api.withPage(wiki.id)
      const draft = await api.addComment(page.id, { body: 'Draft' })
      await api.deletePage(page.id)
      const dan = api.signedInAs('dan@example.com')
      const notFound = new ApiError(404, 'not_found')
      const before = (await api.getWiki(wiki.id)).version

      await expect(api.editComment(draft.id, ' ')).rejects.toEqual(
        new ApiError(400, 'invalid_request')
      )
      await expect(dan.addComment(page.id, { body: 'Thanks' })).rejects.toEqual(
        notFound
      )
      await expect(dan.editComment(draft.id, 'Mine')).rejects.toEqual(notFound)
      await expect(dan.deleteComment(draft.id)).rejects.toEqual(notFound)
      expect((await api.getWiki(wiki.id)).version).toBe(before)
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
            wiki: { id: wiki.id, name: 'Handbook', kind: 'shared' },
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

    it('tells the members an edit mentions anew, never those it mentioned before', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({
        members: { 'bob@example.com': 'viewer', 'carol@example.com': 'viewer' }
      })
      const page = api.withPage(wiki.id)
      const bob = api.signedInAs('bob@example.com')
      const carol = api.signedInAs('carol@example.com')
      const comment = await api.addComment(page.id, {
        body: 'Ask @bob@example.com'
      })

      await api.editComment(
        comment.id,
        'Ask @Bob@example.com, @carol@example.com'
      )

      await expect(carol.listNotifications()).resolves.toMatchObject({
        notifications: [
          { reason: 'mentioned', commentId: comment.id, readAt: null }
        ]
      })
      await expect(bob.listNotifications()).resolves.toMatchObject({
        notifications: [{ reason: 'mentioned', commentId: comment.id }],
        unread: 1
      })
      await expect(carol.listNotifications()).resolves.toMatchObject({
        unread: 1
      })
    })

    it('refuses a read selection that is no exclusive union, or too many ids', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const page = api.withPage(wiki.id)
      const invalid = new ApiError(400, 'invalid_request')

      await expect(api.markRead({ ids: [] })).rejects.toEqual(invalid)
      await expect(
        api.markRead({ ids: Array.from({ length: 101 }, (_, i) => String(i)) })
      ).rejects.toEqual(invalid)
      await expect(api.markRead({ ids: [page.id], all: true })).rejects.toEqual(
        invalid
      )
      await expect(api.markRead({} as never)).rejects.toEqual(invalid)
      await expect(api.markRead({ ids: ['not-an-id'] })).rejects.toEqual(
        invalid
      )
      await expect(api.markRead({ all: false } as never)).rejects.toEqual(
        invalid
      )
      await expect(api.markRead({ wikiId: 'not-an-id' })).rejects.toEqual(
        invalid
      )
      await expect(api.listNotifications()).resolves.toEqual(nothing)
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

  describe('finding', () => {
    it('lists the live favorite pages, the latest marked first', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({ name: 'Handbook' })
      const onboarding = api.withPage(wiki.id, { title: 'Onboarding' })
      const setup = api.withPage(wiki.id, { title: 'Setup' })
      const laptop = api.withPage(wiki.id, { title: 'Laptop' })
      await api.setFavorite(onboarding.id, true)
      await api.setFavorite(setup.id, true)
      await api.setFavorite(laptop.id, true)
      await api.deletePage(laptop.id)

      const favorites = await api.favorites()

      expect(favorites).toEqual([
        {
          id: setup.id,
          title: 'Setup',
          wiki: { id: wiki.id, name: 'Handbook', kind: 'shared' }
        },
        {
          id: onboarding.id,
          title: 'Onboarding',
          wiki: { id: wiki.id, name: 'Handbook', kind: 'shared' }
        }
      ])
      await expect(
        api.signedInAs('bob@example.com').favorites()
      ).resolves.toEqual([])
    })

    it('lists the live pages the person opened, the latest visit first', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({ name: 'Handbook' })
      const onboarding = api.withPage(wiki.id, { title: 'Onboarding' })
      const setup = api.withPage(wiki.id, { title: 'Setup' })
      const laptop = api.withPage(wiki.id, { title: 'Laptop' })
      await api.getPage(onboarding.id)
      await api.getPage(setup.id)
      await api.getPage(laptop.id)
      await api.getPage(onboarding.id)
      await api.deletePage(laptop.id)

      const recent = await api.recent()

      expect(recent).toMatchObject([
        {
          id: onboarding.id,
          title: 'Onboarding',
          wiki: { id: wiki.id, name: 'Handbook', kind: 'shared' }
        },
        {
          id: setup.id,
          title: 'Setup',
          wiki: { id: wiki.id, name: 'Handbook', kind: 'shared' }
        }
      ])
      await expect(api.signedInAs('bob@example.com').recent()).resolves.toEqual(
        []
      )
    })

    it('keeps the 20 latest recent pages', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      for (let number = 1; number <= 21; number += 1) {
        const page = api.withPage(wiki.id, { title: `Page ${String(number)}` })
        await api.getPage(page.id)
      }

      const recent = await api.recent()

      expect(recent).toHaveLength(20)
      expect(recent[0]?.title).toBe('Page 21')
      expect(recent.at(-1)?.title).toBe('Page 2')
    })

    it('keeps the 100 latest visits, those of pages in the trash among them', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      const first = api.withPage(wiki.id, { title: 'First' })
      const archive = api.withPage(wiki.id, { title: 'Archive' })
      await api.getPage(first.id)
      for (let number = 1; number <= 100; number += 1) {
        const page = api.withPage(wiki.id, {
          title: `Page ${String(number)}`,
          parentId: archive.id
        })
        await api.getPage(page.id)
      }
      await api.deletePage(archive.id)

      await expect(api.recent()).resolves.toEqual([])
    })
  })

  describe('search', () => {
    it('finds the live pages with every word, the last one as a beginning', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki({ name: 'Handbook' })
      const checklist = api.withPage(wiki.id, {
        title: 'Release checklist',
        content: [paragraph('Tag the version')]
      })
      api.withPage(wiki.id, {
        title: 'Onboarding',
        content: [paragraph('Read the release notes first')]
      })
      const old = api.withPage(wiki.id, { title: 'Old release notes' })
      await api.deletePage(old.id)
      const titles = async (query: string) =>
        (await api.search(query)).map(result => result.page.title)

      expect(await titles('release')).toEqual([
        'Release checklist',
        'Onboarding'
      ])
      expect(await titles('RELEASE NO')).toEqual(['Onboarding'])
      expect(await titles('releas notes')).toEqual([])
      await expect(api.search('checklist')).resolves.toMatchObject([
        {
          page: {
            id: checklist.id,
            title: 'Release checklist',
            wiki: { id: wiki.id, name: 'Handbook', kind: 'shared' }
          },
          updatedAt: checklist.updatedAt
        }
      ])
    })

    it('ranks the pages whose titles hold more of the words first, then, as ts_rank does, those whose texts hold them side by side more often, then the last published first', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      api.withPage(wiki.id, { title: 'Onboarding badge' })
      api.withPage(wiki.id, {
        title: 'Badge requests',
        content: [paragraph('Onboarding')]
      })
      api.withPage(wiki.id, {
        title: 'First day',
        content: [
          paragraph(
            'Show your onboarding badge, then wear your onboarding badge.'
          )
        ]
      })
      api.withPage(wiki.id, {
        title: 'Lobby',
        content: [paragraph('Show your onboarding badge.')]
      })
      api.withPage(wiki.id, {
        title: 'Hall',
        content: [paragraph('Wear your onboarding badge.')]
      })

      expect(
        (await api.search('onboarding badge')).map(result => result.page.title)
      ).toEqual([
        'Onboarding badge',
        'Badge requests',
        'First day',
        'Hall',
        'Lobby'
      ])
    })

    it('quotes five words before the first word found in the text and eight after, and nothing when the text holds none, as the backend does', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      api.withPage(wiki.id, {
        title: 'Onboarding',
        content: [
          paragraph(
            'Before your first day, IT prepares a laptop with the tools you need and an account for every app.'
          ),
          paragraph('Ask Bob')
        ]
      })
      api.withPage(wiki.id, { title: 'Desk' })
      const excerpt = async (query: string) =>
        (await api.search(query))[0]?.excerpt

      expect(await excerpt('laptop')).toBe(
        `…first day, IT prepares a ${found('laptop')} with the tools you need and an account…`
      )
      expect(await excerpt('bob')).toBe(
        `…account for every app. Ask ${found('Bob')}`
      )
      expect(await excerpt('day')).toBe(
        `Before your first ${found('day')}, IT prepares a laptop with the tools you…`
      )
      expect(await excerpt('onboarding')).toBe('')
      expect(await excerpt('desk')).toBe('')
    })

    it('shows the markers the text holds itself as blanks', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      api.withPage(wiki.id, {
        title: 'Keys',
        content: [paragraph(`The key${FOUND_START}badge${FOUND_END} you wear`)]
      })

      await expect(api.search('key')).resolves.toMatchObject([
        { excerpt: `The ${found('key')} badge you wear` }
      ])
    })

    it('marks the words found in the title, the markers it holds itself as blanks', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      api.withPage(wiki.id, {
        title: `Key facts: keys, not ${found('badges')}`
      })

      await expect(api.search('key')).resolves.toMatchObject([
        { markedTitle: `${found('Key')} facts: ${found('keys')}, not  badges ` }
      ])
    })

    it('reads the text of table cells and captions, as the backend keeps it', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      api.withPage(wiki.id, {
        title: 'Onboarding',
        content: [
          {
            type: 'table',
            content: {
              type: 'tableContent',
              rows: [
                {
                  cells: [
                    { type: 'tableCell', content: paragraph('Laptop').content },
                    { type: 'tableCell', content: paragraph('Badge').content }
                  ]
                }
              ]
            },
            children: []
          },
          {
            type: 'image',
            props: { url: 'https://example.com/desk.png', caption: 'A desk' },
            children: []
          }
        ]
      })
      const excerpt = async (query: string) =>
        (await api.search(query))[0]?.excerpt

      expect(await excerpt('badge')).toBe(`Laptop ${found('Badge')} A desk`)
      expect(await excerpt('desk')).toBe(`Laptop Badge A ${found('desk')}`)
    })

    it('searches every wiki of the person, or one of them', async () => {
      const api = fakePagesApi()
      const handbook = api.withWiki({ name: 'Handbook' })
      const guide = api.withWiki({ name: 'Guide' })
      api.withPage(handbook.id, { title: 'Release checklist' })
      api.withPage(guide.id, { title: 'Release notes' })
      const bob = api.signedInAs('bob@example.com')
      const secret = bob.withWiki({ name: 'Secret' })
      bob.withPage(secret.id, { title: 'Release plan' })
      const titles = async (wikiId?: string) =>
        (await api.search('release', wikiId)).map(result => result.page.title)

      expect(await titles()).toEqual(['Release notes', 'Release checklist'])
      expect(await titles(guide.id)).toEqual(['Release notes'])
      await expect(api.search('release', secret.id)).rejects.toEqual(
        new ApiError(404, 'not_found')
      )
    })

    it('answers the 50 best pages, for 1 to 200 characters', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      for (let number = 1; number <= 51; number += 1) {
        api.withPage(wiki.id, { title: `Release ${String(number)}` })
      }

      await expect(api.search('release')).resolves.toHaveLength(50)
      await expect(api.search(' ')).rejects.toEqual(
        new ApiError(400, 'invalid_request')
      )
      await expect(api.search('a'.repeat(201))).rejects.toEqual(
        new ApiError(400, 'invalid_request')
      )
    })

    it('refuses a text the backend cannot store, before it looks at the wiki', async () => {
      const api = fakePagesApi()
      const wiki = api.withWiki()
      api.withPage(wiki.id, { title: 'Release notes' })
      const refused = new ApiError(400, 'invalid_request')

      await expect(
        api.search(`release${String.fromCharCode(0)}`)
      ).rejects.toEqual(refused)
      await expect(
        api.search(`release ${String.fromCharCode(0xd800)}`)
      ).rejects.toEqual(refused)
      await expect(api.search(' ', 'no-such-wiki')).rejects.toEqual(refused)
    })
  })
})
