import { vi } from 'vitest'

import type { SessionService, User } from '@/application/session'

export const fakeUser = (idToken: string | null = null): User => ({
  name: 'Alice Martin',
  email: 'alice@example.com',
  workplaceFqdn: 'alice.twake.test',
  idToken
})

export function fakeSession(
  start: () => Promise<User | null> = () => Promise.resolve(fakeUser())
): SessionService & { endElsewhere: () => void } {
  let onEnded: (() => void) | null = null
  return {
    start: vi.fn(start),
    signIn: vi.fn(() => Promise.resolve<User | null>(null)),
    signOut: vi.fn(() => Promise.resolve()),
    onEndedElsewhere: callback => {
      onEnded = callback
      return () => {
        onEnded = null
      }
    },
    endElsewhere: () => onEnded?.()
  }
}
