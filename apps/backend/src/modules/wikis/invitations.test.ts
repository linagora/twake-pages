import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb } from '../../infra/db.ts'
import {
  anEmail,
  aUser,
  aWikiOf,
  invite,
  startApp,
  type TestUser
} from '../../testing/app.ts'
import { aGate, asPerson, aWhile } from '../../testing/concurrency.ts'
import { inviteEmails } from './schema.ts'

let api: Awaited<ReturnType<typeof startApp>>
const { sql: client, db } = createDb(inject('databaseUrl'))

beforeAll(async () => {
  api = await startApp()
})

afterAll(async () => {
  await api.close()
  await client.end()
})

/**
 * An invitation email the person sent from the wiki, backdated so the sweep
 * takes it: no route can write one that old.
 */
function anOldEmail(by: TestUser, wikiId: string, email: string) {
  return db.transaction(async tx => {
    await asPerson(tx, by)
    await tx.insert(inviteEmails).values({
      wikiId,
      organizationId: by.organizationId,
      email,
      invitedBy: by.userId,
      sentAt: new Date(Date.now() - 2 * 24 * 60 * 60_000)
    })
  })
}

describe('an invitation sent while a deleted account holds its old emails', () => {
  it('sweeps the day-old emails without waiting for the one the deletion holds', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice, 'Roadmap')
    await anOldEmail(alice, wiki.id, anEmail('old'))

    // The deletion, holding the emails app_forget_user takes — the ones the
    // person sent, or that hold a member's address — while it runs its other
    // work.
    const held = aGate()
    const deletion = db.transaction(async tx => {
      await asPerson(tx, alice)
      await tx.execute(sql`
        select 1 from invite_emails
        where invited_by = ${alice.userId}
           or email in (
             select lower(email) from wiki_members
             where user_id = ${alice.userId}
           )
        for update`)
      held.reached()
      await held.opened
    })
    await held.arrived

    // The sweep takes the day-old emails it can and skips the one the deletion
    // holds, rather than wait for it: the invitation answers while the
    // deletion runs on. Without the skip, it would wait for the lock, and the
    // two would wait on each other.
    const newcomer = anEmail('newcomer')
    const answer = await Promise.race([
      invite(api, alice, wiki.id, newcomer, 'viewer'),
      aWhile(5000).then(() => 'waited' as const)
    ])
    expect(answer).not.toBe('waited')

    held.open()
    await deletion
  })
})
