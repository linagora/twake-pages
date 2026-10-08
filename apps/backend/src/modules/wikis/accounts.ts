import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { PlatformEvent } from '../../events/envelope.ts'
import {
  parseOrDrop,
  RejectedEventError,
  type Handler
} from '../../events/router.ts'
import { asTenant, type Tx } from '../../infra/db.ts'
import { wikiMembers, wikis } from './schema.ts'

const b2bDeleted = z.looseObject({
  organizationId: z.string().min(1).optional(),
  uuid: z.uuid().optional()
})

const b2cDeleted = z.looseObject({
  uuid: z.uuid().optional()
})

// Runs as the person, so a B2C tenant shows the wikis they belong to; their
// memberships go last, since they are what makes those wikis visible. The
// wikis it deletes go for good, as Twake Tasks deletes the projects of a
// deleted account, rather than for the 30 days a wiki its admin deletes is kept.
async function forget(tx: Tx, organizationId: string | null, userId: string) {
  await asTenant(tx, { organizationId, userId, email: '' })
  await tx
    .delete(wikis)
    .where(and(eq(wikis.createdBy, userId), eq(wikis.kind, 'personal')))
  await tx.delete(wikiMembers).where(eq(wikiMembers.userId, userId))
}

const onB2bDeleted: Handler<PlatformEvent> = async (event, tx) => {
  const account = parseOrDrop(b2bDeleted, event.body, event.routingKey)
  if (!account.organizationId) {
    throw new RejectedEventError('no organizationId')
  }
  if (!account.uuid) throw new RejectedEventError('no uuid')
  await forget(tx, account.organizationId, account.uuid)
}

const onB2cDeleted: Handler<PlatformEvent> = async (event, tx) => {
  const account = parseOrDrop(b2cDeleted, event.body, event.routingKey)
  if (!account.uuid) throw new RejectedEventError('no uuid')
  await forget(tx, null, account.uuid)
}

export const accountRoutes: ReadonlyMap<
  string,
  Handler<PlatformEvent>
> = new Map([
  ['domain.user.deleted', onB2bDeleted],
  ['user.deleted', onB2cDeleted]
])
