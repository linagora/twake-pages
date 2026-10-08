import { vi, type Mock } from 'vitest'

import {
  ApiError,
  EditConflict,
  type PagesApi,
  type Refusal,
  type UserSettings
} from '@/application/pages'
import type {
  Block,
  Page,
  PageKind,
  TreePage,
  Version,
  VersionSummary
} from '@/domain/page'
import type { Person } from '@/domain/person'
import type {
  Invite,
  Member,
  Role,
  Wiki,
  WikiKind,
  WikiSummary
} from '@/domain/wiki'
import { keyBetween } from '@/testing/fractionalKey'

type Mocks = { [Key in keyof PagesApi]: Mock<PagesApi[Key]> }

export interface WikiSeed {
  name?: string
  description?: string
  kind?: WikiKind
  /** The role of the person signed in; admin by default. */
  role?: Role
  /** Other members, by email. */
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
  /** The same backend, seen by someone who signs in with this name. */
  signedInAs: (email: string, name?: string | null) => FakePagesApi
  /** A wiki made by the person, who has `role` on it. */
  withWiki: (seed?: WikiSeed) => Wiki
  /** A page the person wrote, last under its parent. */
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

/** The fake backend's GRIST_ORIGINS: database pages frame documents from it. */
export const GRIST_ORIGIN = 'https://grist.example.com'

/** A paragraph, as BlockNote stores it. */
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

const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 }

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
  /** By person id. */
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
  /** Oldest first: the last one is the page's current version. */
  versions: Version[]
  /** By person id. */
  followers: Set<string>
}

interface World {
  people: Map<string, Person>
  wikis: Map<string, StoredWiki>
  pages: Map<string, StoredPage>
  watchers: Map<string, Set<(version: number) => void>>
  apis: Map<string, FakePagesApi>
}

interface Content {
  title: string
  content: Block[]
  gristUrl: string | null
}

const byPosition = (a: { position: string }, b: { position: string }) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0

const byEmail = (a: { email: string }, b: { email: string }) =>
  a.email.localeCompare(b.email)

// Answers like the network would: later, and with copies.
const answer = <T>(work: () => T): Promise<T> =>
  Promise.resolve().then(() => structuredClone(work()))

function text(value: string, max: number) {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > max) throw refuse('invalid_request')
  return trimmed
}

function description(value = '') {
  const trimmed = value.trim()
  if (trimmed.length > 500) throw refuse('invalid_request')
  return trimmed
}

function gristAddress(value: string | undefined) {
  if (value === undefined) throw refuse('invalid_request')
  const url = URL.parse(value)
  if (!url) throw refuse('invalid_request')
  if (url.origin !== GRIST_ORIGIN) throw refuse('invalid_grist_url')
  return value
}

// As the backend does: the neighbours must still be next to each other.
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
  return keyBetween(lower?.position ?? null, upper?.position ?? null)
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

/** The fake backend, signed in as Alice Martin, the person of fakeSession. */
export function fakePagesApi(): FakePagesApi {
  const world: World = {
    people: new Map(),
    wikis: new Map(),
    pages: new Map(),
    watchers: new Map(),
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

  // Not found unless the person is a member; forbidden below `needed`.
  const access = (wikiId: string, needed: Role = 'viewer') => {
    const wiki = wikiOf(wikiId)
    const role = wiki?.members.get(person.id)?.role
    if (!wiki || !role) throw refuse('not_found')
    if (RANK[role] < RANK[needed]) throw refuse('forbidden')
    return { wiki, role }
  }

  const pageAccess = (pageId: string, needed: Role = 'viewer') => {
    const page = world.pages.get(pageId)
    if (!page) throw refuse('not_found')
    return { page, ...access(page.wikiId, needed) }
  }

  const bump = (wiki: StoredWiki) => {
    wiki.version += 1
    for (const listener of world.watchers.get(wiki.id) ?? []) {
      listener(wiki.version)
    }
  }

  const summaryOf = (wiki: StoredWiki, role: Role): WikiSummary => ({
    id: wiki.id,
    name: wiki.name,
    description: wiki.description,
    kind: wiki.kind,
    role,
    homePageId: wiki.homePageId,
    unread: 0
  })

  const wikiFor = (wikiId: string): Wiki => {
    const { wiki, role } = access(wikiId)
    return { ...summaryOf(wiki, role), version: wiki.version }
  }

  const pagesOf = (wikiId: string) =>
    [...world.pages.values()].filter(page => page.wikiId === wikiId)

  const siblingsOf = (wikiId: string, parentId: string | null) =>
    pagesOf(wikiId)
      .filter(page => !page.home && page.parentId === parentId)
      .sort(byPosition)

  const checkParent = (wikiId: string, parentId: string | null) => {
    if (parentId === null) return
    const parent = world.pages.get(parentId)
    if (parent?.wikiId !== wikiId || parent.home) {
      throw refuse('invalid_parent')
    }
  }

  const ancestorsOf = (page: StoredPage) => {
    const ancestors: { id: string; title: string }[] = []
    let parent = page.parentId ? world.pages.get(page.parentId) : undefined
    while (parent) {
      ancestors.unshift({ id: parent.id, title: currentOf(parent).title })
      parent = parent.parentId ? world.pages.get(parent.parentId) : undefined
    }
    return ancestors
  }

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
      labels: [],
      ancestors: ancestorsOf(page),
      following: page.followers.has(person.id),
      favorite: false,
      deletedAt: null
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
      followers: new Set([person.id])
    }
    world.pages.set(page.id, page)
    bump(wiki)
    return page
  }

  const addVersion = (
    page: StoredPage,
    wiki: StoredWiki,
    fields: Content,
    restoredFrom: number | null = null
  ) => {
    page.versions.push({
      ...fields,
      number: currentOf(page).number + 1,
      author: { ...person },
      createdAt: now(),
      restoredFrom
    })
    page.followers.add(person.id)
    bump(wiki)
  }

  const makeWiki = (name: string, wikiDescription: string, kind: WikiKind) => {
    const wiki: StoredWiki = {
      id: nextId(),
      name,
      description: wikiDescription,
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

  // An invitation becomes a membership once its email signs in and looks.
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

  const sharedWiki = (wikiId: string) => {
    const { wiki } = access(wikiId, 'admin')
    if (wiki.kind !== 'shared') throw refuse('managed')
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
          text(wiki.name, 100),
          description(wiki.description),
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
        if (changes.name !== undefined) wiki.name = text(changes.name, 100)
        if (changes.description !== undefined) {
          wiki.description = description(changes.description)
        }
        bump(wiki)
        return wikiFor(wikiId)
      })
    ),
    deleteWiki: vi.fn<PagesApi['deleteWiki']>(wikiId =>
      answer(() => {
        const { wiki } = access(wikiId, 'admin')
        if (wiki.kind !== 'shared') throw refuse('managed')
        wiki.deleted = true
      })
    ),
    getTree: vi.fn<PagesApi['getTree']>(wikiId =>
      answer(() => {
        const { wiki } = access(wikiId)
        const pages = pagesOf(wikiId)
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
      const listeners = world.watchers.get(wikiId) ?? new Set()
      world.watchers.set(wikiId, listeners.add(onVersion))
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
          managed: wiki.kind !== 'shared'
        }
      })
    ),
    invite: vi.fn<PagesApi['invite']>((wikiId, email, role) =>
      answer(() => {
        const wiki = sharedWiki(wikiId)
        const address = email.trim().toLowerCase()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(address)) {
          throw refuse('invalid_request')
        }
        const members = [...wiki.members.values()]
        if (members.some(member => member.person.email === address)) return
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
        bump(wiki)
      })
    ),
    cancelInvite: vi.fn<PagesApi['cancelInvite']>((wikiId, inviteId) =>
      answer(() => {
        const { wiki } = access(wikiId, 'admin')
        const kept = wiki.invites.filter(invite => invite.id !== inviteId)
        if (kept.length === wiki.invites.length) return
        wiki.invites = kept
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
        if (wiki.kind !== 'shared') throw refuse('managed')
        keepAnAdmin(wiki, userId)
        if (!wiki.members.delete(userId)) throw refuse('not_found')
        bump(wiki)
      })
    ),
    searchPeople: vi.fn<PagesApi['searchPeople']>(query =>
      answer(() => {
        const words = query.trim().toLowerCase()
        if (words === '') return []
        return [...world.people.values()]
          .filter(
            each =>
              each.email.includes(words) ||
              (each.name?.toLowerCase().includes(words) ?? false)
          )
          .sort(byEmail)
          .slice(0, 10)
          .map(({ email, name }) => ({ email, name }))
      })
    ),

    createPage: vi.fn<PagesApi['createPage']>((wikiId, input) =>
      answer(() => {
        const { wiki } = access(wikiId, 'editor')
        const title = text(input.title, 200)
        checkParent(wikiId, input.parentId)
        const position = positionBetween(
          siblingsOf(wikiId, input.parentId),
          input.afterId,
          input.beforeId
        )
        const body =
          input.kind === 'database'
            ? { content: [], gristUrl: gristAddress(input.gristUrl) }
            : { content: input.content ?? [], gristUrl: null }
        const page = makePage(wiki, {
          ...body,
          title,
          kind: input.kind,
          parentId: input.parentId,
          position
        })
        return pageFor(page)
      })
    ),
    getPage: vi.fn<PagesApi['getPage']>(pageId =>
      answer(() => pageFor(pageAccess(pageId).page))
    ),
    publish: vi.fn<PagesApi['publish']>((pageId, draft) =>
      answer(() => {
        const title = text(draft.title, 200)
        const { page, wiki } = pageAccess(pageId, 'editor')
        if ((page.kind === 'document') !== 'content' in draft) {
          throw refuse('invalid_request')
        }
        const latest = currentOf(page)
        if (draft.baseVersion !== latest.number) {
          throw new EditConflict(summaryOfVersion(latest))
        }
        addVersion(page, wiki, {
          title,
          content: 'content' in draft ? draft.content : [],
          gristUrl: 'gristUrl' in draft ? gristAddress(draft.gristUrl) : null
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
        const { page, wiki } = pageAccess(pageId, 'editor')
        const version = page.versions.find(each => each.number === number)
        if (!version) throw refuse('not_found')
        const { title, content, gristUrl } = version
        addVersion(page, wiki, { title, content, gristUrl }, number)
        return pageFor(page)
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
      description: seededDescription = '',
      kind = 'shared',
      role = 'admin',
      members = {}
    } = {}) => {
      const wiki =
        kind === 'personal'
          ? personalWiki()
          : makeWiki(name, seededDescription, kind)
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
