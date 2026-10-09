import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb, inTenant } from '../../infra/db.ts'
import {
  aColleagueOf,
  aPage,
  aPageIn,
  aUser,
  aWikiOf,
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

/** Bodies no comment is written from, which answer invalid_request. */
const MALFORMED_COMMENTS: [string, object][] = [
  ['without a body', {}],
  ['whose body is no text', { body: 12 }],
  ['whose body is blank', { body: ' \n\t ' }],
  ['whose body is over 10 000 characters', { body: 'a'.repeat(10_001) }],
  ['whose body holds a NUL character', { body: 'Done\u0000' }],
  ['whose body holds a lone surrogate', { body: 'Done \ud83d' }],
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
