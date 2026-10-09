import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { asTenant } from '../../infra/db.ts'
import type { Mail } from '../../infra/mail.ts'
import type { Handler } from '../../scheduler/scheduler.ts'
import { userSettings } from '../settings/schema.ts'
import type { Role } from './access.ts'
import { wikiInvites, wikiMembers, wikis } from './schema.ts'

export const INVITE_EMAIL_JOB = 'invite-email'

const payload = z.object({
  wikiId: z.uuid(),
  email: z.string(),
  invitedBy: z.uuid(),
  organizationId: z.string().nullable()
})

/** The job of the email of an invitation, which reads it when it runs. */
export type InviteEmail = z.infer<typeof payload>

interface Messages {
  subject: (who: string, wiki: string) => string
  body: (who: string, wiki: string, as: string) => string
  someone: string
  as: Record<Role, string>
}

// In Pages' two languages, where Twake Tasks writes its emails in seven, and
// in plain text, since Pages' mailer has no HTML layout as Twake Tasks' has.
const MESSAGES = {
  en: {
    subject: (who, wiki) => `${who} shared "${wiki}" with you`,
    body: (who, wiki, as) =>
      `${who} shared the wiki "${wiki}" with you, ${as}.`,
    someone: 'Someone',
    as: { admin: 'as admin', editor: 'as editor', viewer: 'as viewer' }
  },
  fr: {
    subject: (who, wiki) => `${who} partage « ${wiki} » avec vous`,
    body: (who, wiki, as) =>
      `${who} partage le wiki « ${wiki} » avec vous, ${as}.`,
    someone: "Quelqu'un",
    as: {
      admin: "en tant qu'administrateur",
      editor: "en tant qu'éditeur",
      viewer: 'en tant que lecteur'
    }
  }
} satisfies Record<string, Messages>

type Language = keyof typeof MESSAGES

// The language of a setting such as fr-FR, English for one Pages does not have.
function languageOf(setting: string | null | undefined): Language {
  const code = setting?.toLowerCase().split(/[-_]/)[0]
  return code === 'fr' ? code : 'en'
}

// A name cannot add a line of its own to the email.
const plain = (text: string) =>
  text
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// Runs as the person who shared, so nothing is sent once the invitation is
// gone: canceled, or claimed into a membership at the person's sign-in. Nor
// once the wiki is deleted, which Twake Tasks still sends.
export function emailInvite(deps: {
  appUrl: string
  send: (mail: Mail) => Promise<void>
}): Handler {
  return async (raw, tx) => {
    const job = payload.parse(raw)
    await asTenant(tx, {
      userId: job.invitedBy,
      organizationId: job.organizationId,
      email: ''
    })
    const [invitation] = await tx
      .select({ role: wikiInvites.role, wiki: wikis.name })
      .from(wikiInvites)
      .innerJoin(
        wikis,
        and(eq(wikis.id, wikiInvites.wikiId), isNull(wikis.deletedAt))
      )
      .where(
        and(
          eq(wikiInvites.wikiId, job.wikiId),
          eq(wikiInvites.email, job.email)
        )
      )
    if (!invitation) return undefined
    const [inviter] = await tx
      .select({ email: wikiMembers.email, name: wikiMembers.name })
      .from(wikiMembers)
      .where(
        and(
          eq(wikiMembers.wikiId, job.wikiId),
          eq(wikiMembers.userId, job.invitedBy)
        )
      )
    const [settings] = await tx
      .select({ language: userSettings.language })
      .from(userSettings)
      .where(eq(userSettings.email, job.email))
    const messages: Messages = MESSAGES[languageOf(settings?.language)]
    const who = plain(inviter?.name ?? inviter?.email ?? messages.someone)
    const wiki = plain(invitation.wiki)
    const body = messages.body(who, wiki, messages.as[invitation.role])
    const link = `${deps.appUrl.replace(/\/$/, '')}/wikis/${job.wikiId}`
    await deps.send({
      to: job.email,
      subject: messages.subject(who, wiki),
      text: `${body}\n\n${link}\n`
    })
    return undefined
  }
}
