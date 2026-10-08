import { vi, type Mock } from 'vitest'

import {
  ApiError,
  type PagesApi,
  type Refusal,
  type UserSettings
} from '@/application/pages'
import type { Block, Page, PageKind, TreePage, Version } from '@/domain/page'
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
}

interface World {
  people: Map<string, Person>
  wikis: Map<string, StoredWiki>
  pages: Map<string, StoredPage>
  watchers: Map<string, Set<(version: number) => void>>
  apis: Map<string, FakePagesApi>
}

const byPosition = (a: { position: string }, b: { position: string }) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0

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

  const livePages = (wikiId: string) =>
    [...world.pages.values()].filter(page => page.wikiId === wikiId)

  const current = (page: StoredPage) => {
    const version = page.versions.at(-1)
    if (!version) throw new Error(`Page ${page.id} has no version`)
    return version
  }

  const pageFor = (page: StoredPage): Page => {
    const version = current(page)
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
      ancestors: [],
      following: false,
      favorite: false,
      deletedAt: null
    }
  }

  const makePage = (
    wiki: StoredWiki,
    seed: Required<Pick<PageSeed, 'title' | 'kind'>> & PageSeed,
    home = false
  ) => {
    const parentId = seed.parentId ?? null
    const last = livePages(wiki.id)
      .filter(page => !page.home && page.parentId === parentId)
      .sort(byPosition)
      .at(-1)
    const createdAt = now()
    const author = { ...person }
    const page: StoredPage = {
      id: nextId(),
      wikiId: wiki.id,
      parentId,
      home,
      kind: seed.kind,
      position: home ? '' : keyBetween(last?.position ?? null, null),
      createdAt,
      createdBy: author,
      versions: [
        {
          number: 1,
          title: seed.title,
          author,
          createdAt,
          restoredFrom: null,
          content: seed.content ?? [],
          gristUrl: seed.gristUrl ?? null
        }
      ]
    }
    world.pages.set(page.id, page)
    bump(wiki)
    return page
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
    wiki.homePageId = makePage(wiki, { title: name, kind: 'document' }, true).id
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

  const byEmail = (a: { email: string }, b: { email: string }) =>
    a.email.localeCompare(b.email)

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
        const pages = livePages(wikiId)
          .filter(page => !page.home)
          .sort(byPosition)
          .map((page): TreePage => ({
            id: page.id,
            parentId: page.parentId,
            position: page.position,
            title: current(page).title,
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
      const page = makePage(wiki, {
        ...seed,
        title: seed.title ?? 'Untitled',
        kind: seed.kind ?? 'document'
      })
      return structuredClone(pageFor(page))
    }
  }
  world.apis.set(person.id, api)
  return api
}
