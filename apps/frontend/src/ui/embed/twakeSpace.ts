import {
  connectToTwakeSpace,
  type TwakeSpaceConnection
} from '@linagora/twake-embed'

export const EMBED_PREFIX = '/embed/wikis/'

let connection: TwakeSpaceConnection | null = null

const spaceOrigins = (): string[] =>
  (window.TWAKE_SPACE_ORIGIN ?? '').split(' ').filter(Boolean)

/**
 * Connects to TwakeSpace when the app is framed by it, at boot. `parent` is
 * the frame's parent, only given by tests.
 */
export function connectTwakeSpace(
  parent?: Window
): TwakeSpaceConnection | null {
  connection?.disconnect()
  connection = connectToTwakeSpace({
    hostOrigins: spaceOrigins(),
    embedPrefix: EMBED_PREFIX,
    isResourceId: id => /^[\w.-]+$/.test(id),
    parent
  })
  return connection
}

export function getTwakeSpace(): TwakeSpaceConnection | null {
  return connection
}

/** Forgets the connection, after a test */
export function disconnectTwakeSpace(): void {
  connection?.disconnect()
  connection = null
}
