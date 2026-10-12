import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { asTenant, createDb, type Tx } from '../../infra/db.ts'
import {
  anEmail,
  aUser,
  invite,
  startApp,
  type TestUser
} from '../../testing/app.ts'
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

/** A promise, and the two ends that reach and open its gate. */
function aGate() {
  let open!: () => void
  const opened = new Promise<void>(resolve => {
    open = resolve
  })
  let reached!: () => void
  const arrived = new Promise<void>(resolve => {
    reached = resolve
  })
  return { opened, arrived, open, reached }
}

const aWhile = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Runs the person's work under the tenant their rows need. */
async function asPerson(tx: Tx, person: TestUser) {
  await asTenant(tx, {
    organizationId: person.organizationId,
    userId: person.userId,
    email: person.email
  })
}

/** A shared wiki, made through the API by its admin. */
async function aWiki(admin: TestUser, name: string) {
  return (await api.as(admin).post('/wikis', { name })).json<{ id: string }>()
}

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
    const wiki = await aWiki(alice, 'Roadmap')
    await anOldEmail(alice, wiki.id, anEmail('old'))

    // The deletion, holding the wiki's day-old emails while it runs its other
    // work, as app_forget_user's delete does.
    const held = aGate()
    const deletion = db.transaction(async tx => {
      await asPerson(tx, alice)
      await tx.execute(sql`
        select 1 from invite_emails where wiki_id = ${wiki.id} for update`)
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
