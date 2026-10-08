import { isFields, isList } from '@/domain/blocks'
import type { Block } from '@/domain/page'

/**
 * Where the app shows images from, as its Content Security Policy says
 * (img-src): its own origin, and the sources the deployment adds.
 */
export interface ImageSources {
  /** The origin of the app, which `'self'` names. */
  self: string
  /** As the deployment writes them, keywords such as `'self'` among them. */
  added: string[]
}

const addressOf = (url: string): URL | null => {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/**
 * The addresses of the images in `blocks` and in the blocks under them that
 * come from a host: the others, as data: ones, are the server's to refuse.
 */
function imagesIn(blocks: unknown): URL[] {
  if (!isList(blocks)) return []
  return blocks.filter(isFields).flatMap(block => {
    const url =
      block.type === 'image' && isFields(block.props) ? block.props.url : null
    const address = typeof url === 'string' && url ? addressOf(url) : null
    return [...(address?.host ? [address] : []), ...imagesIn(block.children)]
  })
}

// The sources of an img-src directive (CSP 3): `'self'`, `*`, a scheme as
// `https:`, or a host as `https://*.example.com:8443/pictures/`, whose
// scheme, port and path may go.
const SCHEME_SOURCE = /^([a-z][a-z0-9+.-]*):$/i
const HOST_SOURCE =
  /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\*|\d+))?(\/[^?#]*)?$/i

// A source on http also shows what the browser fetches on https.
const schemeMatches = (scheme: string, url: URL) => {
  const wanted = `${scheme.toLowerCase()}:`
  return (
    url.protocol === wanted || (wanted === 'http:' && url.protocol === 'https:')
  )
}

const hostMatches = (host: string, url: URL) => {
  const wanted = host.toLowerCase()
  return wanted.startsWith('*.')
    ? url.hostname.endsWith(wanted.slice(1))
    : wanted === '*' || url.hostname === wanted
}

// Without a port, the source takes the scheme's default one only.
const portMatches = (port: string | undefined, url: URL) => {
  if (port === undefined) return url.port === ''
  const used = url.port || (url.protocol === 'http:' ? '80' : '443')
  return port === '*' || port === used
}

// A path ending in a slash takes what lies below it, another one itself only.
const pathMatches = (path: string | undefined, url: URL) =>
  path === undefined ||
  (path.endsWith('/') ? url.pathname.startsWith(path) : url.pathname === path)

/** Whether `source` lets the browser show the image at `url`. */
function allows(source: string, url: URL, self: URL): boolean {
  if (source.toLowerCase() === "'self'") return url.origin === self.origin
  if (source === '*') return schemeMatches('http', url)
  const scheme = SCHEME_SOURCE.exec(source)?.[1]
  if (scheme !== undefined) return schemeMatches(scheme, url)
  const host = HOST_SOURCE.exec(source)
  if (!host) return false
  // A host without a scheme takes the one of the app.
  const [, hostScheme = self.protocol.slice(0, -1), name = '', port, path] =
    host
  return (
    schemeMatches(hostScheme, url) &&
    hostMatches(name, url) &&
    portMatches(port, url) &&
    pathMatches(path, url)
  )
}

/**
 * The hosts of the images in `blocks` that the browser will not show, once
 * each, as no source of the app allows them.
 */
export function imageHostsNotShown(
  blocks: Block[],
  { self, added }: ImageSources
): string[] {
  const app = new URL(self)
  const listed = ["'self'", ...added]
  const hidden = imagesIn(blocks).filter(
    url => !listed.some(source => allows(source, url, app))
  )
  return [...new Set(hidden.map(url => url.host))]
}
