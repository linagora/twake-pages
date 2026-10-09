import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { inTenant, type Db, type Tx } from '../../infra/db.ts'
import type { HttpServer } from '../../infra/http.ts'
import { refuse, Refused, writeOrRefuse } from '../../infra/refusals.ts'
import type { Identity, RequireIdentity } from '../auth/index.ts'
import { checkRole, roleOn, type Role } from './access.ts'
import { bumpWiki } from './live.ts'
import { wikiParams } from './routes.ts'
import { wikiInvites, wikiMembers, wikis } from './schema.ts'

const role = z.enum(['viewer', 'editor', 'admin'])

const newInvite = z.object({ email: z.email().max(254).toLowerCase(), role })

const roleChange = z.object({ role })

const inviteParams = wikiParams.extend({ inviteId: z.uuid() })

const memberParams = wikiParams.extend({ userId: z.uuid() })

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
}
