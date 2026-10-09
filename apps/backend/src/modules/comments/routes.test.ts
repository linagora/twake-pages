import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb, inTenant } from '../../infra/db.ts'
import {
  aColleagueOf,
  anInvitation,
  aPage,
  aPageIn,
  aUser,
  aWikiOf,
  backIn,
  invite,
  isFollowing,
  joinWiki,
  malformedOrUnknownIds,
  personOf,
  putInTheTrash,
  removeMember,
  someoneOfEachTenant,
  startApp,
  stopFollowing,
  versionOf,
  waysOutOfAWiki,
  wikiRowsOf,
  wikisOf,
  type Person,
  type TestUser
} from '../../testing/app.ts'

let api: Awaited<ReturnType<typeof startApp>>
const { sql, db } = createDb(inject('databaseUrl'))

beforeAll(async () => {
  api = await startApp()
})

afterAll(async () => {
  await api.close()
  await sql.end()
})

/** A comment as the comments routes answer it. */
interface Comment {
  id: string
  parentId: string | null
  author: Person
  body: string
  createdAt: string
  editedAt: string | null
}

/** `POST /pages/:pageId/comments` by the person. */
const commentOn = (user: TestUser, pageId: string, comment: object) =>
  api.as(user).post(`/pages/${pageId}/comments`, comment)

/** A comment the person writes on the page through the API. */
const aCommentOn = async (
  user: TestUser,
  pageId: string,
  comment: { body: string; parentId?: string }
) => (await commentOn(user, pageId, comment)).json<Comment>()

/** `GET /pages/:pageId/comments` by the person. */
const listComments = (user: TestUser, pageId: string) =>
  api.as(user).get(`/pages/${pageId}/comments`)

/** The page's comments, as `GET /pages/:pageId/comments` lists them. */
const commentsOf = async (user: TestUser, pageId: string) =>
  (await listComments(user, pageId)).json<{ comments: Comment[] }>().comments

/** Puts the page in the trash, with the comments written on it. */
const trash = (user: TestUser, pageId: string) =>
  inTenant(db, user, tx => putInTheTrash(tx, user, pageId))

/** Bodies with no text a comment takes, which answer invalid_request. */
const MALFORMED_BODIES: [string, object][] = [
  ['without a body', {}],
  ['whose body is no text', { body: 12 }],
  ['whose body is blank', { body: ' \n\t ' }],
  ['whose body is over 10 000 characters', { body: 'a'.repeat(10_001) }],
  ['whose body holds a NUL character', { body: 'Done\u0000' }],
  ['whose body holds a lone surrogate', { body: 'Done \ud83d' }]
]

/** Bodies no comment is written from, which answer invalid_request. */
const MALFORMED_COMMENTS: [string, object][] = [
  ...MALFORMED_BODIES,
  ['whose parentId is malformed', { body: 'Done', parentId: 'not-an-id' }]
]

/** A comment a reply names, in a wiki of the person, by its id. */
type ParentOf = (test: {
  user: TestUser
  wikiId: string
  pageId: string
}) => Promise<string>

/** The comments no reply answers, which writing one answers invalid_request for. */
const UNANSWERABLE: [string, ParentOf][] = [
  [
    'a reply',
    async ({ user, pageId }) => {
      const first = await aCommentOn(user, pageId, { body: 'Plan' })
      const reply = await aCommentOn(user, pageId, {
        body: 'Agreed',
        parentId: first.id
      })
      return reply.id
    }
  ],
  [
    'a comment on another page of the wiki',
    async ({ user, wikiId }) => {
      const other = await aPage(api, user, wikiId, { title: 'Goals' })
      return (await aCommentOn(user, other, { body: 'Plan' })).id
    }
  ],
  ['an unknown comment', () => Promise.resolve(randomUUID())]
]

describe('POST and GET /pages/:pageId/comments', () => {
  it.each(someoneOfEachTenant)(
    'lets a viewer %s comment on a page, and lists the comment to its members',
    async (_case, someone) => {
      const alice = someone()
      const bob = { ...aColleagueOf(alice, 'bob'), name: 'Bob Martin' }
      const wiki = await aWikiOf(api, alice)
      await joinWiki(db, alice, wiki.id, bob, 'viewer')

      const response = await commentOn(bob, wiki.homePageId, {
        body: '  Looks good.\n'
      })

      expect(response.statusCode).toBe(201)
      const written = response.json<Comment>()
      expect(written).toEqual({
        id: expect.any(String) as string,
        parentId: null,
        author: personOf(bob),
        body: 'Looks good.',
        createdAt: expect.any(String) as string,
        editedAt: null
      })
      expect(await commentsOf(alice, wiki.homePageId)).toEqual([written])
    }
  )

  it("lists a page's comments oldest first, replies among them, and no other page's", async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice, 'bob')
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'viewer')
    const goals = await aPage(api, alice, wiki.id, { title: 'Goals' })
    const first = await aCommentOn(alice, wiki.homePageId, { body: 'Plan' })
    await aCommentOn(bob, goals, { body: 'Elsewhere' })
    await aCommentOn(bob, wiki.homePageId, { body: 'Question' })
    await aCommentOn(bob, wiki.homePageId, {
      body: 'Agreed',
      parentId: first.id
    })

    const listed = await commentsOf(bob, wiki.homePageId)

    expect(listed.map(({ body, parentId }) => ({ body, parentId }))).toEqual([
      { body: 'Plan', parentId: null },
      { body: 'Question', parentId: null },
      { body: 'Agreed', parentId: first.id }
    ])
  })

  it('takes a null parentId for a comment that answers none', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)

    const response = await commentOn(alice, wiki.homePageId, {
      body: 'Plan',
      parentId: null
    })

    expect(response.statusCode).toBe(201)
    expect(response.json<Comment>().parentId).toBeNull()
  })

  it('takes a body of 10 000 characters once trimmed', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const body = 'a'.repeat(10_000)

    const response = await commentOn(alice, wiki.homePageId, {
      body: ` ${body}\n`
    })

    expect(response.statusCode).toBe(201)
    expect(response.json<Comment>().body).toBe(body)
  })

  // As a version keeps its author's: the comment stays theirs once they go.
  it('shows a comment under the name and email of its author, once they left the wiki', async () => {
    const alice = aUser()
    const bob = { ...aColleagueOf(alice, 'bob'), name: 'Bob Martin' }
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'viewer')
    await commentOn(bob, wiki.homePageId, { body: 'Bye' })

    await removeMember(api, bob, wiki.id, bob.userId)

    const listed = await commentsOf(alice, wiki.homePageId)
    expect(listed.map(({ author }) => author)).toEqual([personOf(bob)])
  })

  it.each(someoneOfEachTenant)(
    'makes a viewer %s who comments on a page follow it',
    async (_case, someone) => {
      const alice = someone()
      const bob = aColleagueOf(alice, 'bob')
      const wiki = await aWikiOf(api, alice)
      await joinWiki(db, alice, wiki.id, bob, 'viewer')

      await commentOn(bob, wiki.homePageId, { body: 'Plan' })

      expect(await isFollowing(api, bob, wiki.homePageId)).toBe(true)
    }
  )

  it('makes the author of a reply follow the page again, after they stopped', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const first = await aCommentOn(alice, wiki.homePageId, { body: 'Plan' })
    await stopFollowing(api, alice, wiki.homePageId)

    await commentOn(alice, wiki.homePageId, {
      body: 'Agreed',
      parentId: first.id
    })

    expect(await isFollowing(api, alice, wiki.homePageId)).toBe(true)
  })

  it('moves the version of the wiki once for a comment', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const before = await versionOf(api, alice, wiki.id)

    await commentOn(alice, wiki.homePageId, { body: 'Plan' })

    expect(await versionOf(api, alice, wiki.id)).toBe(before + 1)
  })

  // As a page opens from the trash, which keeps it until it is restored.
  it('lists the comments of a page in the trash', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const plans = await aPage(api, alice, wiki.id, { title: 'Plans' })
    const written = await aCommentOn(alice, plans, { body: 'Plan' })

    await trash(alice, plans)

    expect(await commentsOf(alice, plans)).toEqual([written])
  })

  it('answers in_trash to a comment on a page in the trash, and keeps the version', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const drafts = await aPageIn(db, alice, wiki.id, {
      title: 'Drafts',
      position: 'a0',
      deleted: true
    })
    const before = await versionOf(api, alice, wiki.id)

    const response = await commentOn(alice, drafts, { body: 'Plan' })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'in_trash' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
    expect(await commentsOf(alice, drafts)).toEqual([])
  })

  it('answers in_trash to a reply to a reply on a page in the trash, before its parent', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const plans = await aPage(api, alice, wiki.id, { title: 'Plans' })
    const first = await aCommentOn(alice, plans, { body: 'Plan' })
    const reply = await aCommentOn(alice, plans, {
      body: 'Agreed',
      parentId: first.id
    })
    await trash(alice, plans)
    const before = await versionOf(api, alice, wiki.id)

    const response = await commentOn(alice, plans, {
      body: 'Me too',
      parentId: reply.id
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'in_trash' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it.each(MALFORMED_COMMENTS)(
    'answers invalid_request to a comment %s, and keeps the version',
    async (_case, comment) => {
      const alice = aUser()
      const wiki = await aWikiOf(api, alice)
      const before = await versionOf(api, alice, wiki.id)

      const response = await commentOn(alice, wiki.homePageId, comment)

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ error: 'invalid_request' })
      expect(await versionOf(api, alice, wiki.id)).toBe(before)
      expect(await commentsOf(alice, wiki.homePageId)).toEqual([])
    }
  )

  it.each(UNANSWERABLE)(
    'answers invalid_request to a reply to %s, and keeps the version',
    async (_case, parentOf) => {
      const alice = aUser()
      const wiki = await aWikiOf(api, alice)
      const parentId = await parentOf({
        user: alice,
        wikiId: wiki.id,
        pageId: wiki.homePageId
      })
      const listed = await commentsOf(alice, wiki.homePageId)
      const before = await versionOf(api, alice, wiki.id)

      const response = await commentOn(alice, wiki.homePageId, {
        body: 'Me too',
        parentId
      })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ error: 'invalid_request' })
      expect(await versionOf(api, alice, wiki.id)).toBe(before)
      expect(await commentsOf(alice, wiki.homePageId)).toEqual(listed)
    }
  )

  it('answers not_found to someone who is no member, who neither reads nor writes comments, and keeps the version', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice, 'bob')
    const wiki = await aWikiOf(api, alice)
    await aCommentOn(alice, wiki.homePageId, { body: 'Plan' })
    const before = await versionOf(api, alice, wiki.id)

    const responses = [
      await listComments(bob, wiki.homePageId),
      await commentOn(bob, wiki.homePageId, { body: 'Me too' })
    ]

    expect(responses.map(response => response.statusCode)).toEqual([404, 404])
    expect(responses.map(response => response.json<unknown>())).toEqual([
      { error: 'not_found' },
      { error: 'not_found' }
    ])
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
    expect(await commentsOf(alice, wiki.homePageId)).toHaveLength(1)
  })

  it('answers invalid_request to a malformed comment by someone who is no member, before not_found, and keeps the version', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice, 'bob')
    const wiki = await aWikiOf(api, alice)
    const before = await versionOf(api, alice, wiki.id)

    const response = await commentOn(bob, wiki.homePageId, {})

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_request' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('answers invalid_request to a malformed comment on a page in the trash, before in_trash, and keeps the version', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const drafts = await aPageIn(db, alice, wiki.id, {
      title: 'Drafts',
      position: 'a0',
      deleted: true
    })
    const before = await versionOf(api, alice, wiki.id)

    const response = await commentOn(alice, drafts, {})

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_request' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('answers not_found to someone who is no member for a page in the trash, before in_trash, and keeps the version', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice, 'bob')
    const wiki = await aWikiOf(api, alice)
    const drafts = await aPageIn(db, alice, wiki.id, {
      title: 'Drafts',
      position: 'a0',
      deleted: true
    })
    const before = await versionOf(api, alice, wiki.id)

    const response = await commentOn(bob, drafts, { body: 'Plan' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  // No route shows a deleted wiki's version, so it is read from its row.
  it.each(waysOutOfAWiki)(
    'answers not_found for a page of %s, and keeps the version',
    async (_case, someone, takeOut) => {
      const alice = someone()
      const carol = aColleagueOf(alice, 'carol')
      const wiki = await aWikiOf(api, carol)
      await joinWiki(db, carol, wiki.id, alice, 'viewer')
      await takeOut(api, carol, wiki.id, alice)
      const before = await wikiRowsOf(db, carol, wiki.id)

      const responses = [
        await listComments(alice, wiki.homePageId),
        await commentOn(alice, wiki.homePageId, { body: 'Plan' })
      ]

      expect(responses.map(response => response.statusCode)).toEqual([404, 404])
      expect(responses.map(response => response.json<unknown>())).toEqual([
        { error: 'not_found' },
        { error: 'not_found' }
      ])
      expect(await wikiRowsOf(db, carol, wiki.id)).toEqual(before)
    }
  )

  it.each(malformedOrUnknownIds)(
    'answers not_found for a page with %s',
    async (_case, pageId) => {
      const alice = aUser()

      const responses = [
        await listComments(alice, pageId),
        await commentOn(alice, pageId, { body: 'Plan' })
      ]

      expect(responses.map(response => response.statusCode)).toEqual([404, 404])
      expect(responses.map(response => response.json<unknown>())).toEqual([
        { error: 'not_found' },
        { error: 'not_found' }
      ])
    }
  )
})

/**
 * Comments that mention the member of the email, as the frontend's
 * domain/comment.spec.ts and Twake Tasks' Comments.spec.tsx read them, and as
 * Twake Tasks does not in brackets or quotes.
 */
const MENTIONING: [string, (email: string) => string][] = [
  ['after a space, before a comma', email => `Thanks @${email}, it is done.`],
  ['at the start, in another case', email => `@${email.toUpperCase()} ok?`],
  ['before a full stop', email => `Ask @${email}.`],
  ['in brackets', email => `Done (@${email})`],
  ['in quotes', email => `"@${email}" said so`]
]

/**
 * Emails of the other forms Twake Tasks takes, which a mention takes too: a
 * percent sign before the @, and a domain of one word.
 */
const MENTIONED_EMAILS: [string, () => string][] = [
  [
    'a percent sign before its @',
    () => `jean%dupont-${randomUUID()}@example.com`
  ],
  ['a domain of one word', () => `jean-${randomUUID()}@localhost`]
]

/** Comments that write the member's email without mentioning them. */
const NOT_MENTIONING: [string, (email: string) => string][] = [
  ['without its @', email => `write to ${email}`],
  ['inside another address', email => `write to bob@${email}`]
]

describe('mentions in POST /pages/:pageId/comments', () => {
  it.each(MENTIONING)(
    'make a member mentioned %s follow the page, the mention kept as typed',
    async (_case, bodyOf) => {
      const alice = aUser()
      const jean = aColleagueOf(alice, 'jean_dupont')
      const wiki = await aWikiOf(api, alice)
      await joinWiki(db, alice, wiki.id, jean, 'viewer')

      const response = await commentOn(alice, wiki.homePageId, {
        body: bodyOf(jean.email)
      })

      expect(response.json<Comment>().body).toBe(bodyOf(jean.email))
      expect(await isFollowing(api, jean, wiki.homePageId)).toBe(true)
    }
  )

  it.each(MENTIONED_EMAILS)(
    'make a member whose email has %s follow the page',
    async (_case, emailOf) => {
      const alice = aUser()
      const jean = aUser({
        organizationId: alice.organizationId,
        email: emailOf()
      })
      const wiki = await aWikiOf(api, alice)
      await joinWiki(db, alice, wiki.id, jean, 'viewer')

      await commentOn(alice, wiki.homePageId, { body: `Ask @${jean.email}` })

      expect(await isFollowing(api, jean, wiki.homePageId)).toBe(true)
    }
  )

  it.each(NOT_MENTIONING)(
    'are none for a member whose email a comment writes %s',
    async (_case, bodyOf) => {
      const alice = aUser()
      const jean = aColleagueOf(alice, 'jean_dupont')
      const wiki = await aWikiOf(api, alice)
      await joinWiki(db, alice, wiki.id, jean, 'viewer')

      await commentOn(alice, wiki.homePageId, { body: bodyOf(jean.email) })

      expect(await isFollowing(api, jean, wiki.homePageId)).toBe(false)
    }
  )

  it.each(someoneOfEachTenant)(
    'make a viewer %s follow the page, whatever the case of their email',
    async (_case, someone) => {
      const alice = someone()
      const bob = aColleagueOf(alice, 'Bob.Martin')
      const wiki = await aWikiOf(api, alice)
      await joinWiki(db, alice, wiki.id, bob, 'viewer')

      await commentOn(alice, wiki.homePageId, {
        body: `Thanks @${bob.email.toLowerCase()}`
      })

      expect(await isFollowing(api, bob, wiki.homePageId)).toBe(true)
    }
  )

  // Only a member's email mentions: an invitation makes no member yet.
  it('make someone invited to the wiki no follower, once they join', async () => {
    const alice = aUser()
    const carol = aColleagueOf(alice, 'carol')
    const wiki = await aWikiOf(api, alice)
    await anInvitation(api, alice, wiki.id, carol.email)

    await commentOn(alice, wiki.homePageId, { body: `Welcome @${carol.email}` })
    await wikisOf(api, carol)

    expect(await isFollowing(api, carol, wiki.homePageId)).toBe(false)
  })

  it('make a member who left the wiki no follower, once back', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice, 'bob')
    const wiki = await aWikiOf(api, alice)
    await invite(api, alice, wiki.id, bob.email)
    await wikisOf(api, bob)
    await removeMember(api, alice, wiki.id, bob.userId)

    await commentOn(alice, wiki.homePageId, { body: `Ask @${bob.email}` })
    await backIn(api, alice, bob, wiki.id)

    expect(await isFollowing(api, bob, wiki.homePageId)).toBe(false)
  })
})

/** `PATCH /comments/:commentId` by the person. */
const editComment = (user: TestUser, commentId: string, edit: object) =>
  api.as(user).patch(`/comments/${commentId}`, edit)

describe('PATCH /comments/:commentId', () => {
  it.each(someoneOfEachTenant)(
    'lets the author %s edit their comment, which tells when',
    async (_case, someone) => {
      const alice = someone()
      const bob = { ...aColleagueOf(alice, 'bob'), name: 'Bob Martin' }
      const wiki = await aWikiOf(api, alice)
      await joinWiki(db, alice, wiki.id, bob, 'viewer')
      const written = await aCommentOn(bob, wiki.homePageId, { body: 'Plan' })

      const response = await editComment(bob, written.id, {
        body: ' Better plan\n'
      })

      expect(response.statusCode).toBe(200)
      const edited = response.json<Comment>()
      expect(edited).toEqual({
        ...written,
        body: 'Better plan',
        editedAt: expect.any(String) as string
      })
      expect(await commentsOf(alice, wiki.homePageId)).toEqual([edited])
    }
  )

  it('moves the version of the wiki once for an edit', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const written = await aCommentOn(alice, wiki.homePageId, { body: 'Plan' })
    const before = await versionOf(api, alice, wiki.id)

    await editComment(alice, written.id, { body: 'Better plan' })

    expect(await versionOf(api, alice, wiki.id)).toBe(before + 1)
  })

  it('makes a member the edit mentions for the first time follow the page', async () => {
    const alice = aUser()
    const carol = aColleagueOf(alice, 'carol')
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, carol, 'viewer')
    const written = await aCommentOn(alice, wiki.homePageId, { body: 'Plan' })

    await editComment(alice, written.id, { body: `Plan, @${carol.email}?` })

    expect(await isFollowing(api, carol, wiki.homePageId)).toBe(true)
  })

  // The members the comment mentioned already chose whether to follow.
  it('leaves a member the comment mentioned already, who stopped following, no follower', async () => {
    const alice = aUser()
    const carol = aColleagueOf(alice, 'carol')
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, carol, 'viewer')
    const written = await aCommentOn(alice, wiki.homePageId, {
      body: `Plan, @${carol.email}?`
    })
    await stopFollowing(api, carol, wiki.homePageId)

    await editComment(alice, written.id, {
      body: `Better plan, @${carol.email.toUpperCase()}?`
    })

    expect(await isFollowing(api, carol, wiki.homePageId)).toBe(false)
  })

  // Writing a comment makes its author follow the page; an edit leaves them
  // as they chose, unless it is the first to mention them.
  it('leaves the author who stopped following no follower, once they edit', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const written = await aCommentOn(alice, wiki.homePageId, { body: 'Plan' })
    await stopFollowing(api, alice, wiki.homePageId)

    await editComment(alice, written.id, { body: 'Better plan' })

    expect(await isFollowing(api, alice, wiki.homePageId)).toBe(false)
  })

  it('makes the author the edit mentions for the first time follow the page again', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const written = await aCommentOn(alice, wiki.homePageId, { body: 'Plan' })
    await stopFollowing(api, alice, wiki.homePageId)

    await editComment(alice, written.id, { body: `Plan, @${alice.email}?` })

    expect(await isFollowing(api, alice, wiki.homePageId)).toBe(true)
  })

  it.each(MALFORMED_BODIES)(
    'answers invalid_request to an edit %s, and keeps the version and the comment',
    async (_case, edit) => {
      const alice = aUser()
      const wiki = await aWikiOf(api, alice)
      const written = await aCommentOn(alice, wiki.homePageId, { body: 'Plan' })
      const before = await versionOf(api, alice, wiki.id)

      const response = await editComment(alice, written.id, edit)

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ error: 'invalid_request' })
      expect(await versionOf(api, alice, wiki.id)).toBe(before)
      expect(await commentsOf(alice, wiki.homePageId)).toEqual([written])
    }
  )

  it.each(['viewer', 'editor', 'admin'] as const)(
    'answers forbidden to %ss editing the comment of someone else, and keeps the version and the comment',
    async role => {
      const alice = aUser()
      const bob = aColleagueOf(alice, 'bob')
      const carol = aColleagueOf(alice, 'carol')
      const wiki = await aWikiOf(api, alice)
      await joinWiki(db, alice, wiki.id, bob, 'viewer')
      await joinWiki(db, alice, wiki.id, carol, role)
      const written = await aCommentOn(bob, wiki.homePageId, { body: 'Plan' })
      const before = await versionOf(api, alice, wiki.id)

      const response = await editComment(carol, written.id, {
        body: 'Better plan'
      })

      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual({ error: 'forbidden' })
      expect(await versionOf(api, alice, wiki.id)).toBe(before)
      expect(await commentsOf(alice, wiki.homePageId)).toEqual([written])
    }
  )

  it('answers invalid_request, before forbidden, to a blank edit of the comment of someone else, and keeps the version', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice, 'bob')
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'viewer')
    const written = await aCommentOn(alice, wiki.homePageId, { body: 'Plan' })
    const before = await versionOf(api, alice, wiki.id)

    const response = await editComment(bob, written.id, { body: ' ' })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_request' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('answers forbidden, before in_trash, to a member editing the comment of someone else on a page in the trash, and keeps the version', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice, 'bob')
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')
    const plans = await aPage(api, alice, wiki.id, { title: 'Plans' })
    const written = await aCommentOn(alice, plans, { body: 'Plan' })
    await trash(alice, plans)
    const before = await versionOf(api, alice, wiki.id)

    const response = await editComment(bob, written.id, { body: 'Mine' })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'forbidden' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('answers in_trash to the author editing a comment on a page in the trash, and keeps the version and the comment', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const plans = await aPage(api, alice, wiki.id, { title: 'Plans' })
    const written = await aCommentOn(alice, plans, { body: 'Plan' })
    await trash(alice, plans)
    const before = await versionOf(api, alice, wiki.id)

    const response = await editComment(alice, written.id, {
      body: 'Better plan'
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'in_trash' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
    expect(await commentsOf(alice, plans)).toEqual([written])
  })

  it('answers not_found to someone who is no member editing a comment, and keeps the version and the comment', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice, 'bob')
    const wiki = await aWikiOf(api, alice)
    const written = await aCommentOn(alice, wiki.homePageId, { body: 'Plan' })
    const before = await versionOf(api, alice, wiki.id)

    const response = await editComment(bob, written.id, { body: 'Mine' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
    expect(await commentsOf(alice, wiki.homePageId)).toEqual([written])
  })

  it('answers invalid_request to a malformed edit by someone who is no member, before not_found, and keeps the version', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice, 'bob')
    const wiki = await aWikiOf(api, alice)
    const written = await aCommentOn(alice, wiki.homePageId, { body: 'Plan' })
    const before = await versionOf(api, alice, wiki.id)

    const response = await editComment(bob, written.id, { body: ' ' })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_request' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('answers invalid_request to a malformed edit of a comment on a page in the trash, before in_trash, and keeps the version', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const plans = await aPage(api, alice, wiki.id, { title: 'Plans' })
    const written = await aCommentOn(alice, plans, { body: 'Plan' })
    await trash(alice, plans)
    const before = await versionOf(api, alice, wiki.id)

    const response = await editComment(alice, written.id, { body: ' ' })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_request' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('answers not_found to someone who is no member editing a comment on a page in the trash, before in_trash, and keeps the version', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice, 'bob')
    const wiki = await aWikiOf(api, alice)
    const plans = await aPage(api, alice, wiki.id, { title: 'Plans' })
    const written = await aCommentOn(alice, plans, { body: 'Plan' })
    await trash(alice, plans)
    const before = await versionOf(api, alice, wiki.id)

    const response = await editComment(bob, written.id, { body: 'Mine' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  // No route shows a deleted wiki's version, so it is read from its row.
  it.each(waysOutOfAWiki)(
    'answers not_found to the author editing their comment on a page of %s, and keeps the version',
    async (_case, someone, takeOut) => {
      const alice = someone()
      const carol = aColleagueOf(alice, 'carol')
      const wiki = await aWikiOf(api, carol)
      await joinWiki(db, carol, wiki.id, alice, 'viewer')
      const written = await aCommentOn(alice, wiki.homePageId, {
        body: 'Plan'
      })
      await takeOut(api, carol, wiki.id, alice)
      const before = await wikiRowsOf(db, carol, wiki.id)

      const response = await editComment(alice, written.id, {
        body: 'Better plan'
      })

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
      expect(await wikiRowsOf(db, carol, wiki.id)).toEqual(before)
    }
  )

  it.each(malformedOrUnknownIds)(
    'answers not_found for a comment with %s',
    async (_case, commentId) => {
      const alice = aUser()

      const response = await editComment(alice, commentId, {
        body: 'Better plan'
      })

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
    }
  )
})
