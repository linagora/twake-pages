import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Block } from '@/domain/page'
import {
  copiedFromBlockNote,
  pasteInBlocks,
  typeInBlocks
} from '@/testing/blocks'
import {
  fakePagesApi,
  paragraph,
  type FakePagesApi
} from '@/testing/fakePagesApi'
import { fakeSession, fakeUser } from '@/testing/fakeSession'
import { typeIn } from '@/testing/forms'
import { renderRoute } from '@/testing/renderWithProviders'
import { followZone } from '@/ui/settings/zone'

/** The types of the blocks and of the blocks under them, in order. */
const typesOf = (blocks: Block[]): unknown[] =>
  blocks.flatMap(block => [
    block.type,
    ...(Array.isArray(block.children) ? typesOf(block.children as Block[]) : [])
  ])

describe('the editor of a page', () => {
  it('publishes the title and the blocks written, then shows the page at its new version', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Handbook' })
    const onboarding = pagesApi.withPage(wiki.id, { title: 'Onboarding' })
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}/edit`, { pagesApi })

    await screen.findByRole('textbox', { name: 'Title' })
    typeIn(screen.getByRole('main'), 'Title', 'Onboarding guide')
    await typeInBlocks(
      await screen.findByRole('textbox', { name: 'Content' }),
      'Ask for a laptop'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Onboarding guide'
      })
    ).toBeVisible()
    expect(screen.getByText('Version 2')).toBeVisible()
    expect(await screen.findByText('Ask for a laptop')).toBeVisible()
    expect(pagesApi.publish).toHaveBeenCalledWith(onboarding.id, {
      baseVersion: 1,
      title: 'Onboarding guide',
      content: [expect.objectContaining(paragraph('Ask for a laptop')) as Block]
    })
  })

  it('starts from the title and the blocks of the page', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki()
    const onboarding = pagesApi.withPage(wiki.id, {
      title: 'Onboarding',
      content: [paragraph('Ask for a laptop')]
    })
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}/edit`, { pagesApi })

    expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveValue(
      'Onboarding'
    )
    expect(
      await screen.findByRole('textbox', { name: 'Content' })
    ).toHaveTextContent('Ask for a laptop')
  })

  it('publishes the home page, then shows it under the name of its wiki', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Handbook' })
    const { router } = renderRoute(
      `/wikis/${wiki.id}/pages/${wiki.homePageId}/edit`,
      { pagesApi }
    )

    await typeInBlocks(
      await screen.findByRole('textbox', { name: 'Content' }),
      'Start with the onboarding.'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Handbook' })
    ).toBeVisible()
    expect(router.state.location.pathname).toBe(`/wikis/${wiki.id}`)
    expect(screen.getByText('Version 2')).toBeVisible()
    expect(await screen.findByText('Start with the onboarding.')).toBeVisible()
  })

  it.each([
    ['a page', false],
    ['the home page', true]
  ])('leads back to %s', async (_case, home) => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki()
    const pageId = home
      ? wiki.homePageId
      : pagesApi.withPage(wiki.id, { title: 'Onboarding' }).id
    renderRoute(`/wikis/${wiki.id}/pages/${pageId}/edit`, { pagesApi })

    expect(
      await screen.findByRole('link', { name: 'Back to the page' })
    ).toHaveAttribute(
      'href',
      home ? `/wikis/${wiki.id}` : `/wikis/${wiki.id}/pages/${pageId}`
    )
  })

  it.each([
    [
      'a viewer of the wiki',
      async (pagesApi: FakePagesApi) => {
        const wiki = pagesApi.withWiki({ role: 'viewer' })
        const page = pagesApi.withPage(wiki.id, { title: 'Onboarding' })
        return Promise.resolve({ wiki, page })
      }
    ],
    [
      'a page in the trash',
      async (pagesApi: FakePagesApi) => {
        const wiki = pagesApi.withWiki()
        const page = pagesApi.withPage(wiki.id, { title: 'Onboarding' })
        await pagesApi.deletePage(page.id)
        return { wiki, page }
      }
    ],
    [
      'a database, which shows a Grist document',
      async (pagesApi: FakePagesApi) => {
        const wiki = pagesApi.withWiki()
        const page = pagesApi.withPage(wiki.id, {
          title: 'Budget',
          kind: 'database'
        })
        return Promise.resolve({ wiki, page })
      }
    ]
  ])('opens not for %s, and shows the page instead', async (_case, seed) => {
    const pagesApi = fakePagesApi()
    const { wiki, page } = await seed(pagesApi)

    const { router } = renderRoute(`/wikis/${wiki.id}/pages/${page.id}/edit`, {
      pagesApi
    })

    expect(
      await screen.findByRole('heading', { level: 1, name: page.title })
    ).toBeVisible()
    expect(router.state.location.pathname).toBe(
      `/wikis/${wiki.id}/pages/${page.id}`
    )
    // In place of the editor, which going back does not open either.
    expect(router.state.historyAction).toBe('REPLACE')
    expect(
      screen.queryByRole('textbox', { name: 'Title' })
    ).not.toBeInTheDocument()
  })

  it('offers images and no video, audio or file block, which pages cannot show', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki()
    const onboarding = pagesApi.withPage(wiki.id, { title: 'Onboarding' })
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}/edit`, { pagesApi })

    await typeInBlocks(
      await screen.findByRole('textbox', { name: 'Content' }),
      '/'
    )

    // Hidden, as jsdom gives the menu no room where BlockNote places it.
    const offered = (
      await screen.findAllByRole('option', { hidden: true })
    ).map(option => option.textContent)
    expect(offered).toContainEqual(expect.stringMatching(/^Image/))
    expect(offered).not.toContainEqual(
      expect.stringMatching(/^(Video|Audio|File)/)
    )
  })

  it.each([
    [
      'a page of another site',
      {
        'text/html':
          '<p>Watch the intro</p><video src="https://media.example.com/intro.mp4"></video><audio src="https://media.example.com/intro.mp3"></audio><embed src="https://media.example.com/intro.pdf">'
      }
    ],
    [
      'another BlockNote editor',
      copiedFromBlockNote([
        paragraph('Watch the intro'),
        {
          type: 'video',
          props: { url: 'https://media.example.com/intro.mp4' }
        },
        {
          type: 'audio',
          props: { url: 'https://media.example.com/intro.mp3' }
        },
        { type: 'file', props: { url: 'https://media.example.com/intro.pdf' } }
      ])
    ]
  ])(
    'makes no video, audio or file block of what is pasted from %s',
    async (_case, clipboard) => {
      const pagesApi = fakePagesApi()
      const wiki = pagesApi.withWiki()
      const onboarding = pagesApi.withPage(wiki.id, { title: 'Onboarding' })
      renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}/edit`, {
        pagesApi
      })

      const content = await screen.findByRole('textbox', { name: 'Content' })
      await pasteInBlocks(content, clipboard)
      expect(content).toHaveTextContent('Watch the intro')
      fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

      await waitFor(() => {
        expect(pagesApi.publish).toHaveBeenCalledOnce()
      })
      const [, draft] = pagesApi.publish.mock.calls[0] ?? []
      const published = draft && 'content' in draft ? draft.content : []
      expect(
        typesOf(published).filter(type =>
          ['video', 'audio', 'file'].includes(String(type))
        )
      ).toEqual([])
    }
  )

  it('opens a video the page holds as a link to it, which publishing keeps', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki()
    const onboarding = pagesApi.withPage(wiki.id, {
      title: 'Onboarding',
      content: [
        {
          type: 'video',
          props: { url: 'https://media.example.com/intro.mp4', name: 'Intro' },
          children: []
        }
      ]
    })
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}/edit`, { pagesApi })

    const content = await screen.findByRole('textbox', { name: 'Content' })
    expect(
      within(content).getByRole('link', { name: 'Intro' })
    ).toHaveAttribute('href', 'https://media.example.com/intro.mp4')
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => {
      expect(pagesApi.publish).toHaveBeenCalledWith(onboarding.id, {
        baseVersion: 1,
        title: 'Onboarding',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'link',
                href: 'https://media.example.com/intro.mp4',
                content: [{ type: 'text', text: 'Intro', styles: {} }]
              }
            ],
            children: []
          }
        ]
      })
    })
  })

  it('takes an image by its link, with no upload', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki()
    const onboarding = pagesApi.withPage(wiki.id, { title: 'Onboarding' })
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}/edit`, { pagesApi })

    await typeInBlocks(
      await screen.findByRole('textbox', { name: 'Content' }),
      '/'
    )
    // By their text: hidden, the option and the tabs have no name.
    fireEvent.click(await screen.findByText('Image'))

    expect(await screen.findByText('Embed')).toBeInTheDocument()
    expect(screen.queryByText('Upload')).not.toBeInTheDocument()
  })

  it('publishes no page without a title', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki()
    const onboarding = pagesApi.withPage(wiki.id, { title: 'Onboarding' })
    renderRoute(`/wikis/${wiki.id}/pages/${onboarding.id}/edit`, { pagesApi })

    await screen.findByRole('textbox', { name: 'Title' })
    typeIn(screen.getByRole('main'), 'Title', '  ')

    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
  })
})

const DRAFT_KEPT = /This is your draft, started from version 1/

/** A page of a wiki, and the path of its editor. */
function aPage(pagesApi: FakePagesApi) {
  const wiki = pagesApi.withWiki({ members: { 'bob@example.com': 'editor' } })
  const page = pagesApi.withPage(wiki.id, {
    title: 'Onboarding',
    content: [paragraph('Bring your badge')]
  })
  return { page, editor: `/wikis/${wiki.id}/pages/${page.id}/edit` }
}

/** Writes a title and a paragraph in the editor shown. */
async function writeADraft() {
  await screen.findByRole('textbox', { name: 'Title' })
  typeIn(screen.getByRole('main'), 'Title', 'Onboarding guide')
  await typeInBlocks(
    await screen.findByRole('textbox', { name: 'Content' }),
    'Ask for a laptop'
  )
}

/** Writes a title and a paragraph in the editor, and leaves it unpublished. */
async function leaveADraft(editor: string, pagesApi: FakePagesApi) {
  const { unmount } = renderRoute(editor, { pagesApi })
  await writeADraft()
  unmount()
}

describe('the draft of a page', () => {
  it('is offered back when the editor opens again, and stays in the browser', async () => {
    const pagesApi = fakePagesApi()
    const { editor } = aPage(pagesApi)
    await leaveADraft(editor, pagesApi)

    renderRoute(editor, { pagesApi })

    expect(await screen.findByText(DRAFT_KEPT)).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
      'Onboarding guide'
    )
    expect(
      await screen.findByRole('textbox', { name: 'Content' })
    ).toHaveTextContent('Ask for a laptop')
    expect(pagesApi.publish).not.toHaveBeenCalled()
  })

  it('is published from the version it started from, then dropped', async () => {
    const pagesApi = fakePagesApi()
    const { page, editor } = aPage(pagesApi)
    await leaveADraft(editor, pagesApi)
    renderRoute(editor, { pagesApi })

    await screen.findByText(DRAFT_KEPT)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    fireEvent.click(await screen.findByRole('link', { name: 'Edit page' }))

    expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveValue(
      'Onboarding guide'
    )
    expect(screen.queryByText(DRAFT_KEPT)).not.toBeInTheDocument()
    expect(pagesApi.publish).toHaveBeenCalledWith(page.id, {
      baseVersion: 1,
      title: 'Onboarding guide',
      content: [expect.objectContaining(paragraph('Ask for a laptop')) as Block]
    })
  })

  it('is dropped once published, though the person left the editor before', async () => {
    const pagesApi = fakePagesApi()
    const { editor } = aPage(pagesApi)
    const publish = pagesApi.publish.getMockImplementation()
    if (!publish) throw new Error('No publish to hold')
    let answer = (): void => undefined
    pagesApi.publish.mockImplementationOnce(async (pageId, draft) => {
      await new Promise<void>(resolve => {
        answer = resolve
      })
      return publish(pageId, draft)
    })
    renderRoute(editor, { pagesApi })
    await writeADraft()

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    fireEvent.click(screen.getByRole('link', { name: 'Back to the page' }))
    await screen.findByRole('heading', { level: 1, name: 'Onboarding' })
    act(() => {
      answer()
    })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Onboarding guide' })
    ).toBeVisible()
    fireEvent.click(screen.getByRole('link', { name: 'Edit page' }))
    await screen.findByRole('textbox', { name: 'Title' })
    expect(screen.queryByText(DRAFT_KEPT)).not.toBeInTheDocument()
  })

  it('is dropped when discarded, for the page as it is', async () => {
    const pagesApi = fakePagesApi()
    const { editor } = aPage(pagesApi)
    await leaveADraft(editor, pagesApi)
    const { unmount } = renderRoute(editor, { pagesApi })

    fireEvent.click(
      await screen.findByRole('button', { name: 'Discard draft' })
    )

    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
      'Onboarding'
    )
    const content = await screen.findByRole('textbox', { name: 'Content' })
    expect(content).toHaveTextContent('Bring your badge')
    expect(content).not.toHaveTextContent('Ask for a laptop')
    unmount()
    renderRoute(editor, { pagesApi })
    expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveValue(
      'Onboarding'
    )
    expect(screen.queryByText(DRAFT_KEPT)).not.toBeInTheDocument()
  })

  it('is offered to the person who wrote it only', async () => {
    const pagesApi = fakePagesApi()
    const { editor } = aPage(pagesApi)
    await leaveADraft(editor, pagesApi)

    renderRoute(editor, {
      pagesApi: pagesApi.signedInAs('bob@example.com', 'Bob Durand'),
      session: fakeSession(() =>
        Promise.resolve({
          ...fakeUser(),
          name: 'Bob Durand',
          email: 'bob@example.com'
        })
      )
    })

    expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveValue(
      'Onboarding'
    )
    expect(screen.queryByText(DRAFT_KEPT)).not.toBeInTheDocument()
  })

  it('is not kept while nothing is written', async () => {
    const pagesApi = fakePagesApi()
    const { editor } = aPage(pagesApi)
    const { unmount } = renderRoute(editor, { pagesApi })
    await screen.findByRole('textbox', { name: 'Content' })
    unmount()

    renderRoute(editor, { pagesApi })

    await screen.findByRole('textbox', { name: 'Content' })
    expect(screen.queryByText(DRAFT_KEPT)).not.toBeInTheDocument()
  })
})

/** Puts an image in the blocks by its address, from the block menu. */
async function embedImage(url: string) {
  await typeInBlocks(
    await screen.findByRole('textbox', { name: 'Content' }),
    '/'
  )
  // By their text: hidden, the menu and the panel name nothing.
  fireEvent.click(await screen.findByText('Image'))
  fireEvent.change(await screen.findByPlaceholderText('Enter URL'), {
    target: { value: url }
  })
  fireEvent.click(screen.getByText('Embed image'))
}

describe('a refused publish', () => {
  it('says why the content is refused, and keeps the draft', async () => {
    const pagesApi = fakePagesApi()
    const { editor } = aPage(pagesApi)
    const { unmount } = renderRoute(editor, { pagesApi })
    await embedImage('http://images.example.com/badge.png')

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'an image address that is not https'
    )
    unmount()
    renderRoute(editor, { pagesApi })
    expect(await screen.findByText(DRAFT_KEPT)).toBeVisible()
  })
})

describe('an edit conflict', () => {
  afterEach(() => {
    followZone(null)
    vi.useRealTimers()
  })

  /**
   * Alice writes a draft from version 1 of the page, in Tokyo, and Bob
   * publishes version 2 before she publishes it.
   */
  async function aConflict(pagesApi: FakePagesApi) {
    const { page, editor } = aPage(pagesApi)
    followZone('Asia/Tokyo')
    renderRoute(editor, { pagesApi })
    await writeADraft()
    // Later than any time the fake gave before, as its times only move on.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2100-03-02T09:30:00Z'))
    await pagesApi
      .signedInAs('bob@example.com', 'Bob Durand')
      .publish(page.id, {
        baseVersion: 1,
        title: 'First day',
        content: [paragraph('Bring your badge and a pen')]
      })
    vi.useRealTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    return page
  }

  it('shows who published the current version of the page, and when', async () => {
    await aConflict(fakePagesApi())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bob Durand published version 2 on Mar 2, 2100, 6:30 PM'
    )
  })

  it('publishes the draft over the current version, once confirmed', async () => {
    const pagesApi = fakePagesApi()
    const page = await aConflict(pagesApi)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Publish over it' })
    )
    const confirmation = await screen.findByRole('dialog', {
      name: 'Publish over version 2?'
    })
    expect(pagesApi.publish).toHaveBeenCalledOnce()
    fireEvent.click(
      within(confirmation).getByRole('button', { name: 'Publish over it' })
    )

    expect(await screen.findByText('Version 3')).toBeVisible()
    expect(await screen.findByText('Ask for a laptop')).toBeVisible()
    expect(pagesApi.publish).toHaveBeenLastCalledWith(page.id, {
      baseVersion: 2,
      title: 'Onboarding guide',
      content: [expect.objectContaining(paragraph('Ask for a laptop')) as Block]
    })
  })

  it('reloads the page at its current version, and drops the draft', async () => {
    const pagesApi = fakePagesApi()
    // As when live updates have not told of Bob's version yet.
    pagesApi.watchWiki = vi.fn(() => () => undefined)
    await aConflict(pagesApi)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Reload the page' })
    )

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
        'First day'
      )
    })
    expect(
      await screen.findByRole('textbox', { name: 'Content' })
    ).toHaveTextContent('Bring your badge and a pen')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(await screen.findByText('Version 3')).toBeVisible()
  })
})
