import { asTenant, type Tx } from '../infra/db.ts'
import type { TestUser } from './app.ts'

/** A promise, and the two ends that reach and open its gate. */
export function aGate() {
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

/** Waits `ms`, for racing a request against a timer. */
export const aWhile = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms))

/** Runs the person's work under the tenant their rows need. */
export async function asPerson(tx: Tx, person: TestUser) {
  await asTenant(tx, {
    organizationId: person.organizationId,
    userId: person.userId,
    email: person.email
  })
}
