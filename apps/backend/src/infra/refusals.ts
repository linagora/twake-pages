import type { FastifyReply } from 'fastify'
import type { VersionSummary } from '../modules/pages/store.ts'
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
  invalid_label: 400,
  // A malformed body, which the routes answer themselves, unless only the
  // page tells it: blocks sent to a database page, or a Grist address to a
  // document.
  invalid_request: 400
} as const

export type Refusal = keyof typeof REFUSAL_STATUS

// What a refusal says besides its name: the current version of an edit
// conflict, which the editor shows. Twake Tasks' refusals carry their name
// alone, its stale description among them.
interface Details {
  current?: VersionSummary
}

export type Result<T> =
  { ok: true; value: T } | { ok: false; error: Refusal; details?: Details }

// Thrown, not returned, so the transaction rolls back whatever ran before it.
export class Refused extends Error {
  readonly refusal: Refusal
  readonly details: Details

  constructor(refusal: Refusal, details: Details = {}) {
    super(refusal)
    this.refusal = refusal
    this.details = details
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
    if (error instanceof Refused) {
      return { ok: false, error: error.refusal, details: error.details }
    }
    throw error
  }
}

export function refuse(
  reply: FastifyReply,
  error: Refusal,
  details: Details = {}
) {
  return reply.code(REFUSAL_STATUS[error]).send({ error, ...details })
}
