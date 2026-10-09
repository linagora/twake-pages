import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb } from '../../infra/db.ts'
import {
  aB2cUser,
  aSpaceWiki,
  aUser,
  aWikiOf,
  invite,
  joinWiki,
  personalWikiOf,
  someoneOfEachTenant,
  startApp,
  versionOf,
  wikisOf,
  type TestUser
} from '../../testing/app.ts'
import type { Role } from './access.ts'

let api: Awaited<ReturnType<typeof startApp>>
const { sql, db } = createDb(inject('databaseUrl'))

beforeAll(async () => {
  api = await startApp()
})

afterAll(async () => {
  await api.close()
  await sql.end()
})

/** An email of the person's organization, unique to the test. */
const anEmail = (name: string) => `${name}-${randomUUID()}@example.com`

/** Someone of the person's organization. */
const aColleagueOf = (user: TestUser, name = 'colleague') =>
  aUser({ organizationId: user.organizationId, email: anEmail(name) })

interface Sharing {
  members: { id: string; email: string; role: Role }[]
  invites: { id: string; email: string; role: Role }[]
  managed: boolean
}

/** What `GET /wikis/:wikiId/members` shows the person. */
const sharingOf = async (user: TestUser, wikiId: string) =>
  (await api.as(user).get(`/wikis/${wikiId}/members`)).json<Sharing>()

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

      const sharing = await sharingOf(bob, wiki.id)

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

      expect(await sharingOf(alice, wikiId)).toMatchObject({ managed: true })
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

    expect((await sharingOf(alice, wiki.id)).invites).toEqual([
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
    expect(await sharingOf(alice, wiki.id)).toMatchObject({
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

/** Invites the email to the wiki, and gives the invitation's id. */
async function anInvitation(
  admin: TestUser,
  wikiId: string,
  email = anEmail('carol')
) {
  await invite(api, admin, wikiId, email)
  const invitation = (await sharingOf(admin, wikiId)).invites.find(
    listed => listed.email === email.toLowerCase()
  )
  if (!invitation) throw new Error(`${email} is not invited`)
  return invitation.id
}

const cancel = (admin: TestUser, wikiId: string, inviteId: string) =>
  api.as(admin).delete(`/wikis/${wikiId}/invites/${inviteId}`)

describe('DELETE /wikis/:wikiId/invites/:inviteId', () => {
  it('cancels an invitation, which its email then no longer claims', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice, 'bob')
    const wiki = await aWikiOf(api, alice)
    const invitation = await anInvitation(alice, wiki.id, bob.email)

    const response = await cancel(alice, wiki.id, invitation)

    expect(response.statusCode).toBe(204)
    expect((await sharingOf(alice, wiki.id)).invites).toEqual([])
    expect((await wikisOf(api, bob)).map(listed => listed.id)).not.toContain(
      wiki.id
    )
  })

  it('moves the wiki’s version', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const invitation = await anInvitation(alice, wiki.id)
    const before = await versionOf(api, alice, wiki.id)

    await cancel(alice, wiki.id, invitation)

    expect(await versionOf(api, alice, wiki.id)).toBeGreaterThan(before)
  })

  it('answers the same for an invitation already canceled', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const invitation = await anInvitation(alice, wiki.id)
    await cancel(alice, wiki.id, invitation)

    const response = await cancel(alice, wiki.id, invitation)

    expect(response.statusCode).toBe(204)
  })

  it('leaves the invitations of the admin’s other wikis', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const archives = await aWikiOf(api, alice, 'Archives')
    const invitation = await anInvitation(alice, archives.id)

    await cancel(alice, wiki.id, invitation)

    expect((await sharingOf(alice, archives.id)).invites).toHaveLength(1)
  })

  it.each(['viewer', 'editor'] as const)('refuses %ss', async role => {
    const alice = aUser()
    const bob = aColleagueOf(alice)
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, role)
    const invitation = await anInvitation(alice, wiki.id)
    const before = await versionOf(api, alice, wiki.id)

    const response = await cancel(bob, wiki.id, invitation)

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'forbidden' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
    expect((await sharingOf(alice, wiki.id)).invites).toHaveLength(1)
  })

  it('hides the wiki from someone who is no member', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const invitation = await anInvitation(alice, wiki.id)
    const before = await versionOf(api, alice, wiki.id)

    const response = await cancel(aColleagueOf(alice), wiki.id, invitation)

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

      const response = await cancel(alice, wikiId, randomUUID())

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ error: 'managed' })
      expect(await versionOf(api, alice, wikiId)).toBe(before)
    }
  )

  it('answers not_found for an invitation id that is no uuid', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)

    const response = await cancel(alice, wiki.id, 'carol')

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
    expect(await versionOf(api, alice, wiki.id)).toBe(wiki.version)
  })
})
