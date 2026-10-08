import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

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
import { typeIn } from '@/testing/forms'
import { renderRoute } from '@/testing/renderWithProviders'

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
