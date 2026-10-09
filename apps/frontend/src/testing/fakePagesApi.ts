import { generateKeyBetween } from 'fractional-indexing'
import { vi, type Mock } from 'vitest'

import {
  ApiError,
  EditConflict,
  type Move,
  type PagesApi,
  type Refusal,
  type UserSettings
} from '@/application/pages'
import { isFields, isList, type Fields } from '@/domain/blocks'
import { mentionsIn, type Comment } from '@/domain/comment'
import type { Notification, NotificationReason } from '@/domain/notification'
import {
  MAX_LABELS,
  normalizeLabelName,
  type Block,
  type Page,
  type PageKind,
  type PageRef,
  type TrashEntry,
  type TreePage,
  type Version,
  type VersionSummary
} from '@/domain/page'
import type { Person } from '@/domain/person'
import { FOUND_END, FOUND_START } from '@/domain/search'
import { byPosition } from '@/domain/tree'
import {
  ROLES,
  type Invite,
  type Member,
  type Role,
  type Wiki,
  type WikiKind,
  type WikiSummary
} from '@/domain/wiki'

type Mocks = { [Key in keyof PagesApi]: Mock<PagesApi[Key]> }

export interface WikiSeed {
  name?: string
  kind?: WikiKind
  role?: Role
  members?: Record<string, Role>
}

export interface PageSeed {
  title?: string
  kind?: PageKind
  parentId?: string | null
  content?: Block[]
  gristUrl?: string
}

/**
 * The backend of docs/api.md in memory, as seen by one person: every method
 * is a mock running the contract's rules, so a test can still override one.
 */
export type FakePagesApi = Mocks & {
  person: Person
  signedInAs: (email: string, name?: string | null) => FakePagesApi
  withWiki: (seed?: WikiSeed) => Wiki
  withPage: (wikiId: string, seed?: PageSeed) => Page
}

export const NO_SETTINGS: UserSettings = {
  version: 0,
  language: null,
  timezone: null,
  theme: 'auto',
  avatar: null,
  name: null
}

export const GRIST_ORIGIN = 'https://grist.example.com'

export const paragraph = (text: string): Block => ({
  type: 'paragraph',
  content: [{ type: 'text', text, styles: {} }],
  children: []
})

let counter = 0
const nextId = () => {
  counter += 1
  return `00000000-0000-7000-8000-${String(counter).padStart(12, '0')}`
}

let lastTime = 0
// Strictly increasing, so that "newest first" never ties.
const now = () => {
  lastTime = Math.max(Date.now(), lastTime + 1)
  return new Date(lastTime).toISOString()
}

const STATUS: Record<Refusal, number> = {
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
  invalid_request: 400
}

const refuse = (refusal: Refusal) => new ApiError(STATUS[refusal], refusal)

interface Membership {
  person: Person
  role: Role
  joinedAt: string
}

interface StoredWiki {
  id: string
  name: string
  description: string
  kind: WikiKind
  version: number
  createdBy: string
  deleted: boolean
  homePageId: string
  members: Map<string, Membership>
  invites: Invite[]
}

interface StoredPage {
  id: string
  wikiId: string
  parentId: string | null
  home: boolean
  kind: PageKind
  position: string
  createdAt: string
  createdBy: Person
  versions: Version[]
  followers: Set<string>
  favoredBy: Map<string, string>
  visitedBy: Map<string, string>
  labels: string[]
  deletion: Deletion | null
}

interface Deletion {
  rootId: string
  at: string
  by: Person
}

interface StoredComment extends Comment {
  pageId: string
}

interface StoredNotification {
  id: string
  userId: string
  pageId: string
  reason: NotificationReason
  actor: Person
  version: number | null
  commentId: string | null
  createdAt: string
  readAt: string | null
}

interface World {
  people: Map<string, Person>
  wikis: Map<string, StoredWiki>
  pages: Map<string, StoredPage>
  comments: Map<string, StoredComment>
  notifications: StoredNotification[]
  listeners: Map<string, Set<(version: number) => void>>
  apis: Map<string, FakePagesApi>
}

interface Content {
  title: string
  content: Block[]
  gristUrl: string | null
}

const byEmail = (a: { email: string }, b: { email: string }) =>
  a.email.localeCompare(b.email)

const byName = (a: string, b: string) => a.localeCompare(b)

// Near enough zod's email of the backend, which takes it as typed, untrimmed.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

function checkEmail(value: string) {
  if (value.length > 254 || !EMAIL.test(value)) {
    throw refuse('invalid_request')
  }
  return value.toLowerCase()
}

const domainOf = (email: string) =>
  email.slice(email.lastIndexOf('@') + 1).toLowerCase()

// As the backend takes them: a letter keeps the marks written with it, and a
// digit is a decimal one.
const LABEL = /^[\p{L}\p{M}\p{Nd}_-]{1,50}$/u

/** The label name the text makes, as the backend reads it, or null for none. */
function labelNameOf(text: string) {
  const name = normalizeLabelName(text)
  return LABEL.test(name) ? name : null
}

function checkLabel(value: string) {
  const name = labelNameOf(value)
  if (name === null) throw refuse('invalid_label')
  return name
}

const WORD = /[\p{L}\p{N}]+/gu

const wordsOf = (value: string) => value.toLowerCase().match(WORD) ?? []

// Styled text and the text of a link, or plain strings, which BlockNote takes
// for short.
function inlineText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!isList(content)) return ''
  return content
    .map(item => {
      if (typeof item === 'string') return item
      if (!isFields(item)) return ''
      return typeof item.text === 'string'
        ? item.text
        : inlineText(item.content)
    })
    .join('')
}

function addLines(block: unknown, lines: string[]) {
  if (!isFields(block)) return
  const { content, props, children } = block
  if (isFields(content) && isList(content.rows)) {
    for (const row of content.rows) {
      const cells = isFields(row) && isList(row.cells) ? row.cells : []
      for (const cell of cells) {
        lines.push(inlineText(isFields(cell) ? cell.content : cell))
      }
    }
  } else {
    lines.push(inlineText(content))
  }
  if (isFields(props) && typeof props.caption === 'string') {
    lines.push(props.caption)
  }
  if (isList(children)) {
    for (const child of children) addLines(child, lines)
  }
}

/**
 * The text of the blocks as the backend keeps it: a line per block, per table
 * cell and per caption.
 */
function plainText(blocks: unknown[]): string {
  const lines: string[] = []
  for (const block of blocks) addLines(block, lines)
  return lines.filter(line => line.trim() !== '').join('\n')
}

// ts_rank's default weights of the words of the title, A, and of the text, B.
const TITLE_WEIGHT = 1
const TEXT_WEIGHT = 0.4

// ADR012: the last word typed matches as a prefix.
function queryOf(query: string) {
  const words = wordsOf(query)
  const tests = words.map((each, index) =>
    index === words.length - 1
      ? (word: string) => word.startsWith(each)
      : (word: string) => word === each
  )
  const finds = (word: string) => tests.some(test => test(word))
  return {
    matches: (pageWords: string[]) =>
      tests.length > 0 && tests.every(test => pageWords.some(test)),
    finds,
    /**
     * What the backend ranks a page by: how many of the words its title
     * holds, then ts_rank, which the fake stands in for with the words it
     * finds, weighed as ts_rank weighs the title and the text.
     */
    rankOf: (titleWords: string[], textWords: string[]) => ({
      inTitle: tests.filter(test => titleWords.some(test)).length,
      found:
        titleWords.filter(finds).length * TITLE_WEIGHT +
        textWords.filter(finds).length * TEXT_WEIGHT
    })
  }
}

/**
 * The value as the backend marks a title or a text: each word found between
 * the markers, and the markers the value holds itself as blanks.
 */
const markedOf = (value: string, finds: (word: string) => boolean) =>
  value
    .replaceAll(FOUND_START, ' ')
    .replaceAll(FOUND_END, ' ')
    .replace(WORD, word =>
      finds(word.toLowerCase()) ? `${FOUND_START}${word}${FOUND_END}` : word
    )

const WORDS_BEFORE = 5
const WORDS_AFTER = 8

/**
 * The backend's excerpt: the words of the marked text between blanks, five
 * before the first word found and eight after, with an ellipsis where the
 * text goes on, and none when the text holds none of the words found.
 */
function excerptOf(text: string, finds: (word: string) => boolean) {
  const words = markedOf(text, finds)
    .split(/\s+/u)
    .filter(word => word !== '')
  const first = words.findIndex(word => word.includes(FOUND_START))
  if (first === -1) return ''
  const from = Math.max(0, first - WORDS_BEFORE)
  const to = Math.min(words.length, first + 1 + WORDS_AFTER)
  return `${from > 0 ? '…' : ''}${words.slice(from, to).join(' ')}${to < words.length ? '…' : ''}`
}

// Answers like the network would: later, and with copies.
const answer = <T>(work: () => T): Promise<T> =>
  Promise.resolve().then(() => structuredClone(work()))

function checkText(value: string, max: number) {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > max) throw refuse('invalid_request')
  return trimmed
}

function checkDescription(value = '') {
  if (value.length > 500 || !storable(value)) throw refuse('invalid_request')
  return value
}

function checkGristUrl(value: string | undefined) {
  if (value === undefined) throw refuse('invalid_request')
  const url = URL.parse(value)
  if (!url) throw refuse('invalid_request')
  if (url.origin !== GRIST_ORIGIN) throw refuse('invalid_grist_url')
  return value
}

/** Text the backend keeps as sent: no NUL character, no lone surrogate. */
const storable = (text: string) =>
  !text.includes('\u0000') && text.isWellFormed()

function checkTitle(value: string) {
  const title = checkText(value, 200)
  if (!storable(title)) throw refuse('invalid_request')
  return title
}

function checkName(value: string) {
  const name = checkText(value, 100)
  if (!storable(name)) throw refuse('invalid_request')
  return name
}

// A block's address is its `url` prop, empty until the block is given one.
function urlAllowed(block: Fields, allowed: (url: URL) => boolean) {
  const url = isFields(block.props) ? block.props.url : undefined
  if (url === undefined || url === '') return true
  const address = typeof url === 'string' ? URL.parse(url) : null
  return address !== null && allowed(address)
}

/** The check of each type of object the blocks hold, by its `type`. */
function addressAllowed(fields: Fields) {
  switch (fields.type) {
    case 'link': {
      const href =
        typeof fields.href === 'string' ? URL.parse(fields.href) : null
      return (
        href !== null && ['http:', 'https:', 'mailto:'].includes(href.protocol)
      )
    }
    case 'image':
    case 'video':
    case 'audio':
    case 'file':
      return urlAllowed(fields, url => url.protocol === 'https:')
    case 'gristEmbed':
      return urlAllowed(fields, url => url.origin === GRIST_ORIGIN)
    default:
      return true
  }
}

const MAX_BLOCKS_BYTES = 2 * 1024 * 1024

/** The blocks as sent, or `invalid_content` on the checks of docs/api.md. */
function checkBlocks(blocks: Block[]) {
  const json = JSON.stringify(blocks)
  if (new TextEncoder().encode(json).length > MAX_BLOCKS_BYTES) {
    throw refuse('invalid_content')
  }
  // Every object and string of the blocks, wherever it sits.
  const pending: unknown[] = [...blocks]
  while (pending.length > 0) {
    const value = pending.pop()
    if (typeof value === 'string') {
      if (!storable(value)) throw refuse('invalid_content')
    } else if (isList(value)) {
      for (const item of value) pending.push(item)
    } else if (isFields(value)) {
      if (!Object.keys(value).every(storable) || !addressAllowed(value)) {
        throw refuse('invalid_content')
      }
      for (const field of Object.values(value)) pending.push(field)
    }
  }
  return blocks
}

function positionBetween(
  siblings: StoredPage[],
  afterId?: string,
  beforeId?: string
) {
  const after = afterId ? siblings.findIndex(page => page.id === afterId) : -1
  const before = beforeId
    ? siblings.findIndex(page => page.id === beforeId)
    : -1
  if ((afterId && after < 0) || (beforeId && before < 0)) {
    throw refuse('stale_neighbours')
  }
  if (afterId && beforeId && before !== after + 1) {
    throw refuse('stale_neighbours')
  }
  const lower = afterId
    ? siblings[after]
    : beforeId
      ? siblings[before - 1]
      : siblings.at(-1)
  const upper = afterId
    ? siblings[after + 1]
    : beforeId
      ? siblings[before]
      : undefined
  return generateKeyBetween(lower?.position ?? null, upper?.position ?? null)
}

const currentOf = (page: StoredPage) => {
  const version = page.versions.at(-1)
  if (!version) throw new Error(`Page ${page.id} has no version`)
  return version
}

const summaryOfVersion = ({
  number,
  title,
  author,
  createdAt,
  restoredFrom
}: Version): VersionSummary => ({
  number,
  title,
  author,
  createdAt,
  restoredFrom
})

const commentFor = ({
  id,
  parentId,
  author,
  body,
  createdAt,
  editedAt
}: StoredComment): Comment => ({
  id,
  parentId,
  author,
  body,
  createdAt,
  editedAt
})

/** The fake backend, signed in as Alice Martin, the person of fakeSession. */
export function fakePagesApi(): FakePagesApi {
  const world: World = {
    people: new Map(),
    wikis: new Map(),
    pages: new Map(),
    comments: new Map(),
    notifications: [],
    listeners: new Map(),
    apis: new Map()
  }
  return signedIn(world, personFor(world, 'alice@example.com', 'Alice Martin'))
}

function personFor(world: World, email: string, name: string | null = null) {
  const key = email.toLowerCase()
  const known = world.people.get(key)
  if (known) {
    if (name !== null) known.name = name
    return known
  }
  const person: Person = { id: nextId(), email: key, name }
  world.people.set(key, person)
  return person
}

function signedIn(world: World, person: Person): FakePagesApi {
  const known = world.apis.get(person.id)
  if (known) return known

  const wikiOf = (wikiId: string) => {
    const wiki = world.wikis.get(wikiId)
    return wiki && !wiki.deleted ? wiki : undefined
  }

  const access = (wikiId: string, needed: Role = 'viewer') => {
    const wiki = wikiOf(wikiId)
    const role = wiki?.members.get(person.id)?.role
    if (!wiki || !role) throw refuse('not_found')
    if (ROLES.indexOf(role) < ROLES.indexOf(needed)) throw refuse('forbidden')
    return { wiki, role }
  }

  const pageAccess = (pageId: string, needed: Role = 'viewer') => {
    const page = world.pages.get(pageId)
    if (!page) throw refuse('not_found')
    return { page, ...access(page.wikiId, needed) }
  }

  const liveAccess = (pageId: string, needed: Role = 'editor') => {
    const found = pageAccess(pageId, needed)
    if (found.page.deletion) throw refuse('in_trash')
    return found
  }

  const commentAccess = (commentId: string) => {
    const comment = world.comments.get(commentId)
    if (!comment) throw refuse('not_found')
    return { comment, ...pageAccess(comment.pageId) }
  }

  const mentionedIn = (wiki: StoredWiki, body: string) => {
    const emails = mentionsIn(body)
    return [...wiki.members.values()]
      .map(member => member.person)
      .filter(member => emails.includes(member.email))
  }

  const bump = (wiki: StoredWiki) => {
    wiki.version += 1
    for (const listener of world.listeners.get(wiki.id) ?? []) {
      listener(wiki.version)
    }
  }

  const notify = (
    page: StoredPage,
    wiki: StoredWiki,
    recipients: Iterable<string>,
    fields: Pick<StoredNotification, 'reason' | 'version' | 'commentId'>
  ) => {
    for (const userId of recipients) {
      if (userId === person.id || !wiki.members.has(userId)) continue
      world.notifications.push({
        ...fields,
        id: nextId(),
        userId,
        pageId: page.id,
        actor: { ...person },
        createdAt: now(),
        readAt: null
      })
    }
  }

  const myNotifications = () =>
    world.notifications
      .flatMap(stored => {
        const page = world.pages.get(stored.pageId)
        const wiki = page && wikiOf(page.wikiId)
        const seen =
          stored.userId === person.id &&
          wiki?.members.has(person.id) &&
          (stored.commentId === null || world.comments.has(stored.commentId))
        return page && wiki && seen ? [{ stored, page, wiki }] : []
      })
      .reverse()

  const unreadNotifications = () =>
    myNotifications().filter(({ stored }) => stored.readAt === null)

  const wikiRefOf = (wiki: StoredWiki) => ({
    id: wiki.id,
    name: wiki.name,
    kind: wiki.kind
  })

  const notificationFor = ({
    stored,
    page,
    wiki
  }: ReturnType<typeof myNotifications>[number]): Notification => ({
    id: stored.id,
    reason: stored.reason,
    page: { id: page.id, title: currentOf(page).title },
    wiki: wikiRefOf(wiki),
    actor: stored.actor,
    version: stored.version,
    commentId: stored.commentId,
    createdAt: stored.createdAt,
    readAt: stored.readAt
  })

  const summaryOf = (wiki: StoredWiki, role: Role): WikiSummary => ({
    id: wiki.id,
    name: wiki.name,
    description: wiki.description,
    kind: wiki.kind,
    role,
    homePageId: wiki.homePageId,
    unread: unreadNotifications().filter(each => each.wiki === wiki).length
  })

  const wikiFor = (wikiId: string): Wiki => {
    const { wiki, role } = access(wikiId)
    return { ...summaryOf(wiki, role), version: wiki.version }
  }

  const pagesOf = (wikiId: string) =>
    [...world.pages.values()].filter(page => page.wikiId === wikiId)

  const livePagesOf = (wikiId: string) =>
    pagesOf(wikiId).filter(page => !page.deletion)

  const siblingsOf = (wikiId: string, parentId: string | null) =>
    livePagesOf(wikiId)
      .filter(page => !page.home && page.parentId === parentId)
      .sort(byPosition)

  const parentFor = (wikiId: string, parentId: string | null) => {
    if (parentId === null) return undefined
    const parent = world.pages.get(parentId)
    if (parent?.wikiId !== wikiId || parent.home || parent.deletion) {
      throw refuse('invalid_parent')
    }
    return parent
  }

  const parentOf = (page: StoredPage) =>
    page.parentId === null ? undefined : world.pages.get(page.parentId)

  const lineOf = (page: StoredPage) => {
    const line = [page]
    for (let parent = parentOf(page); parent; parent = parentOf(parent)) {
      line.push(parent)
    }
    return line
  }

  const placementFor = (wikiId: string, move: Move, moving?: StoredPage) => {
    const parent = parentFor(wikiId, move.parentId)
    if (moving && parent && lineOf(parent).includes(moving)) {
      throw refuse('invalid_parent')
    }
    // The client names the neighbours it sees once the page is lifted out.
    const siblings = siblingsOf(wikiId, move.parentId).filter(
      sibling => sibling !== moving
    )
    return {
      parentId: move.parentId,
      position: positionBetween(siblings, move.afterId, move.beforeId)
    }
  }

  const ancestorsOf = (page: StoredPage) =>
    lineOf(page)
      .slice(1)
      .reverse()
      .map(ancestor => ({ id: ancestor.id, title: currentOf(ancestor).title }))

  const descendantsOf = (page: StoredPage) =>
    pagesOf(page.wikiId).filter(
      other => other !== page && lineOf(other).includes(page)
    )

  const branchOf = (root: StoredPage) =>
    pagesOf(root.wikiId).filter(page => page.deletion?.rootId === root.id)

  const myLivePages = () =>
    [...world.pages.values()].flatMap(page => {
      const wiki = wikiOf(page.wikiId)
      return wiki?.members.has(person.id) && !page.deletion
        ? [{ page, wiki }]
        : []
    })

  const refOf = ({
    page,
    wiki
  }: {
    page: StoredPage
    wiki: StoredWiki
  }): PageRef => ({
    id: page.id,
    title: currentOf(page).title,
    wiki: wikiRefOf(wiki)
  })

  const pageFor = (page: StoredPage): Page => {
    const version = currentOf(page)
    return {
      id: page.id,
      wikiId: page.wikiId,
      parentId: page.parentId,
      home: page.home,
      kind: page.kind,
      title: version.title,
      content: version.content,
      gristUrl: version.gristUrl,
      version: version.number,
      createdAt: page.createdAt,
      createdBy: page.createdBy,
      updatedAt: version.createdAt,
      updatedBy: version.author,
      labels: page.labels,
      ancestors: ancestorsOf(page),
      following: page.followers.has(person.id),
      favorite: page.favoredBy.has(person.id),
      deletedAt: page.deletion?.at ?? null,
      trashRootId: page.deletion?.rootId ?? null
    }
  }

  const makePage = (
    wiki: StoredWiki,
    fields: Content & {
      kind: PageKind
      parentId: string | null
      position: string
    },
    home = false
  ) => {
    const createdAt = now()
    const author = { ...person }
    const page: StoredPage = {
      id: nextId(),
      wikiId: wiki.id,
      parentId: fields.parentId,
      home,
      kind: fields.kind,
      position: fields.position,
      createdAt,
      createdBy: author,
      versions: [
        {
          number: 1,
          title: fields.title,
          author,
          createdAt,
          restoredFrom: null,
          content: fields.content,
          gristUrl: fields.gristUrl
        }
      ],
      followers: new Set([person.id]),
      favoredBy: new Map(),
      visitedBy: new Map(),
      labels: [],
      deletion: null
    }
    world.pages.set(page.id, page)
    // A home page comes with its wiki, which starts at version 0 as the
    // backend's does.
    if (!home) bump(wiki)
    return page
  }

  const addVersion = (
    page: StoredPage,
    wiki: StoredWiki,
    fields: Content,
    restoredFrom: number | null = null
  ) => {
    const number = currentOf(page).number + 1
    page.versions.push({
      ...fields,
      number,
      author: { ...person },
      createdAt: now(),
      restoredFrom
    })
    page.followers.add(person.id)
    notify(page, wiki, page.followers, {
      reason: 'published',
      version: number,
      commentId: null
    })
    bump(wiki)
  }

  const makeWiki = (name: string, description: string, kind: WikiKind) => {
    const wiki: StoredWiki = {
      id: nextId(),
      name,
      description,
      kind,
      version: 0,
      createdBy: person.id,
      deleted: false,
      homePageId: '',
      members: new Map([
        [person.id, { person, role: 'admin', joinedAt: now() }]
      ]),
      invites: []
    }
    world.wikis.set(wiki.id, wiki)
    const home = makePage(
      wiki,
      {
        title: name,
        kind: 'document',
        parentId: null,
        position: '',
        content: [],
        gristUrl: null
      },
      true
    )
    wiki.homePageId = home.id
    return wiki
  }

  const personalWiki = () =>
    [...world.wikis.values()].find(
      wiki => wiki.kind === 'personal' && wiki.createdBy === person.id
    ) ?? makeWiki('Personal', '', 'personal')

  const claimInvites = () => {
    for (const wiki of world.wikis.values()) {
      const invite = wiki.invites.find(each => each.email === person.email)
      if (!invite) continue
      wiki.invites = wiki.invites.filter(each => each !== invite)
      if (!wiki.members.has(person.id)) {
        wiki.members.set(person.id, {
          person,
          role: invite.role,
          joinedAt: now()
        })
      }
      bump(wiki)
    }
  }

  const isManaged = (wiki: StoredWiki) => wiki.kind !== 'shared'

  const sharedWiki = (wikiId: string) => {
    const { wiki } = access(wikiId, 'admin')
    if (isManaged(wiki)) throw refuse('managed')
    return wiki
  }

  const keepAnAdmin = (wiki: StoredWiki, leaving: string) => {
    const others = [...wiki.members].filter(
      ([userId, member]) => userId !== leaving && member.role === 'admin'
    )
    if (others.length === 0) throw refuse('last_admin')
  }

  const memberOf = ({
    person: member,
    role,
    joinedAt
  }: Membership): Member => ({
    ...member,
    role,
    joinedAt
  })

  const mocks: Mocks = {
    settings: vi.fn<PagesApi['settings']>(() =>
      Promise.resolve({ ...NO_SETTINGS })
    ),
    watchSettings: vi.fn<PagesApi['watchSettings']>(() => () => undefined),

    listWikis: vi.fn<PagesApi['listWikis']>(() =>
      answer(() => {
        personalWiki()
        claimInvites()
        return [...world.wikis.values()]
          .flatMap(wiki => {
            const role = wiki.members.get(person.id)?.role
            return !wiki.deleted && role ? [summaryOf(wiki, role)] : []
          })
          .sort(
            (a, b) =>
              Number(b.kind === 'personal') - Number(a.kind === 'personal') ||
              a.name.localeCompare(b.name)
          )
      })
    ),
    createWiki: vi.fn<PagesApi['createWiki']>(wiki =>
      answer(() => {
        const made = makeWiki(
          checkName(wiki.name),
          checkDescription(wiki.description),
          'shared'
        )
        return wikiFor(made.id)
      })
    ),
    getWiki: vi.fn<PagesApi['getWiki']>(wikiId =>
      answer(() => wikiFor(wikiId))
    ),
    renameWiki: vi.fn<PagesApi['renameWiki']>((wikiId, changes) =>
      answer(() => {
        const { wiki } = access(wikiId, 'admin')
        if (changes.name !== undefined && wiki.kind === 'space') {
          throw refuse('managed')
        }
        // Both checked before either changes: the backend checks the whole
        // edit before it writes it.
        const name =
          changes.name === undefined ? wiki.name : checkName(changes.name)
        const description =
          changes.description === undefined
            ? wiki.description
            : checkDescription(changes.description)
        Object.assign(wiki, { name, description })
        bump(wiki)
        return wikiFor(wikiId)
      })
    ),
    deleteWiki: vi.fn<PagesApi['deleteWiki']>(wikiId =>
      answer(() => {
        const { wiki } = access(wikiId, 'admin')
        if (isManaged(wiki)) throw refuse('managed')
        wiki.deleted = true
        // Its members reload it, and find it gone.
        bump(wiki)
      })
    ),
    getTree: vi.fn<PagesApi['getTree']>(wikiId =>
      answer(() => {
        const { wiki } = access(wikiId)
        const pages = livePagesOf(wikiId)
          .filter(page => !page.home)
          .sort(byPosition)
          .map((page): TreePage => ({
            id: page.id,
            parentId: page.parentId,
            position: page.position,
            title: currentOf(page).title,
            kind: page.kind
          }))
        return { version: wiki.version, pages }
      })
    ),
    watchWiki: vi.fn<PagesApi['watchWiki']>((wikiId, onVersion) => {
      const wiki = wikiOf(wikiId)
      if (!wiki?.members.has(person.id)) return () => undefined
      const listeners = world.listeners.get(wikiId) ?? new Set()
      world.listeners.set(wikiId, listeners.add(onVersion))
      onVersion(wiki.version)
      return () => {
        listeners.delete(onVersion)
      }
    }),

    getMembers: vi.fn<PagesApi['getMembers']>(wikiId =>
      answer(() => {
        const { wiki, role } = access(wikiId)
        return {
          members: [...wiki.members.values()].map(memberOf).sort(byEmail),
          invites: role === 'admin' ? wiki.invites.toSorted(byEmail) : [],
          managed: isManaged(wiki)
        }
      })
    ),
    invite: vi.fn<PagesApi['invite']>((wikiId, email, role) =>
      answer(() => {
        const address = checkEmail(email)
        const wiki = sharedWiki(wikiId)
        if (domainOf(address) !== domainOf(person.email)) {
          throw refuse('not_same_organization')
        }
        const members = [...wiki.members.values()]
        if (!members.some(member => member.person.email === address)) {
          const invite = wiki.invites.find(each => each.email === address)
          if (invite) invite.role = role
          else {
            wiki.invites.push({
              id: nextId(),
              email: address,
              role,
              createdAt: now()
            })
          }
        }
        // The email of a member changes nothing, yet the version moves, as
        // the backend's does.
        bump(wiki)
      })
    ),
    cancelInvite: vi.fn<PagesApi['cancelInvite']>((wikiId, inviteId) =>
      answer(() => {
        const wiki = sharedWiki(wikiId)
        wiki.invites = wiki.invites.filter(invite => invite.id !== inviteId)
        bump(wiki)
      })
    ),
    setMemberRole: vi.fn<PagesApi['setMemberRole']>((wikiId, userId, role) =>
      answer(() => {
        const wiki = sharedWiki(wikiId)
        if (role !== 'admin') keepAnAdmin(wiki, userId)
        const member = wiki.members.get(userId)
        if (!member) throw refuse('not_found')
        member.role = role
        bump(wiki)
      })
    ),
    removeMember: vi.fn<PagesApi['removeMember']>((wikiId, userId) =>
      answer(() => {
        const wiki =
          userId === person.id ? access(wikiId).wiki : sharedWiki(wikiId)
        if (isManaged(wiki)) throw refuse('managed')
        keepAnAdmin(wiki, userId)
        if (!wiki.members.delete(userId)) throw refuse('not_found')
        // Their favorites and visits of its pages go with them, as the
        // backend's do.
        for (const page of pagesOf(wikiId)) {
          page.favoredBy.delete(userId)
          page.visitedBy.delete(userId)
        }
        bump(wiki)
      })
    ),
    searchPeople: vi.fn<PagesApi['searchPeople']>(query =>
      answer(() => {
        const trimmed = query.trim()
        if (trimmed === '' || trimmed.length > 200) {
          throw refuse('invalid_request')
        }
        const term = trimmed.toLowerCase()
        // Those a personal wiki tells signed in, as the backend finds them.
        const signedIn = new Set(
          [...world.wikis.values()]
            .filter(wiki => wiki.kind === 'personal')
            .map(wiki => wiki.createdBy)
        )
        // The backend finds them in the person's organization, which has one
        // mail domain: the fake has no organizations, but domains.
        const domain = domainOf(person.email)
        return [...world.people.values()]
          .filter(
            each =>
              each.id !== person.id &&
              signedIn.has(each.id) &&
              domainOf(each.email) === domain &&
              (each.email.includes(term) ||
                (each.name?.toLowerCase().includes(term) ?? false))
          )
          .sort(byEmail)
          .slice(0, 10)
          .map(({ email, name }) => ({ email, name }))
      })
    ),

    createPage: vi.fn<PagesApi['createPage']>((wikiId, input) =>
      answer(() => {
        const { wiki } = access(wikiId, 'editor')
        const title = checkTitle(input.title)
        const placement = placementFor(wikiId, input)
        const body =
          input.kind === 'database'
            ? { content: [], gristUrl: checkGristUrl(input.gristUrl) }
            : { content: checkBlocks(input.content ?? []), gristUrl: null }
        const page = makePage(wiki, {
          ...body,
          ...placement,
          title,
          kind: input.kind
        })
        return pageFor(page)
      })
    ),
    getPage: vi.fn<PagesApi['getPage']>(pageId =>
      answer(() => {
        const { page } = pageAccess(pageId)
        page.visitedBy.set(person.id, now())
        // The backend keeps the person's 100 latest visits, those of pages in
        // the trash and of wikis they left among them.
        const visits = [...world.pages.values()]
          .flatMap(visited => {
            const at = visited.visitedBy.get(person.id)
            return at ? [{ visited, at }] : []
          })
          .sort((a, b) => (a.at < b.at ? 1 : -1))
        for (const { visited } of visits.slice(100)) {
          visited.visitedBy.delete(person.id)
        }
        return pageFor(page)
      })
    ),
    publish: vi.fn<PagesApi['publish']>((pageId, draft) =>
      answer(() => {
        const title = checkTitle(draft.title)
        // As the backend, which checks them before it locks the wiki.
        const content = 'content' in draft ? checkBlocks(draft.content) : []
        const { page, wiki } = liveAccess(pageId)
        if ((page.kind === 'document') !== 'content' in draft) {
          throw refuse('invalid_request')
        }
        const latest = currentOf(page)
        if (draft.baseVersion !== latest.number) {
          throw new EditConflict(summaryOfVersion(latest))
        }
        addVersion(page, wiki, {
          title,
          content,
          gristUrl: 'gristUrl' in draft ? checkGristUrl(draft.gristUrl) : null
        })
        return pageFor(page)
      })
    ),
    listVersions: vi.fn<PagesApi['listVersions']>(pageId =>
      answer(() =>
        pageAccess(pageId).page.versions.toReversed().map(summaryOfVersion)
      )
    ),
    getVersion: vi.fn<PagesApi['getVersion']>((pageId, number) =>
      answer(() => {
        const { page } = pageAccess(pageId)
        const version = page.versions.find(each => each.number === number)
        if (!version) throw refuse('not_found')
        return version
      })
    ),
    restoreVersion: vi.fn<PagesApi['restoreVersion']>((pageId, number) =>
      answer(() => {
        // As the backend, which checks the version as a draft once its page is
        // in the person's reach, before it locks the wiki.
        const { page } = pageAccess(pageId)
        const version = page.versions.find(each => each.number === number)
        if (!version) throw refuse('not_found')
        const content = checkBlocks(version.content)
        const gristUrl =
          version.gristUrl === null ? null : checkGristUrl(version.gristUrl)
        const { wiki } = liveAccess(pageId)
        addVersion(
          page,
          wiki,
          { title: version.title, content, gristUrl },
          number
        )
        return pageFor(page)
      })
    ),
    movePage: vi.fn<PagesApi['movePage']>((pageId, move) =>
      answer(() => {
        const { page, wiki } = liveAccess(pageId)
        if (page.home) throw refuse('home_page')
        const placement = placementFor(page.wikiId, move, page)
        page.parentId = placement.parentId
        page.position = placement.position
        bump(wiki)
        return placement
      })
    ),
    deletePage: vi.fn<PagesApi['deletePage']>(pageId =>
      answer(() => {
        const { page, wiki } = liveAccess(pageId)
        if (page.home) throw refuse('home_page')
        const deletion = { rootId: page.id, at: now(), by: { ...person } }
        for (const each of [page, ...descendantsOf(page)]) {
          // Descendants deleted before stay in their own branch.
          each.deletion ??= deletion
        }
        bump(wiki)
      })
    ),
    setLabels: vi.fn<PagesApi['setLabels']>((pageId, names) =>
      answer(() => {
        // The backend checks the body before it looks for the page.
        if (names.length > MAX_LABELS) throw refuse('invalid_request')
        const { page, wiki } = liveAccess(pageId)
        page.labels = [...new Set(names.map(checkLabel))].sort(byName)
        bump(wiki)
        return page.labels
      })
    ),
    setFollowing: vi.fn<PagesApi['setFollowing']>((pageId, following) =>
      answer(() => {
        const { page } = pageAccess(pageId)
        if (following) page.followers.add(person.id)
        else page.followers.delete(person.id)
      })
    ),
    setFavorite: vi.fn<PagesApi['setFavorite']>((pageId, favorite) =>
      answer(() => {
        const { page } = pageAccess(pageId)
        if (!favorite) page.favoredBy.delete(person.id)
        else if (!page.favoredBy.has(person.id)) {
          page.favoredBy.set(person.id, now())
        }
      })
    ),

    listTrash: vi.fn<PagesApi['listTrash']>(wikiId =>
      answer(() => {
        access(wikiId)
        return pagesOf(wikiId)
          .flatMap(page =>
            page.deletion?.rootId === page.id
              ? [{ root: page, deletion: page.deletion }]
              : []
          )
          .sort((a, b) => (a.deletion.at < b.deletion.at ? 1 : -1))
          .map(({ root, deletion }): TrashEntry => ({
            id: root.id,
            title: currentOf(root).title,
            deletedAt: deletion.at,
            deletedBy: deletion.by,
            descendants: branchOf(root).length - 1
          }))
      })
    ),
    restorePage: vi.fn<PagesApi['restorePage']>(pageId =>
      answer(() => {
        const { page, wiki } = pageAccess(pageId, 'editor')
        if (page.deletion?.rootId !== page.id) throw refuse('not_in_trash')
        const parent = parentOf(page)
        const parentId = parent && !parent.deletion ? parent.id : null
        const position = positionBetween(siblingsOf(page.wikiId, parentId))
        for (const each of branchOf(page)) each.deletion = null
        page.parentId = parentId
        page.position = position
        bump(wiki)
        return { parentId, position }
      })
    ),
    purgePage: vi.fn<PagesApi['purgePage']>((wikiId, pageId) =>
      answer(() => {
        const { wiki } = access(wikiId, 'admin')
        const page = world.pages.get(pageId)
        if (page?.wikiId !== wikiId) throw refuse('not_found')
        if (page.deletion?.rootId !== page.id) throw refuse('not_in_trash')
        for (const each of branchOf(page)) world.pages.delete(each.id)
        // As on the backend, a branch deleted before under the purged one
        // stays in the trash, and comes back at the top of the tree.
        for (const each of pagesOf(wikiId)) {
          if (!parentOf(each)) each.parentId = null
        }
        bump(wiki)
      })
    ),
    emptyTrash: vi.fn<PagesApi['emptyTrash']>(wikiId =>
      answer(() => {
        const { wiki } = access(wikiId, 'admin')
        for (const page of pagesOf(wikiId)) {
          if (page.deletion) world.pages.delete(page.id)
        }
        bump(wiki)
      })
    ),

    listLabels: vi.fn<PagesApi['listLabels']>(wikiId =>
      answer(() => {
        access(wikiId)
        const counts = new Map<string, number>()
        for (const page of livePagesOf(wikiId)) {
          for (const name of page.labels) {
            counts.set(name, (counts.get(name) ?? 0) + 1)
          }
        }
        return [...counts]
          .map(([name, pages]) => ({ name, pages }))
          .sort((a, b) => byName(a.name, b.name))
      })
    ),
    pagesWithLabel: vi.fn<PagesApi['pagesWithLabel']>((wikiId, name) =>
      answer(() => {
        access(wikiId)
        const label = labelNameOf(name)
        return livePagesOf(wikiId)
          .filter(page => label !== null && page.labels.includes(label))
          .map(page => {
            const { title, createdAt } = currentOf(page)
            return { id: page.id, title, updatedAt: createdAt }
          })
          .sort((a, b) => byName(a.title, b.title))
      })
    ),

    listComments: vi.fn<PagesApi['listComments']>(pageId =>
      answer(() => {
        const { page } = pageAccess(pageId)
        return [...world.comments.values()]
          .filter(comment => comment.pageId === page.id)
          .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
          .map(commentFor)
      })
    ),
    addComment: vi.fn<PagesApi['addComment']>((pageId, input) =>
      answer(() => {
        const body = checkText(input.body, 10_000)
        const { page, wiki } = liveAccess(pageId, 'viewer')
        const parentId = input.parentId ?? null
        if (parentId !== null) {
          const parent = world.comments.get(parentId)
          if (parent?.pageId !== page.id || parent.parentId !== null) {
            throw refuse('invalid_request')
          }
        }
        const comment: StoredComment = {
          id: nextId(),
          pageId: page.id,
          parentId,
          author: { ...person },
          body,
          createdAt: now(),
          editedAt: null
        }
        world.comments.set(comment.id, comment)
        page.followers.add(person.id)
        const mentioned = new Set(
          mentionedIn(wiki, body).map(member => member.id)
        )
        const told = { version: null, commentId: comment.id }
        notify(page, wiki, mentioned, { ...told, reason: 'mentioned' })
        notify(
          page,
          wiki,
          [...page.followers].filter(userId => !mentioned.has(userId)),
          { ...told, reason: 'commented' }
        )
        for (const userId of mentioned) page.followers.add(userId)
        bump(wiki)
        return commentFor(comment)
      })
    ),
    editComment: vi.fn<PagesApi['editComment']>((commentId, body) =>
      answer(() => {
        const edited = checkText(body, 10_000)
        const { comment, page, wiki } = commentAccess(commentId)
        if (comment.author.id !== person.id) throw refuse('forbidden')
        if (page.deletion) throw refuse('in_trash')
        comment.body = edited
        comment.editedAt = now()
        bump(wiki)
        return commentFor(comment)
      })
    ),
    deleteComment: vi.fn<PagesApi['deleteComment']>(commentId =>
      answer(() => {
        const { comment, wiki, role } = commentAccess(commentId)
        if (comment.author.id !== person.id && role !== 'admin') {
          throw refuse('forbidden')
        }
        for (const each of world.comments.values()) {
          if (each === comment || each.parentId === comment.id) {
            world.comments.delete(each.id)
          }
        }
        bump(wiki)
      })
    ),

    listNotifications: vi.fn<PagesApi['listNotifications']>(() =>
      answer(() => ({
        notifications: myNotifications().slice(0, 100).map(notificationFor),
        unread: unreadNotifications().length
      }))
    ),
    markRead: vi.fn<PagesApi['markRead']>(selection =>
      answer(() => {
        const readAt = now()
        for (const { stored, wiki } of myNotifications()) {
          const selected =
            'all' in selection ||
            ('wikiId' in selection
              ? wiki.id === selection.wikiId
              : selection.ids.includes(stored.id))
          if (selected) stored.readAt ??= readAt
        }
      })
    ),
    badges: vi.fn<PagesApi['badges']>(() =>
      answer(() => {
        const counts = new Map<string, number>()
        for (const { wiki } of unreadNotifications()) {
          counts.set(wiki.id, (counts.get(wiki.id) ?? 0) + 1)
        }
        return [...counts].map(([wikiId, count]) => ({ wikiId, count }))
      })
    ),

    favorites: vi.fn<PagesApi['favorites']>(() =>
      answer(() =>
        myLivePages()
          .flatMap(seen => {
            const markedAt = seen.page.favoredBy.get(person.id)
            return markedAt ? [{ seen, markedAt }] : []
          })
          .sort((a, b) => (a.markedAt < b.markedAt ? 1 : -1))
          .map(({ seen }) => refOf(seen))
      )
    ),
    recent: vi.fn<PagesApi['recent']>(() =>
      answer(() =>
        myLivePages()
          .flatMap(seen => {
            const visitedAt = seen.page.visitedBy.get(person.id)
            return visitedAt ? [{ ...refOf(seen), visitedAt }] : []
          })
          .sort((a, b) => (a.visitedAt < b.visitedAt ? 1 : -1))
          .slice(0, 20)
      )
    ),
    // api.md ranks the pages whose titles hold more of the words first, then
    // by ts_rank, then the last published first. The backend checks the text
    // as a title, before the wiki.
    search: vi.fn<PagesApi['search']>((query, wikiId) =>
      answer(() => {
        const { matches, finds, rankOf } = queryOf(checkTitle(query))
        if (wikiId !== undefined) access(wikiId)
        return myLivePages()
          .filter(seen => wikiId === undefined || seen.wiki.id === wikiId)
          .flatMap(seen => {
            const { title, content, createdAt } = currentOf(seen.page)
            const text = plainText(content)
            const titleWords = wordsOf(title)
            const textWords = wordsOf(text)
            if (!matches([...titleWords, ...textWords])) return []
            return [
              {
                result: {
                  page: refOf(seen),
                  markedTitle: markedOf(title, finds),
                  excerpt: excerptOf(text, finds),
                  updatedAt: createdAt
                },
                ...rankOf(titleWords, textWords)
              }
            ]
          })
          .sort(
            (a, b) =>
              b.inTitle - a.inTitle ||
              b.found - a.found ||
              (a.result.updatedAt < b.result.updatedAt ? 1 : -1)
          )
          .slice(0, 50)
          .map(({ result }) => result)
      })
    )
  }

  const api: FakePagesApi = {
    ...mocks,
    person,
    signedInAs: (email, name = null) =>
      signedIn(world, personFor(world, email, name)),
    withWiki: ({
      name = 'Handbook',
      kind = 'shared',
      role = 'admin',
      members = {}
    } = {}) => {
      const wiki =
        kind === 'personal' ? personalWiki() : makeWiki(name, '', kind)
      wiki.members.set(person.id, { person, role, joinedAt: now() })
      for (const [email, memberRole] of Object.entries(members)) {
        const member = personFor(world, email)
        wiki.members.set(member.id, {
          person: member,
          role: memberRole,
          joinedAt: now()
        })
      }
      return structuredClone(wikiFor(wiki.id))
    },
    withPage: (wikiId, seed = {}) => {
      const wiki = wikiOf(wikiId)
      if (!wiki) throw new Error(`No wiki ${wikiId}`)
      const kind = seed.kind ?? 'document'
      const parentId = seed.parentId ?? null
      const page = makePage(wiki, {
        title: seed.title ?? 'Untitled',
        kind,
        parentId,
        position: positionBetween(siblingsOf(wikiId, parentId)),
        content: seed.content ?? [],
        gristUrl:
          seed.gristUrl ??
          (kind === 'database' ? `${GRIST_ORIGIN}/o/docs/untitled` : null)
      })
      return structuredClone(pageFor(page))
    }
  }
  world.apis.set(person.id, api)
  return api
}
