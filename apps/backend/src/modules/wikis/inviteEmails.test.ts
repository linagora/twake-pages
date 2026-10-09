import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb } from '../../infra/db.ts'
import type { Mail } from '../../infra/mail.ts'
import { createScheduler } from '../../scheduler/scheduler.ts'
import {
  aColleagueOf,
  anEmail,
  anInvitation,
  aUser,
  aWikiOf,
  cancelInvitation,
  invite,
  joinWiki,
  startApp,
  wikisOf
} from '../../testing/app.ts'
import { userSettings } from '../settings/schema.ts'
import { emailInvite, INVITE_EMAIL_JOB } from './inviteEmails.ts'

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
 * The invitation emails, sent to a fake server as the scheduler runs their
 * jobs, which `deliver` does until none is due.
 */
function aMailbox(signal: AbortSignal) {
  const sent: Mail[] = []
  const scheduler = createScheduler({
    db,
    logger: pino({ level: 'silent' }),
    handlers: {
      [INVITE_EMAIL_JOB]: emailInvite({
        appUrl: 'https://pages.example.com/',
        send: mail => {
          sent.push(mail)
          return Promise.resolve()
        }
      })
    }
  })
  // A test that timed out runs on, and its mailbox would take the jobs of
  // the tests after it, which theirs then skip as taken. Unlike Twake
  // Tasks', it stops between two jobs once vitest aborts the signal of its
  // test, as on a timeout, however late the test made it.
  // The other test files share the job queue, and may have filled it.
  const deliver = async () => {
    for (let job = 0; job < 2000; job++) {
      if (signal.aborted || (await scheduler.runDue(1)) === 0) return
    }
    throw new Error('The job queue was not drained after 2000 jobs')
  }
  // Those of other tests name other wikis.
  const sentAbout = (wikiId: string) =>
    sent.filter(mail => mail.text.includes(wikiId))
  return { deliver, sentAbout }
}

describe('invitation emails', () => {
  it('tells the person invited who shared which wiki with them, as what, and links to it', async ({
    signal
  }) => {
    const alice = aUser({ name: 'Alice Martin' })
    const wiki = await aWikiOf(api, alice, 'Roadmap')
    const mailbox = aMailbox(signal)
    const newcomer = anEmail('Newcomer')

    await invite(api, alice, wiki.id, newcomer, 'editor')
    await mailbox.deliver()

    expect(mailbox.sentAbout(wiki.id)).toEqual([
      {
        to: newcomer.toLowerCase(),
        subject: 'Alice Martin shared "Roadmap" with you',
        text: `Alice Martin shared the wiki "Roadmap" with you, as editor.\n\nhttps://pages.example.com/wikis/${wiki.id}\n`
      }
    ])
  })

  it('sends nothing more when the same address is invited again in the same role', async ({
    signal
  }) => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const mailbox = aMailbox(signal)
    const again = anEmail('again')
    await invite(api, alice, wiki.id, again, 'viewer')
    await mailbox.deliver()

    await invite(api, alice, wiki.id, again, 'viewer')
    await mailbox.deliver()

    expect(mailbox.sentAbout(wiki.id)).toHaveLength(1)
  })

  it('writes in the language the person invited has chosen in their settings', async ({
    signal
  }) => {
    const alice = aUser({ name: 'Alice Martin' })
    const wiki = await aWikiOf(api, alice, 'Roadmap')
    const french = anEmail('french')
    await db
      .insert(userSettings)
      .values({ email: french, version: 1, language: 'fr-FR' })
    const mailbox = aMailbox(signal)

    await invite(api, alice, wiki.id, french, 'editor')
    await mailbox.deliver()

    expect(mailbox.sentAbout(wiki.id)).toEqual([
      {
        to: french,
        subject: 'Alice Martin partage « Roadmap » avec vous',
        text: `Alice Martin partage le wiki « Roadmap » avec vous, en tant qu'éditeur.\n\nhttps://pages.example.com/wikis/${wiki.id}\n`
      }
    ])
  })

  it('sends nothing for an invitation canceled before delivery', async ({
    signal
  }) => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const mailbox = aMailbox(signal)
    const invitation = await anInvitation(api, alice, wiki.id)

    await cancelInvitation(api, alice, wiki.id, invitation)
    await mailbox.deliver()

    expect(mailbox.sentAbout(wiki.id)).toEqual([])
  })

  it('sends nothing for an invitation claimed before delivery', async ({
    signal
  }) => {
    const alice = aUser()
    const bob = aColleagueOf(alice, 'bob')
    const wiki = await aWikiOf(api, alice)
    const mailbox = aMailbox(signal)
    await invite(api, alice, wiki.id, bob.email)

    await wikisOf(api, bob)
    await mailbox.deliver()

    expect(mailbox.sentAbout(wiki.id)).toEqual([])
  })

  it('sends nothing more for an invitation the server refuses', async ({
    signal
  }) => {
    const alice = aUser()
    const bob = aColleagueOf(alice, 'bob')
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')
    const mailbox = aMailbox(signal)
    const carol = anEmail('carol')
    await invite(api, alice, wiki.id, carol, 'viewer')
    await mailbox.deliver()

    const response = await invite(api, bob, wiki.id, carol, 'admin')
    await mailbox.deliver()

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'forbidden' })
    expect(mailbox.sentAbout(wiki.id)).toHaveLength(1)
  })

  it('keeps each name on its line', async ({ signal }) => {
    const eve = aUser({ name: 'Eve\n\nClick here‮' })
    const wiki = await aWikiOf(api, eve, 'Plan\r\nFake: line')
    const mailbox = aMailbox(signal)
    const email = anEmail('inject')

    await invite(api, eve, wiki.id, email, 'viewer')
    await mailbox.deliver()

    expect(mailbox.sentAbout(wiki.id)).toEqual([
      {
        to: email,
        subject: 'Eve Click here shared "Plan Fake: line" with you',
        text: `Eve Click here shared the wiki "Plan Fake: line" with you, as viewer.\n\nhttps://pages.example.com/wikis/${wiki.id}\n`
      }
    ])
  })

  it('sends nothing for a wiki deleted before delivery', async ({ signal }) => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const mailbox = aMailbox(signal)
    await invite(api, alice, wiki.id, anEmail('late'))

    await api.as(alice).delete(`/wikis/${wiki.id}`)
    await mailbox.deliver()

    expect(mailbox.sentAbout(wiki.id)).toEqual([])
  })
})
