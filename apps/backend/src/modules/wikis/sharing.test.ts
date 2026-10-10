import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb } from '../../infra/db.ts'
import {
  aB2cUser,
  aColleagueOf,
  anEmail,
  anInvitation,
  aSpaceWiki,
  aUser,
  aWikiOf,
  backIn,
  cancelInvitation,
  createPage,
  favoritesAndRecentOf,
  follow,
  followingAndUnreadOf,
  invite,
  joinWiki,
  pageOf,
  personalWikiOf,
  publishHome,
  removeMember,
  sharingOf,
  someoneOfEachTenant,
  startApp,
  versionOf,
  WAYS_TO_LEAVE,
  wikisOf,
  type TestUser
} from '../../testing/app.ts'
import type { Role } from './access.ts'
import { behindAChange } from './testing.ts'

let api: Awaited<ReturnType<typeof startApp>>
const { sql, db } = createDb(inject('databaseUrl'))

beforeAll(async () => {
  api = await startApp()
})

afterAll(async () => {
  await api.close()
  await sql.end()
})

/**
 * The wikis whose members their admin does not choose, which sharing answers
 * managed for: a personal wiki, and a space wiki, whose members come from its
 * space. Each is made with the admin and the other person as members.
 */
const WIKIS_WITH_MANAGED_MEMBERS: [
  string,
  (admin: TestUser, other: TestUser) => Promise<string>
][] = [
  ['a personal wiki', async admin => (await personalWikiOf(api, admin)).id],
  [
    'a space wiki',
    (admin, other) =>
      aSpaceWiki(db, [
        [admin, 'admin'],
        [other, 'editor']
      ])
  ]
]

describe('GET /wikis/:wikiId/members', () => {
  it('lists the members, then the invitations to its admins, by email', async () => {
    const alice = aUser({ email: anEmail('alice'), name: 'Alice Martin' })
    const bob = aColleagueOf(alice, 'bob')
    const carol = anEmail('carol')
    const dave = anEmail('dave')
    const wiki = await aWikiOf(api, alice)
    await invite(api, alice, wiki.id, dave, 'admin')
    await invite(api, alice, wiki.id, bob.email, 'viewer')
    await invite(api, alice, wiki.id, carol, 'editor')
    await wikisOf(api, bob)

    const response = await api.as(alice).get(`/wikis/${wiki.id}/members`)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      members: [
        {
          id: alice.userId,
          email: alice.email,
          name: 'Alice Martin',
          role: 'admin',
          joinedAt: expect.any(String) as string
        },
        {
          id: bob.userId,
          email: bob.email,
          name: null,
          role: 'viewer',
          joinedAt: expect.any(String) as string
        }
      ],
      invites: [
        {
          id: expect.any(String) as string,
          email: carol,
          role: 'editor',
          createdAt: expect.any(String) as string
        },
        {
          id: expect.any(String) as string,
          email: dave,
          role: 'admin',
          createdAt: expect.any(String) as string
        }
      ],
      managed: false
    })
  })

  it.each(['viewer', 'editor'] as const)(
    'shows the members, but no invitation, to a %s',
    async role => {
      const alice = aUser()
      const bob = aColleagueOf(alice)
      const wiki = await aWikiOf(api, alice)
      await joinWiki(db, alice, wiki.id, bob, role)
      await invite(api, alice, wiki.id, anEmail('carol'))

      const sharing = await sharingOf(api, bob, wiki.id)

      expect(sharing.members.map(member => member.id).sort()).toEqual(
        [alice.userId, bob.userId].sort()
      )
      expect(sharing.invites).toEqual([])
    }
  )

  it.each(WIKIS_WITH_MANAGED_MEMBERS)(
    'says the members of %s are managed',
    async (_case, aWiki) => {
      const alice = aUser()
      const wikiId = await aWiki(alice, aColleagueOf(alice))

      expect(await sharingOf(api, alice, wikiId)).toMatchObject({
        managed: true
      })
    }
  )

  it.each([
    [
      'a wiki the person is no member of',
      async () => (await aWikiOf(api, aUser())).id
    ],
    ['an id that is no uuid', () => Promise.resolve('handbook')]
  ])('answers not_found for %s', async (_case, wikiOf) => {
    const response = await api
      .as(aUser())
      .get(`/wikis/${await wikiOf()}/members`)

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })
})

describe('POST /wikis/:wikiId/invites', () => {
  it('invites an email, which joins the wiki as it signs in', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)

    const response = await invite(api, alice, wiki.id, bob.email, 'viewer')

    expect(response.statusCode).toBe(202)
    expect(response.json()).toEqual({ status: 'invited' })
    expect(await wikisOf(api, bob)).toContainEqual(
      expect.objectContaining({ id: wiki.id, role: 'viewer' })
    )
  })

  it('shares a wiki between B2C users', async () => {
    const carol = aB2cUser()
    const dave = aB2cUser()
    const wiki = await aWikiOf(api, carol)

    await invite(api, carol, wiki.id, dave.email, 'editor')

    expect(await wikisOf(api, dave)).toContainEqual(
      expect.objectContaining({ id: wiki.id, role: 'editor' })
    )
  })

  it('moves the wiki’s version', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)

    await invite(api, alice, wiki.id, anEmail('bob'))

    expect(await versionOf(api, alice, wiki.id)).toBeGreaterThan(wiki.version)
  })

  it('keeps the email in lowercase, with the role it was last invited as', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const email = anEmail('Bob')

    await invite(api, alice, wiki.id, email, 'viewer')
    await invite(api, alice, wiki.id, email.toUpperCase(), 'admin')

    expect((await sharingOf(api, alice, wiki.id)).invites).toEqual([
      expect.objectContaining({ email: email.toLowerCase(), role: 'admin' })
    ])
  })

  it('answers invited for a member, whose role stays', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice)
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'viewer')

    const response = await invite(
      api,
      alice,
      wiki.id,
      bob.email.toUpperCase(),
      'admin'
    )

    expect(response.statusCode).toBe(202)
    expect(response.json()).toEqual({ status: 'invited' })
    expect(await sharingOf(api, alice, wiki.id)).toMatchObject({
      members: expect.arrayContaining([
        expect.objectContaining({ id: bob.userId, role: 'viewer' })
      ]) as unknown,
      invites: []
    })
  })

  it.each([
    ['no email', { role: 'viewer' }],
    ['an email that is no email', { email: 'bob', role: 'viewer' }],
    [
      'an email over 254 characters',
      { email: `${'b'.repeat(243)}@example.com`, role: 'viewer' }
    ],
    ['no role', { email: 'bob@example.com' }],
    ['an unknown role', { email: 'bob@example.com', role: 'owner' }]
  ])('refuses %s', async (_case, body) => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)

    const response = await api.as(alice).post(`/wikis/${wiki.id}/invites`, body)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_request' })
    expect(await versionOf(api, alice, wiki.id)).toBe(wiki.version)
  })

  it.each(['viewer', 'editor'] as const)('refuses %ss', async role => {
    const alice = aUser()
    const bob = aColleagueOf(alice)
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, role)

    const response = await invite(api, bob, wiki.id, anEmail('carol'))

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'forbidden' })
    expect(await versionOf(api, alice, wiki.id)).toBe(wiki.version)
  })

  it('hides the wiki from someone who is no member', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)

    const response = await invite(
      api,
      aColleagueOf(alice),
      wiki.id,
      anEmail('carol')
    )

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
    expect(await versionOf(api, alice, wiki.id)).toBe(wiki.version)
  })

  it.each(WIKIS_WITH_MANAGED_MEMBERS)(
    'refuses to share %s',
    async (_case, aWiki) => {
      const alice = aUser()
      const wikiId = await aWiki(alice, aColleagueOf(alice))
      const before = await versionOf(api, alice, wikiId)

      const response = await invite(api, alice, wikiId, anEmail('carol'))

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ error: 'managed' })
      expect(await versionOf(api, alice, wikiId)).toBe(before)
    }
  )

  it.each(someoneOfEachTenant)(
    'refuses an email of another domain, %s',
    async (_case, makeUser) => {
      const alice = makeUser()
      const wiki = await aWikiOf(api, alice)

      const response = await invite(
        api,
        alice,
        wiki.id,
        `bob-${randomUUID()}@elsewhere.test`
      )

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ error: 'not_same_organization' })
      expect(await versionOf(api, alice, wiki.id)).toBe(wiki.version)
    }
  )
})

describe('DELETE /wikis/:wikiId/invites/:inviteId', () => {
  it('cancels an invitation, which its email then no longer claims', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice, 'bob')
    const wiki = await aWikiOf(api, alice)
    const invitation = await anInvitation(api, alice, wiki.id, bob.email)

    const response = await cancelInvitation(api, alice, wiki.id, invitation)

    expect(response.statusCode).toBe(204)
    expect((await sharingOf(api, alice, wiki.id)).invites).toEqual([])
    expect((await wikisOf(api, bob)).map(listed => listed.id)).not.toContain(
      wiki.id
    )
  })

  it('moves the wiki’s version', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const invitation = await anInvitation(api, alice, wiki.id)
    const before = await versionOf(api, alice, wiki.id)

    await cancelInvitation(api, alice, wiki.id, invitation)

    expect(await versionOf(api, alice, wiki.id)).toBeGreaterThan(before)
  })

  it('answers the same for an invitation already canceled', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const invitation = await anInvitation(api, alice, wiki.id)
    await cancelInvitation(api, alice, wiki.id, invitation)

    const response = await cancelInvitation(api, alice, wiki.id, invitation)

    expect(response.statusCode).toBe(204)
  })

  it('leaves the invitations of the admin’s other wikis', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const archives = await aWikiOf(api, alice, 'Archives')
    const invitation = await anInvitation(api, alice, archives.id)

    await cancelInvitation(api, alice, wiki.id, invitation)

    expect((await sharingOf(api, alice, archives.id)).invites).toHaveLength(1)
  })

  it.each(['viewer', 'editor'] as const)('refuses %ss', async role => {
    const alice = aUser()
    const bob = aColleagueOf(alice)
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, role)
    const invitation = await anInvitation(api, alice, wiki.id)
    const before = await versionOf(api, alice, wiki.id)

    const response = await cancelInvitation(api, bob, wiki.id, invitation)

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'forbidden' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
    expect((await sharingOf(api, alice, wiki.id)).invites).toHaveLength(1)
  })

  it('hides the wiki from someone who is no member', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const invitation = await anInvitation(api, alice, wiki.id)
    const before = await versionOf(api, alice, wiki.id)

    const response = await cancelInvitation(
      api,
      aColleagueOf(alice),
      wiki.id,
      invitation
    )

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it.each(WIKIS_WITH_MANAGED_MEMBERS)(
    'answers managed for %s',
    async (_case, aWiki) => {
      const alice = aUser()
      const wikiId = await aWiki(alice, aColleagueOf(alice))
      const before = await versionOf(api, alice, wikiId)

      const response = await cancelInvitation(api, alice, wikiId, randomUUID())

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ error: 'managed' })
      expect(await versionOf(api, alice, wikiId)).toBe(before)
    }
  )

  it('answers not_found for an invitation id that is no uuid', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)

    const response = await cancelInvitation(api, alice, wiki.id, 'carol')

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
    expect(await versionOf(api, alice, wiki.id)).toBe(wiki.version)
  })
})

const setRole = (admin: TestUser, wikiId: string, userId: string, role: Role) =>
  api.as(admin).patch(`/wikis/${wikiId}/members/${userId}`, { role })

/** How many admins the wiki has, as its member shows them. */
const adminsOf = async (member: TestUser, wikiId: string) =>
  (await sharingOf(api, member, wikiId)).members.filter(
    listed => listed.role === 'admin'
  ).length

describe('PATCH /wikis/:wikiId/members/:userId', () => {
  it('changes the role of a member', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice)
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'viewer')

    const response = await setRole(alice, wiki.id, bob.userId, 'editor')

    expect(response.statusCode).toBe(204)
    expect(await wikisOf(api, bob)).toContainEqual(
      expect.objectContaining({ id: wiki.id, role: 'editor' })
    )
  })

  it('moves the wiki’s version', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice)
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'viewer')
    const before = await versionOf(api, alice, wiki.id)

    await setRole(alice, wiki.id, bob.userId, 'admin')

    expect(await versionOf(api, alice, wiki.id)).toBeGreaterThan(before)
  })

  it('lets an admin step down once another admin is there', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice)
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')
    await setRole(alice, wiki.id, bob.userId, 'admin')

    const response = await setRole(alice, wiki.id, alice.userId, 'viewer')

    expect(response.statusCode).toBe(204)
    expect(await wikisOf(api, alice)).toContainEqual(
      expect.objectContaining({ id: wiki.id, role: 'viewer' })
    )
  })

  it('refuses to take the role of the last admin', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice)
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')
    const before = await versionOf(api, alice, wiki.id)

    const response = await setRole(alice, wiki.id, alice.userId, 'editor')

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'last_admin' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
    expect(await wikisOf(api, alice)).toContainEqual(
      expect.objectContaining({ id: wiki.id, role: 'admin' })
    )
  })

  // Each change waits for the wiki's row lock, which the change before it
  // holds, then reads the admins as that change left them.
  it('keeps an admin when the last two step down at once', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice)
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'admin')

    const [first, second] = await behindAChange(db, alice, wiki.id, [
      () => setRole(alice, wiki.id, alice.userId, 'editor'),
      () => setRole(bob, wiki.id, bob.userId, 'editor')
    ])

    expect(first?.statusCode).toBe(204)
    expect(second?.statusCode).toBe(409)
    expect(second?.json()).toEqual({ error: 'last_admin' })
    expect(await adminsOf(alice, wiki.id)).toBe(1)
  })

  it.each([
    ['no role', {}],
    ['an unknown role', { role: 'owner' }]
  ])('refuses %s', async (_case, body) => {
    const alice = aUser()
    const bob = aColleagueOf(alice)
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'viewer')
    const before = await versionOf(api, alice, wiki.id)

    const response = await api
      .as(alice)
      .patch(`/wikis/${wiki.id}/members/${bob.userId}`, body)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_request' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it.each(['viewer', 'editor'] as const)('refuses %ss', async role => {
    const alice = aUser()
    const bob = aColleagueOf(alice)
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, role)
    const before = await versionOf(api, alice, wiki.id)

    const response = await setRole(bob, wiki.id, bob.userId, 'admin')

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'forbidden' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
    expect(await wikisOf(api, bob)).toContainEqual(
      expect.objectContaining({ id: wiki.id, role })
    )
  })

  it('hides the wiki from someone who is no member', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)

    const response = await setRole(
      aColleagueOf(alice),
      wiki.id,
      alice.userId,
      'viewer'
    )

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
    expect(await versionOf(api, alice, wiki.id)).toBe(wiki.version)
  })

  it.each(WIKIS_WITH_MANAGED_MEMBERS)(
    'answers managed for %s',
    async (_case, aWiki) => {
      const alice = aUser()
      const bob = aColleagueOf(alice)
      const wikiId = await aWiki(alice, bob)
      const before = await versionOf(api, alice, wikiId)

      const response = await setRole(alice, wikiId, bob.userId, 'viewer')

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ error: 'managed' })
      expect(await versionOf(api, alice, wikiId)).toBe(before)
    }
  )

  it.each([
    ['someone who is no member of the wiki', () => randomUUID()],
    ['an id that is no uuid', () => 'bob']
  ])('answers not_found for %s', async (_case, userId) => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)

    const response = await setRole(alice, wiki.id, userId(), 'viewer')

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
    expect(await versionOf(api, alice, wiki.id)).toBe(wiki.version)
  })
})

/** The ids of the wiki's members, as its member sees them. */
const memberIdsOf = async (member: TestUser, wikiId: string) =>
  (await sharingOf(api, member, wikiId)).members.map(listed => listed.id).sort()

describe('DELETE /wikis/:wikiId/members/:userId', () => {
  it.each(WAYS_TO_LEAVE)(
    'takes out a member %s, who no longer finds the wiki',
    async (_case, leave) => {
      const alice = aUser()
      const bob = aColleagueOf(alice)
      const wiki = await aWikiOf(api, alice)
      await joinWiki(db, alice, wiki.id, bob, 'viewer')

      const response = await leave(api, alice, wiki.id, bob)

      expect(response.statusCode).toBe(204)
      expect(await memberIdsOf(alice, wiki.id)).toEqual([alice.userId])
      expect((await wikisOf(api, bob)).map(listed => listed.id)).not.toContain(
        wiki.id
      )
    }
  )

  it.each(WAYS_TO_LEAVE)(
    'moves the wiki’s version for a member %s',
    async (_case, leave) => {
      const alice = aUser()
      const bob = aColleagueOf(alice)
      const wiki = await aWikiOf(api, alice)
      await joinWiki(db, alice, wiki.id, bob, 'viewer')
      const before = await versionOf(api, alice, wiki.id)

      await leave(api, alice, wiki.id, bob)

      expect(await versionOf(api, alice, wiki.id)).toBeGreaterThan(before)
    }
  )

  it('lets an admin leave once another admin is there', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice)
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'admin')

    const response = await removeMember(api, alice, wiki.id, alice.userId)

    expect(response.statusCode).toBe(204)
    expect(await memberIdsOf(bob, wiki.id)).toEqual([bob.userId])
  })

  it('refuses to let the last admin leave', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice)
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')
    const before = await versionOf(api, alice, wiki.id)

    const response = await removeMember(api, alice, wiki.id, alice.userId)

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'last_admin' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
    expect(await adminsOf(alice, wiki.id)).toBe(1)
  })

  // As for stepping down, each waits for the change before it to end.
  it('keeps an admin when the last two leave at once', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice)
    const carol = aColleagueOf(alice)
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'admin')
    await joinWiki(db, alice, wiki.id, carol, 'viewer')

    const [first, second] = await behindAChange(db, alice, wiki.id, [
      () => removeMember(api, alice, wiki.id, alice.userId),
      () => removeMember(api, bob, wiki.id, bob.userId)
    ])

    expect(first?.statusCode).toBe(204)
    expect(second?.statusCode).toBe(409)
    expect(second?.json()).toEqual({ error: 'last_admin' })
    expect(await adminsOf(carol, wiki.id)).toBe(1)
  })

  it.each(['viewer', 'editor'] as const)(
    'refuses %ss who remove someone else',
    async role => {
      const alice = aUser()
      const bob = aColleagueOf(alice)
      const carol = aColleagueOf(alice)
      const wiki = await aWikiOf(api, alice)
      await joinWiki(db, alice, wiki.id, bob, role)
      await joinWiki(db, alice, wiki.id, carol, 'viewer')
      const before = await versionOf(api, alice, wiki.id)

      const response = await removeMember(api, bob, wiki.id, carol.userId)

      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual({ error: 'forbidden' })
      expect(await versionOf(api, alice, wiki.id)).toBe(before)
      expect(await memberIdsOf(alice, wiki.id)).toContain(carol.userId)
    }
  )

  it.each([
    ['removing a member', (alice: TestUser) => alice.userId],
    ['leaving it', (_alice: TestUser, stranger: TestUser) => stranger.userId]
  ])(
    'hides the wiki from someone who is no member, %s',
    async (_case, userIdOf) => {
      const alice = aUser()
      const stranger = aColleagueOf(alice)
      const wiki = await aWikiOf(api, alice)

      const response = await removeMember(
        api,
        stranger,
        wiki.id,
        userIdOf(alice, stranger)
      )

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
      expect(await versionOf(api, alice, wiki.id)).toBe(wiki.version)
    }
  )

  it.each(WIKIS_WITH_MANAGED_MEMBERS)(
    'answers managed for %s',
    async (_case, aWiki) => {
      const alice = aUser()
      const bob = aColleagueOf(alice)
      const wikiId = await aWiki(alice, bob)
      const before = await versionOf(api, alice, wikiId)

      const response = await removeMember(api, alice, wikiId, bob.userId)

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ error: 'managed' })
      expect(await versionOf(api, alice, wikiId)).toBe(before)
    }
  )

  it.each(WIKIS_WITH_MANAGED_MEMBERS)(
    'answers managed to a member leaving %s',
    async (_case, aWiki) => {
      const alice = aUser()
      const wikiId = await aWiki(alice, aColleagueOf(alice))
      const before = await versionOf(api, alice, wikiId)

      const response = await removeMember(api, alice, wikiId, alice.userId)

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ error: 'managed' })
      expect(await versionOf(api, alice, wikiId)).toBe(before)
    }
  )

  it('keeps an editor who leaves a space wiki, as its space decides', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice)
    const wikiId = await aSpaceWiki(db, [
      [alice, 'admin'],
      [bob, 'editor']
    ])
    const before = await versionOf(api, alice, wikiId)

    const response = await removeMember(api, bob, wikiId, bob.userId)

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'managed' })
    expect(await versionOf(api, alice, wikiId)).toBe(before)
    expect(await memberIdsOf(alice, wikiId)).toContain(bob.userId)
  })

  it.each([
    ['someone who is no member of the wiki', () => randomUUID()],
    ['an id that is no uuid', () => 'bob']
  ])('answers not_found for %s', async (_case, userId) => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)

    const response = await removeMember(api, alice, wiki.id, userId())

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
    expect(await versionOf(api, alice, wiki.id)).toBe(wiki.version)
  })
})

describe.each(someoneOfEachTenant)(
  'a member who leaves a wiki, %s',
  (_tenant, someone) => {
    it.each(WAYS_TO_LEAVE)(
      'loses their favorites and visits of its pages, %s',
      async (_case, leave) => {
        const alice = someone()
        const bob = aColleagueOf(alice)
        const wiki = await aWikiOf(api, alice)
        await joinWiki(db, alice, wiki.id, bob, 'viewer')
        await api.as(bob).put(`/pages/${wiki.homePageId}/favorite`)
        await pageOf(api, bob, wiki.homePageId)
        const before = await favoritesAndRecentOf(api, bob)

        await leave(api, alice, wiki.id, bob)

        await backIn(api, alice, bob, wiki.id)
        expect({
          before,
          after: await favoritesAndRecentOf(api, bob)
        }).toEqual({
          before: { favorites: [wiki.homePageId], recent: [wiki.homePageId] },
          after: { favorites: [], recent: [] }
        })
      }
    )

    it.each(WAYS_TO_LEAVE)(
      'keeps their follows and notifications of its pages, %s',
      async (_case, leave) => {
        const alice = someone()
        const bob = aColleagueOf(alice)
        const wiki = await aWikiOf(api, alice)
        await joinWiki(db, alice, wiki.id, bob, 'editor')
        await follow(api, bob, wiki.homePageId)
        await createPage(api, bob, wiki.id, { title: 'Notes' })
        // The home page is told, through publishing, as the product tells it.
        await publishHome(api, alice, wiki)

        await leave(api, alice, wiki.id, bob)

        await backIn(api, alice, bob, wiki.id)
        expect(
          await followingAndUnreadOf(api, bob, wiki.id, wiki.homePageId)
        ).toEqual({ following: true, unread: 1 })
      }
    )
  }
)

describe('GET /people', () => {
  it('suggests the people of the organization who signed in, by part of their email or name', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice, 'bob')
    const robert = { ...aColleagueOf(alice, 'robert'), name: 'Robert Bobin' }
    const carol = aColleagueOf(alice, 'carol')
    const outsider = aUser({ email: anEmail('bob') })
    for (const person of [bob, robert, carol, outsider]) {
      await wikisOf(api, person)
    }

    const response = await api.as(alice).get('/people?q=BOB')

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      people: [
        { email: bob.email, name: null },
        { email: robert.email, name: 'Robert Bobin' }
      ]
    })
  })

  it('leaves out the person asking, and who never signed in', async () => {
    const alice = aUser({ email: anEmail('pat') })
    await wikisOf(api, alice)
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, aColleagueOf(alice, 'pat'), 'editor')
    await invite(api, alice, wiki.id, anEmail('pat'))

    const response = await api.as(alice).get('/people?q=pat')

    expect(response.json()).toEqual({ people: [] })
  })

  it('suggests 10 people at most, by email', async () => {
    const alice = aUser()
    const colleagues = Array.from({ length: 11 }, (_, index) =>
      aColleagueOf(alice, `c${String(index).padStart(2, '0')}`)
    )
    for (const colleague of [...colleagues].reverse()) {
      await wikisOf(api, colleague)
    }

    const response = await api.as(alice).get('/people?q=example')

    expect(
      response.json<{ people: { email: string }[] }>().people.map(p => p.email)
    ).toEqual(colleagues.slice(0, 10).map(colleague => colleague.email))
  })

  it('takes % and _ in the query as themselves', async () => {
    const alice = aUser()
    await wikisOf(api, aColleagueOf(alice, 'bob'))

    const percent = await api.as(alice).get('/people?q=%25')
    const underscore = await api.as(alice).get('/people?q=_')

    expect({
      percent: percent.json<unknown>(),
      underscore: underscore.json<unknown>()
    }).toEqual({ percent: { people: [] }, underscore: { people: [] } })
  })

  it('suggests nobody in B2C, not even the members of a wiki of theirs', async () => {
    const alice = aB2cUser()
    const bob = aB2cUser()
    await wikisOf(api, bob)
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')

    const response = await api
      .as(alice)
      .get(`/people?q=${encodeURIComponent(bob.email)}`)

    expect(response.json()).toEqual({ people: [] })
  })

  it.each([
    ['no query', '/people'],
    ['a blank query', '/people?q=%20%20'],
    ['a query of more than 200 characters', `/people?q=${'a'.repeat(201)}`]
  ])('refuses %s', async (_case, path) => {
    const response = await api.as(aUser()).get(path)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_request' })
  })
})
