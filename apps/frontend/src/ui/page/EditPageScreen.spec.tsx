import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { KEPT_BLOCK } from '@/ds/editorBlocks'
import type { Block } from '@/domain/page'
import {
  backspaceBefore,
  copiedFromBlockNote,
  copyAllInBlocks,
  pasteInBlocks,
  typeInBlocks
} from '@/testing/blocks'
import {
  BUDGET,
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

/** The blocks of the first version published. */
function publishedBlocks(pagesApi: FakePagesApi): Block[] {
  const version = pagesApi.publish.mock.calls[0]?.[1]
  if (!version || !('content' in version)) {
    throw new Error('No blocks published')
  }
  return version.content
}

// A video in the HTML the editor copies, which holds it in an attribute
// that a page of another site or a text may hold as well.
const VIDEO_AS_COPIED = `<div data-content-type="${KEPT_BLOCK}" data-stored='${JSON.stringify(
  { type: 'video', props: { url: 'https://media.example.com/intro.mp4' } }
)}'></div>`

describe('a Grist embed of the page', () => {
  const ELSEWHERE = 'https://docs.example.com/o/docs/4kq2'
  // As another client of the API may store one: with no id and no children.
  const GRIST_EMBED: Block = { type: 'gristEmbed', props: { url: BUDGET } }

  /** Puts a Grist embed in the blocks at `url`, from the block menu. */
  const embedGristDocument = (url: string) =>
    embedFromMenu('Grist document', 'Embed Grist document', url)

  it('is inserted from the block menu at the address given, then published', async () => {
    const pagesApi = fakePagesApi()
    renderRoute(aPage(pagesApi).editor, { pagesApi })

    await embedGristDocument(BUDGET)

    expect(await screen.findByTitle('Grist document')).toHaveAttribute(
      'src',
      BUDGET
    )
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => {
      expect(pagesApi.publish).toHaveBeenCalledOnce()
    })
    expect(publishedBlocks(pagesApi)).toContainEqual(
      expect.objectContaining({ type: 'gristEmbed', props: { url: BUDGET } })
    )
  })

  it('asks for its address until it is given one', async () => {
    const pagesApi = fakePagesApi()
    const { editor } = aPage(pagesApi, [
      { type: 'gristEmbed', props: { url: '' } }
    ])
    renderRoute(editor, { pagesApi })

    fireEvent.click(
      await screen.findByRole('button', { name: 'Add Grist document' })
    )
    fireEvent.change(await screen.findByPlaceholderText('Enter URL'), {
      target: { value: BUDGET }
    })
    fireEvent.click(screen.getByText('Embed Grist document'))

    expect(await screen.findByTitle('Grist document')).toHaveAttribute(
      'src',
      BUDGET
    )
    expect(
      screen.queryByRole('button', { name: 'Add Grist document' })
    ).not.toBeInTheDocument()
  })

  it('frames no document off the Grist origins, and says so', async () => {
    const pagesApi = fakePagesApi()
    renderRoute(aPage(pagesApi).editor, { pagesApi })

    await embedGristDocument(ELSEWHERE)

    expect(
      await screen.findByText(/^This Grist document is not shown/)
    ).toHaveTextContent(
      'This Grist document is not shown, as Twake Pages shows Grist documents from https://grist.example.com only.'
    )
    expect(screen.queryByTitle('Grist document')).not.toBeInTheDocument()
  })

  it('is refused off the Grist origins, which the refusal names', async () => {
    const pagesApi = fakePagesApi()
    // As published before the origins changed.
    const { editor } = aPage(pagesApi, [
      { type: 'gristEmbed', props: { url: ELSEWHERE } }
    ])
    renderRoute(editor, { pagesApi })
    await screen.findByText(/^This Grist document is not shown/)

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'a Grist document that is not shown'
    )
  })

  it('is not offered where the pages frame no Grist', async () => {
    const pagesApi = fakePagesApi()
    renderRoute(aPage(pagesApi).editor, { pagesApi, gristOrigins: [] })

    await typeInBlocks(
      await screen.findByRole('textbox', { name: 'Content' }),
      '/'
    )

    // By their text: hidden, the menu names nothing.
    expect(await screen.findByText('Image')).toBeInTheDocument()
    expect(screen.queryByText('Grist document')).not.toBeInTheDocument()
  })

  it('frames its document, with a link that opens it in Grist', async () => {
    const pagesApi = fakePagesApi()
    renderRoute(aPage(pagesApi, [GRIST_EMBED]).editor, { pagesApi })

    const content = await screen.findByRole('textbox', { name: 'Content' })
    expect(await within(content).findByTitle('Grist document')).toHaveAttribute(
      'src',
      BUDGET
    )
    expect(
      within(content).getByRole('link', { name: 'Open in Grist' })
    ).toHaveAttribute('href', BUDGET)
  })

  it('is kept in a paste of what was copied with it, then published', async () => {
    const pagesApi = fakePagesApi()
    const source = aPage(pagesApi, [
      paragraph('Watch the budget'),
      GRIST_EMBED,
      paragraph('Then read the rules')
    ])
    const { unmount } = renderRoute(source.editor, { pagesApi })
    const copied = await screen.findByRole('textbox', { name: 'Content' })
    await within(copied).findByTitle('Grist document')
    const clipboard = copyAllInBlocks(copied)
    unmount()

    renderRoute(aPage(pagesApi, []).editor, { pagesApi })
    const content = await screen.findByRole('textbox', { name: 'Content' })
    await pasteInBlocks(content, clipboard)
    expect(await within(content).findByTitle('Grist document')).toHaveAttribute(
      'src',
      BUDGET
    )
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => {
      expect(pagesApi.publish).toHaveBeenCalledOnce()
    })
    expect(publishedBlocks(pagesApi)).toContainEqual(
      expect.objectContaining({ type: 'gristEmbed', props: { url: BUDGET } })
    )
  })
})

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
    ],
    [
      'a page of another site, holding a video as the editor copies one',
      { 'text/html': `<p>Watch the intro</p>${VIDEO_AS_COPIED}` }
    ],
    [
      'a page of another site, holding a video as the editor copies one, in the HTML of BlockNote',
      { 'blocknote/html': `<p>Watch the intro</p>${VIDEO_AS_COPIED}` }
    ],
    [
      'a text holding a video as the editor copies one',
      { 'text/plain': `Watch the intro\n\n${VIDEO_AS_COPIED}` }
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
      const published = publishedBlocks(pagesApi)
      expect(published).toContainEqual(
        expect.objectContaining(paragraph('Watch the intro'))
      )
      expect(
        typesOf(published).filter(type =>
          ['video', 'audio', 'file'].includes(String(type))
        )
      ).toEqual([])
    }
  )

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
function aPage(
  pagesApi: FakePagesApi,
  content: Block[] = [paragraph('Bring your badge')]
) {
  const wiki = pagesApi.withWiki({ members: { 'bob@example.com': 'editor' } })
  const page = pagesApi.withPage(wiki.id, { title: 'Onboarding', content })
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

// A video as BlockNote stores one, with each of its props.
const VIDEO: Block = {
  id: 'intro-video',
  type: 'video',
  props: {
    backgroundColor: 'default',
    textAlignment: 'left',
    name: 'intro.mp4',
    url: 'https://media.example.com/intro.mp4',
    caption: 'Welcome video',
    showPreview: true,
    previewWidth: 512
  },
  children: []
}

// As another client of the API may store one: with no id and no children.
const AUDIO: Block = {
  type: 'audio',
  props: { url: 'https://media.example.com/welcome.mp3' }
}

describe('a block of the page that the editor does not offer', () => {
  it('shows by its kind, its caption or else its name, and its address, and cannot be edited', async () => {
    const pagesApi = fakePagesApi()
    const { editor } = aPage(pagesApi, [
      VIDEO,
      {
        type: 'file',
        props: {
          url: 'https://media.example.com/rules.pdf',
          name: 'Rules.pdf'
        },
        children: []
      },
      AUDIO,
      { type: 'mermaid', props: { code: 'graph TD' }, children: [] }
    ])
    renderRoute(editor, { pagesApi })

    const content = await screen.findByRole('textbox', { name: 'Content' })
    const kept = await within(content).findAllByRole('group')

    expect(
      kept.map(block => [...block.children].map(line => line.textContent))
    ).toEqual([
      ['Video', 'Welcome video', 'https://media.example.com/intro.mp4'],
      ['File', 'Rules.pdf', 'https://media.example.com/rules.pdf'],
      ['Audio', 'https://media.example.com/welcome.mp3'],
      ['mermaid block']
    ])
    expect(within(content).getByRole('group', { name: 'Audio' })).toBe(kept[2])
    expect(
      kept.map(block =>
        block.closest('[contenteditable]')?.getAttribute('contenteditable')
      )
    ).toEqual(['false', 'false', 'false', 'false'])
  })

  it('is published as stored when the title alone changes', async () => {
    const pagesApi = fakePagesApi()
    const { page, editor } = aPage(pagesApi, [VIDEO, AUDIO])
    renderRoute(editor, { pagesApi })

    await within(
      await screen.findByRole('textbox', { name: 'Content' })
    ).findAllByRole('group')
    typeIn(screen.getByRole('main'), 'Title', 'Onboarding guide')
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => {
      expect(pagesApi.publish).toHaveBeenCalledOnce()
    })
    expect(pagesApi.publish.mock.calls[0]).toStrictEqual([
      page.id,
      {
        baseVersion: 1,
        title: 'Onboarding guide',
        content: [VIDEO, AUDIO]
      }
    ])
  })

  it('is published as stored among the blocks written', async () => {
    const pagesApi = fakePagesApi()
    const { editor } = aPage(pagesApi, [
      VIDEO,
      AUDIO,
      paragraph('Bring your badge')
    ])
    renderRoute(editor, { pagesApi })

    await typeInBlocks(
      await screen.findByRole('textbox', { name: 'Content' }),
      'Ask for a laptop'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => {
      expect(pagesApi.publish).toHaveBeenCalledOnce()
    })
    expect(publishedBlocks(pagesApi)).toStrictEqual([
      VIDEO,
      AUDIO,
      expect.objectContaining(paragraph('Ask for a laptop')) as Block
    ])
  })

  it('is published as stored with its text, the blocks under it as written', async () => {
    const pagesApi = fakePagesApi()
    // A paragraph as BlockNote stores one, under a block of a type the
    // editor does not know, which holds text.
    const desk = (text: string): Block => ({
      id: 'badge-desk',
      type: 'paragraph',
      props: {
        backgroundColor: 'default',
        textColor: 'default',
        textAlignment: 'left'
      },
      content: [{ type: 'text', text, styles: {} }],
      children: []
    })
    const callout = (under: Block): Block => ({
      id: 'badge-callout',
      type: 'callout',
      props: { tone: 'warning' },
      content: [{ type: 'text', text: 'Mind the badge', styles: {} }],
      children: [under]
    })
    const { editor } = aPage(pagesApi, [callout(desk('Ask at the desk'))])
    renderRoute(editor, { pagesApi })

    const content = await screen.findByRole('textbox', { name: 'Content' })
    await within(content).findByRole('group', { name: 'callout block' })
    // In the last paragraph of the editor: the one under the callout.
    await typeInBlocks(content, 'Ask at the front desk')
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => {
      expect(pagesApi.publish).toHaveBeenCalledOnce()
    })
    expect(publishedBlocks(pagesApi)).toStrictEqual([
      callout(desk('Ask at the front desk'))
    ])
  })

  it('is published no more once deleted', async () => {
    const pagesApi = fakePagesApi()
    const { editor } = aPage(pagesApi, [
      paragraph('Bring your badge'),
      VIDEO,
      paragraph('Ask for a laptop')
    ])
    renderRoute(editor, { pagesApi })

    const content = await screen.findByRole('textbox', { name: 'Content' })
    await within(content).findByRole('group', { name: 'Video' })
    await backspaceBefore(content, 'Ask for a laptop')
    expect(within(content).queryByRole('group')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => {
      expect(pagesApi.publish).toHaveBeenCalledOnce()
    })
    expect(publishedBlocks(pagesApi)).toStrictEqual([
      expect.objectContaining(paragraph('Bring your badge')) as Block,
      expect.objectContaining(paragraph('Ask for a laptop')) as Block
    ])
  })

  it('is left out of a paste of what was copied with it, the blocks under it taking its place', async () => {
    const pagesApi = fakePagesApi()
    const source = aPage(pagesApi, [
      paragraph('Watch the intro'),
      { ...VIDEO, children: [paragraph('Under the video')] },
      AUDIO,
      paragraph('Then read the rules')
    ])
    const { unmount } = renderRoute(source.editor, { pagesApi })
    const copied = await screen.findByRole('textbox', { name: 'Content' })
    await within(copied).findAllByRole('group')
    const clipboard = copyAllInBlocks(copied)
    unmount()
    // The video was copied: the text of the clipboard holds its caption.
    expect(clipboard['text/plain']).toContain('Welcome video')

    renderRoute(aPage(pagesApi, []).editor, { pagesApi })
    const content = await screen.findByRole('textbox', { name: 'Content' })
    await pasteInBlocks(content, clipboard)
    expect(content).toHaveTextContent('Then read the rules')
    expect(within(content).queryByRole('group')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => {
      expect(pagesApi.publish).toHaveBeenCalledOnce()
    })
    expect(publishedBlocks(pagesApi)).toStrictEqual([
      expect.objectContaining(paragraph('Watch the intro')) as Block,
      expect.objectContaining(paragraph('Under the video')) as Block,
      expect.objectContaining(paragraph('Then read the rules')) as Block
    ])
  })
})

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

/**
 * Puts a block in the blocks by its address, from the block menu: the
 * `item` of the menu, then the `button` that takes the address.
 */
async function embedFromMenu(item: string, button: string, url: string) {
  await typeInBlocks(
    await screen.findByRole('textbox', { name: 'Content' }),
    '/'
  )
  // By their text: hidden, the menu and the panel name nothing.
  fireEvent.click(await screen.findByText(item))
  fireEvent.change(await screen.findByPlaceholderText('Enter URL'), {
    target: { value: url }
  })
  fireEvent.click(screen.getByText(button))
}

/** Puts an image in the blocks by its address, from the block menu. */
async function embedImage(url: string) {
  await embedFromMenu('Image', 'Embed image', url)
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

describe('an image of the blocks', () => {
  // As the deployment adds them to the app's own.
  const imageSources = {
    self: window.location.origin,
    added: ['https://avatars.example.com', 'https://images.example.com']
  }

  it('is said not to show from a host the app takes no images from', async () => {
    const pagesApi = fakePagesApi()
    renderRoute(aPage(pagesApi).editor, { pagesApi, imageSources })

    await embedImage('https://elsewhere.example.org/badge.png')

    expect(
      await screen.findByText(/^Images from elsewhere.example.org will not/)
    ).toHaveTextContent(
      'Images from elsewhere.example.org will not show, as Twake Pages shows images from https://avatars.example.com and https://images.example.com only.'
    )
  })

  it('is said not to show from any host, when the app takes images from none', async () => {
    const pagesApi = fakePagesApi()
    renderRoute(aPage(pagesApi).editor, {
      pagesApi,
      imageSources: { self: window.location.origin, added: [] }
    })

    await embedImage('https://images.example.com/badge.png')

    expect(
      await screen.findByText(/^Images from images.example.com will not/)
    ).toHaveTextContent(
      'Images from images.example.com will not show, as Twake Pages shows no images from other sites.'
    )
  })

  it('shows from a host the app takes images from, with nothing said', async () => {
    const pagesApi = fakePagesApi()
    renderRoute(aPage(pagesApi).editor, { pagesApi, imageSources })

    await embedImage('https://images.example.com/badge.png')

    expect(await screen.findByRole('img')).toHaveAttribute(
      'src',
      'https://images.example.com/badge.png'
    )
    expect(screen.queryByText(/will not show/)).not.toBeInTheDocument()
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
