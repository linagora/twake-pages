import { vi, type Mock } from 'vitest'

import type { PagesApi, UserSettings, Wiki } from '@/application/pages'

export type FakePagesApi = { [Key in keyof PagesApi]: Mock<PagesApi[Key]> }

let counter = 0
const nextId = (): string => {
  counter += 1
  return `00000000-0000-7000-8000-${String(counter).padStart(12, '0')}`
}

export function aWiki(overrides: Partial<Wiki> = {}): Wiki {
  return { id: nextId(), name: 'Handbook', ...overrides }
}

export const NO_SETTINGS: UserSettings = {
  version: 0,
  language: null,
  timezone: null,
  theme: 'auto',
  avatar: null,
  name: null
}

export function fakePagesApi(wikis: Wiki[] = []): FakePagesApi {
  return {
    settings: vi.fn<PagesApi['settings']>(() =>
      Promise.resolve({ ...NO_SETTINGS })
    ),
    watchSettings: vi.fn<PagesApi['watchSettings']>(() => () => undefined),
    listWikis: vi.fn<PagesApi['listWikis']>(() =>
      Promise.resolve(structuredClone(wikis))
    )
  }
}
