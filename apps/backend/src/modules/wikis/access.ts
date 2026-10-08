import { and, eq, isNull } from 'drizzle-orm'
import type { Tx } from '../../infra/db.ts'
import { Refused } from '../../infra/refusals.ts'
import { wikiMembers, wikis } from './schema.ts'

export type Role = 'viewer' | 'editor' | 'admin'

// Every permission check goes through this query: the person's role on each
// wiki they can open. The owner of a personal wiki is its admin member.
export function accessibleWikis(tx: Tx, userId: string) {
  return tx
    .select({ wikiId: wikis.id, role: wikiMembers.role })
    .from(wikis)
    .innerJoin(
      wikiMembers,
      and(eq(wikiMembers.wikiId, wikis.id), eq(wikiMembers.userId, userId))
    )
    .where(isNull(wikis.deletedAt))
    .as('accessible')
}

/**
 * The person's role on the wiki, or null when the wiki is deleted, out of
 * their reach, or they are no member of it.
 */
export async function access(
  tx: Tx,
  identity: { userId: string },
  wikiId: string
): Promise<Role | null> {
  const accessible = accessibleWikis(tx, identity.userId)
  const [row] = await tx
    .select({ role: accessible.role })
    .from(accessible)
    .where(eq(accessible.wikiId, wikiId))
  return row?.role ?? null
}

const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 }

/** Refuses unless the person has at least the role needed on the wiki. */
export async function checkRole(
  tx: Tx,
  identity: { userId: string },
  wikiId: string,
  needed: Role
): Promise<Role> {
  const role = await access(tx, identity, wikiId)
  if (!role) throw new Refused('not_found')
  if (RANK[role] < RANK[needed]) throw new Refused('forbidden')
  return role
}
