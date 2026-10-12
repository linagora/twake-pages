import { and, asc, count, eq, gt, ilike, ne, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { inTenant, type Db, type Tx } from '../../infra/db.ts'
import type { HttpServer } from '../../infra/http.ts'
import { refuse, Refused, writeOrRefuse } from '../../infra/refusals.ts'
import { schedule } from '../../scheduler/scheduler.ts'
import type { Identity, RequireIdentity } from '../auth/index.ts'
import { checkRole, roleOn, type Role } from './access.ts'
import { INVITE_EMAIL_JOB, type InviteEmail } from './inviteEmails.ts'
import { bumpWiki } from './live.ts'
import { takeOutOfWiki } from './members.ts'
import { wikiParams } from './routes.ts'
import { inviteEmails, wikiInvites, wikiMembers, wikis } from './schema.ts'

const role = z.enum(['viewer', 'editor', 'admin'])

const newInvite = z.object({ email: z.email().max(254).toLowerCase(), role })

const roleChange = z.object({ role })

const inviteParams = wikiParams.extend({ inviteId: z.uuid() })

const memberParams = wikiParams.extend({ userId: z.uuid() })

const peopleQuery = z.object({ q: z.string().trim().min(1).max(200) })

// A personal wiki stays private, and a space wiki takes its members from its
// space. Unlike Twake Tasks, which answers forbidden, both are managed, as
// renaming a space wiki is.
async function sharedWiki(tx: Tx, identity: Identity, wikiId: string) {
  await checkRole(tx, identity, wikiId, 'admin')
  const wiki = await bumpWiki(tx, wikiId)
  if (wiki.kind !== 'shared') throw new Refused('managed')
  return wiki
}

const domainOf = (email: string) =>
  email.slice(email.lastIndexOf('@') + 1).toLowerCase()

// Twake Tasks has no such refusal: an invitation to another tenant waits
// there forever, since only a sign-in in the wiki's tenant claims it. Twake
// Workplace gives an organization one mail domain, and B2C users that of
// their provider, so the domain tells the tenant of an email without telling
// whether it has an account.
function checkSameOrganization(identity: Identity, email: string) {
  if (domainOf(email) !== domainOf(identity.email)) {
    throw new Refused('not_same_organization')
  }
}

const EMAILS_AN_HOUR = 20

// Anyone can make a wiki and invite any address of their domain, so as in
// Twake Tasks, the email goes once a day per address and wiki, and 20 times an
// hour per person inviting. The invitation is recorded either way. What is
// older than a day counts no more: forgotten. Unlike Twake Tasks, the windows
// run on the database's clock, which stamps sent_at.
async function mayEmail(tx: Tx, wikiId: string, email: string, by: string) {
  // The day-old rows go, forgotten: the sweep takes them itself, rather than
  // wait for a deletion that holds a few (FOR UPDATE SKIP LOCKED), which
  // would make the two wait on each other, the invitation answering 500. A
  // row skipped here is taken by a later invitation's sweep.
  await tx.execute(sql`
    delete from invite_emails
    where id in (
      select id from invite_emails
      where sent_at <= now() - interval '1 day'
      for update skip locked
    )`)
  const [sameAddress] = await tx
    .select({ id: inviteEmails.id })
    .from(inviteEmails)
    .where(and(eq(inviteEmails.wikiId, wikiId), eq(inviteEmails.email, email)))
    .limit(1)
  if (sameAddress) return false
  const [lastHour] = await tx
    .select({ sent: count() })
    .from(inviteEmails)
    .where(
      and(
        eq(inviteEmails.invitedBy, by),
        gt(inviteEmails.sentAt, sql`now() - interval '1 hour'`)
      )
    )
  return (lastHour?.sent ?? 0) < EMAILS_AN_HOUR
}

// Every sharing change moves the wiki's version first, so the row lock makes
// two admins stepping down at once take turns, and one of them stays.
async function keepAnAdmin(tx: Tx, wikiId: string, leaving: string) {
  const [other] = await tx
    .select({ userId: wikiMembers.userId })
    .from(wikiMembers)
    .where(
      and(
        eq(wikiMembers.wikiId, wikiId),
        eq(wikiMembers.role, 'admin'),
        ne(wikiMembers.userId, leaving)
      )
    )
    .limit(1)
  if (!other) throw new Refused('last_admin')
}

function createSharingStore(db: Db) {
  return {
    /** Answers the same whether the email has an account or not. */
    invite(identity: Identity, wikiId: string, email: string, role: Role) {
      return writeOrRefuse(db, identity, async tx => {
        const wiki = await sharedWiki(tx, identity, wikiId)
        checkSameOrganization(identity, email)
        const [member] = await tx
          .select({ userId: wikiMembers.userId })
          .from(wikiMembers)
          .where(
            and(
              eq(wikiMembers.wikiId, wikiId),
              eq(sql`lower(${wikiMembers.email})`, email)
            )
          )
        if (member) return
        const [existing] = await tx
          .select({ role: wikiInvites.role })
          .from(wikiInvites)
          .where(
            and(eq(wikiInvites.wikiId, wikiId), eq(wikiInvites.email, email))
          )
        await tx
          .insert(wikiInvites)
          .values({
            wikiId,
            organizationId: wiki.organizationId,
            email,
            role,
            invitedBy: identity.userId
          })
          .onConflictDoUpdate({
            target: [wikiInvites.wikiId, wikiInvites.email],
            set: { role }
          })
        // An email goes out for a new invitation or a change of role, within
        // the limits of mayEmail. Its job reads the invitation when it runs,
        // so it tells the role current then.
        if (existing?.role === role) return
        // The person's invitations to other wikis take turns here, so the
        // limit holds when they come at once.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${identity.userId}, 0))`
        )
        if (!(await mayEmail(tx, wikiId, email, identity.userId))) return
        await tx.insert(inviteEmails).values({
          wikiId,
          organizationId: wiki.organizationId,
          email,
          invitedBy: identity.userId
        })
        const job: InviteEmail = {
          wikiId,
          email,
          invitedBy: identity.userId,
          organizationId: wiki.organizationId
        }
        await schedule(tx, {
          kind: INVITE_EMAIL_JOB,
          key: `${INVITE_EMAIL_JOB}:${wikiId}:${email}`,
          payload: job,
          runAt: new Date()
        })
      })
    },

    /**
     * Unlike Twake Tasks, which shows them to admins only, the members are
     * shown to every member: the invitations stay with the admins.
     */
    sharing(identity: Identity, wikiId: string) {
      return inTenant(db, identity, async tx => {
        const role = await roleOn(tx, identity, wikiId)
        const [wiki] = role
          ? await tx
              .select({ kind: wikis.kind })
              .from(wikis)
              .where(eq(wikis.id, wikiId))
          : []
        if (!wiki) return null
        const members = await tx
          .select({
            id: wikiMembers.userId,
            email: wikiMembers.email,
            name: wikiMembers.name,
            role: wikiMembers.role,
            joinedAt: wikiMembers.joinedAt
          })
          .from(wikiMembers)
          .where(eq(wikiMembers.wikiId, wikiId))
          .orderBy(asc(wikiMembers.email))
        const invites =
          role === 'admin'
            ? await tx
                .select({
                  id: wikiInvites.id,
                  email: wikiInvites.email,
                  role: wikiInvites.role,
                  createdAt: wikiInvites.createdAt
                })
                .from(wikiInvites)
                .where(eq(wikiInvites.wikiId, wikiId))
                .orderBy(asc(wikiInvites.email))
            : []
        return { members, invites, managed: wiki.kind !== 'shared' }
      })
    },

    /** Answers the same for an invitation already gone, as Twake Tasks does. */
    cancelInvite(identity: Identity, wikiId: string, inviteId: string) {
      return writeOrRefuse(db, identity, async tx => {
        await sharedWiki(tx, identity, wikiId)
        await tx
          .delete(wikiInvites)
          .where(
            and(eq(wikiInvites.wikiId, wikiId), eq(wikiInvites.id, inviteId))
          )
      })
    },

    setMemberRole(
      identity: Identity,
      wikiId: string,
      userId: string,
      role: Role
    ) {
      return writeOrRefuse(db, identity, async tx => {
        await sharedWiki(tx, identity, wikiId)
        if (role !== 'admin') await keepAnAdmin(tx, wikiId, userId)
        const changed = await tx
          .update(wikiMembers)
          .set({ role })
          .where(
            and(eq(wikiMembers.wikiId, wikiId), eq(wikiMembers.userId, userId))
          )
          .returning({ userId: wikiMembers.userId })
        if (changed.length === 0) throw new Refused('not_found')
      })
    },

    /**
     * Takes the person out of the wiki, by its admin or by themself, whatever
     * their role. Leaving a personal or space wiki is managed, as removing
     * someone from it is.
     */
    removeMember(identity: Identity, wikiId: string, userId: string) {
      return writeOrRefuse(db, identity, async tx => {
        if (userId === identity.userId) {
          if (!(await roleOn(tx, identity, wikiId))) {
            throw new Refused('not_found')
          }
          const wiki = await bumpWiki(tx, wikiId)
          if (wiki.kind !== 'shared') throw new Refused('managed')
        } else {
          await sharedWiki(tx, identity, wikiId)
        }
        await keepAnAdmin(tx, wikiId, userId)
        const [left] = await takeOutOfWiki(tx, wikiId, [userId])
        if (!left) throw new Refused('not_found')
      })
    },

    /**
     * The people of the person's organization who signed in to Pages, whose
     * email or name holds the query: the members of its personal wikis, which
     * a first sign-in makes. Twake Tasks has no such search, and the LDAP
     * directory is not searched. In B2C, where a person sees no personal wiki
     * but their own, nobody.
     */
    peopleMatching(identity: Identity, query: string) {
      // LIKE's wildcards, and its escape character, as themselves.
      const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`
      return inTenant(db, identity, tx =>
        tx
          .select({ email: wikiMembers.email, name: wikiMembers.name })
          .from(wikiMembers)
          .innerJoin(wikis, eq(wikis.id, wikiMembers.wikiId))
          .where(
            and(
              eq(wikis.kind, 'personal'),
              ne(wikiMembers.userId, identity.userId),
              or(
                ilike(wikiMembers.email, pattern),
                ilike(wikiMembers.name, pattern)
              )
            )
          )
          .orderBy(asc(wikiMembers.email))
          .limit(10)
      )
    }
  }
}

export function registerSharing(
  app: HttpServer,
  deps: { db: Db; requireIdentity: RequireIdentity }
): void {
  const store = createSharingStore(deps.db)

  app.get(
    '/wikis/:wikiId/members',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = wikiParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const sharing = await store.sharing(identity, params.data.wikiId)
      return sharing ?? refuse(reply, 'not_found')
    }
  )

  app.post(
    '/wikis/:wikiId/invites',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = wikiParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const body = newInvite.safeParse(request.body)
      if (!body.success) {
        return reply.code(400).send({ error: 'invalid_request' })
      }
      const result = await store.invite(
        identity,
        params.data.wikiId,
        body.data.email,
        body.data.role
      )
      if (!result.ok) return refuse(reply, result.error)
      return reply.code(202).send({ status: 'invited' })
    }
  )

  app.delete(
    '/wikis/:wikiId/invites/:inviteId',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = inviteParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const result = await store.cancelInvite(
        identity,
        params.data.wikiId,
        params.data.inviteId
      )
      if (!result.ok) return refuse(reply, result.error)
      return reply.code(204).send()
    }
  )

  app.patch(
    '/wikis/:wikiId/members/:userId',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = memberParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const body = roleChange.safeParse(request.body)
      if (!body.success) {
        return reply.code(400).send({ error: 'invalid_request' })
      }
      const result = await store.setMemberRole(
        identity,
        params.data.wikiId,
        params.data.userId,
        body.data.role
      )
      if (!result.ok) return refuse(reply, result.error)
      return reply.code(204).send()
    }
  )

  app.delete(
    '/wikis/:wikiId/members/:userId',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = memberParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const result = await store.removeMember(
        identity,
        params.data.wikiId,
        params.data.userId
      )
      if (!result.ok) return refuse(reply, result.error)
      return reply.code(204).send()
    }
  )

  app.get(
    '/people',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const query = peopleQuery.safeParse(request.query)
      if (!query.success) {
        return reply.code(400).send({ error: 'invalid_request' })
      }
      return { people: await store.peopleMatching(identity, query.data.q) }
    }
  )
}
