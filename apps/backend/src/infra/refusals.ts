import type { FastifyReply } from 'fastify'
import { inTenant, type Db, type Tx } from './db.ts'

// The refusals of the API contract (docs/api.md), with their status.
const REFUSAL_STATUS = {
  not_found: 404,
  forbidden: 403,
  managed: 409,
  home_page: 409,
  invalid_parent: 400,
  stale_neighbours: 409,
  edit_conflict: 409,
  invalid_content: 400,
  invalid_grist_url: 400,
  not_in_trash: 409,
  in_trash: 409,
  last_admin: 409,
  not_same_organization: 400,
  invalid_label: 400
} as const

export type Refusal = keyof typeof REFUSAL_STATUS

export type Result<T> = { ok: true; value: T } | { ok: false; error: Refusal }

// Thrown, not returned, so the transaction rolls back whatever ran before it.
export class Refused extends Error {
  readonly refusal: Refusal

  constructor(refusal: Refusal) {
    super(refusal)
    this.refusal = refusal
  }
}

export async function writeOrRefuse<T>(
  db: Db,
  identity: Parameters<typeof inTenant>[1],
  work: (tx: Tx) => Promise<T>
): Promise<Result<T>> {
  try {
    return { ok: true, value: await inTenant(db, identity, work) }
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.refusal }
    throw error
  }
}

export function refuse(reply: FastifyReply, error: Refusal) {
  return reply.code(REFUSAL_STATUS[error]).send({ error })
}
