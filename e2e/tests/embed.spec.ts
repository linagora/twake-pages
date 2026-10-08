import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { expect, test, type Page } from '@playwright/test'
import { aliceSpaceWiki } from './space.ts'

const APP = 'http://localhost:3500'

// Twake Pages lets TwakeSpace frame it on the first two ports, and the SSO
// only on the first. Unlike Tasks' suite, a third port stands for a page that
// Twake Pages does not trust.
const TRUSTED_PORT = 3501
const SSO_REFUSED_PORT = 3502
const UNTRUSTED_PORT = 3503

// The stand-ins for TwakeSpace listen on the same ports: one at a time.
test.describe.configure({ mode: 'default' })

// The name TwakeSpace gives the frame, after which it names the overlay
const FRAME = 'twake-embed-pages'

interface PostedMessage {
  type: string
  path?: string
}

// A stand-in for TwakeSpace that frames the embed as it does: a named frame,
// and over the whole page an overlay frame on the app's origin, clipped to
// the region the app reports. It greets the frame on each of its loads and
// whenever the frame says it is ready, as TwakeSpace does: the frame posts
// nothing else before. It keeps the messages the frame posts, and sends the
// frame elsewhere as TwakeSpace's Back does. A real server: Chrome keeps
// pages it did not load off the network from framing localhost.
function twakeSpace(wikiId: string, port: number) {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html')
    response.end(`<!doctype html>
      <style>
        body { margin: 0 }
        #pages { position: fixed; top: 80px; left: 200px; width: 900px; height: 600px; border: 0 }
        #overlay { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; color-scheme: normal; clip-path: inset(0 0 100% 0) }
      </style>
      <iframe id="pages" name="${FRAME}" title="Pages" src="${APP}/embed/wikis/${wikiId}"></iframe>
      <iframe id="overlay" name="${FRAME}:overlay" title="Pages windows" src="${APP}/embed/overlay.html"></iframe>
      <script>
        const pages = document.getElementById('pages')
        const overlay = document.getElementById('overlay')
        const greet = () => {
          pages.contentWindow.postMessage({ type: 'twake-embed:hello' }, '${APP}')
        }
        pages.addEventListener('load', greet)
        window.posted = []
        addEventListener('message', event => {
          if (event.origin !== '${APP}' || event.source !== pages.contentWindow) return
          window.posted.push(event.data)
          if (event.data?.type === 'twake-embed:ready') greet()
          if (event.data?.type !== 'twake-embed:overlay-region') return
          const region = event.data.region
          overlay.style.clipPath = region === 'full' ? 'none' : region.length === 0 ? 'inset(0 0 100% 0)'
            : "path('" + region.map(b => 'M' + b.x + ' ' + b.y + 'h' + b.width + 'v' + b.height + 'h' + -b.width + 'Z').join(' ') + "')"
        })
        window.sendNavigate = path => {
          pages.contentWindow.postMessage({ type: 'twake-embed:navigate', resourceId: '${wikiId}', path }, '${APP}')
        }
      </script>`)
  })
  return new Promise<{ url: string; close: () => void }>(resolve =>
    server.listen(port, 'localhost', () => {
      resolve({
        url: `http://localhost:${String(port)}`,
        close: () => server.close()
      })
    })
  )
}

const postedByFrame = (page: Page) =>
  page.evaluate(() => (window as unknown as { posted: PostedMessage[] }).posted)

const postedOfType = async (page: Page, type: string) =>
  (await postedByFrame(page)).filter(message => message.type === type)

const lastPath = async (page: Page) =>
  (await postedOfType(page, 'twake-embed:path')).at(-1)?.path

// Sends the frame to a path of its wiki, as TwakeSpace's Back does
const sendNavigate = (page: Page, path: string) =>
  page.evaluate(to => {
    const standIn = window as unknown as {
      sendNavigate: (path: string) => void
    }
    standIn.sendNavigate(to)
  }, path)

test("opens a space's wiki inside TwakeSpace, signed in without a prompt, without the app's bar", async ({
  page
}) => {
  const { wikiId, name } = await aliceSpaceWiki(page)

  const host = await twakeSpace(wikiId, TRUSTED_PORT)
  try {
    await page.goto(host.url)
    const frame = page.frameLocator(`iframe[name="${FRAME}"]`)

    await expect(frame.getByRole('heading', { level: 1, name })).toBeVisible()
    await expect(frame.getByRole('navigation', { name: 'Wiki' })).toBeVisible()
    await expect(frame.getByRole('banner')).toHaveCount(0)
    await expect(frame.getByRole('link', { name: 'Wikis' })).toHaveCount(0)
    await expect.poll(() => lastPath(page)).toBe('')
  } finally {
    host.close()
  }
})

test('reports its path as the person moves through the wiki, and goes where TwakeSpace sends it', async ({
  page
}) => {
  const { wikiId, name } = await aliceSpaceWiki(page)

  const host = await twakeSpace(wikiId, TRUSTED_PORT)
  try {
    await page.goto(host.url)
    const frame = page.frameLocator(`iframe[name="${FRAME}"]`)
    const wiki = frame.getByRole('navigation', { name: 'Wiki' })
    const search = frame.getByRole('heading', {
      level: 1,
      name: 'Search this wiki'
    })
    await expect(frame.getByRole('heading', { level: 1, name })).toBeVisible()

    await wiki.getByRole('link', { name: 'Search' }).click()
    await expect(search).toBeVisible()
    await expect.poll(() => lastPath(page)).toBe('/search')
    await wiki.getByRole('link', { name: 'Trash' }).click()
    await expect(
      frame.getByRole('heading', { level: 1, name: 'Trash' })
    ).toBeVisible()
    await expect.poll(() => lastPath(page)).toBe('/trash')

    // Back, in TwakeSpace: the frame goes there and reports nothing
    await sendNavigate(page, '/search')
    await expect(search).toBeVisible()
    expect(await lastPath(page)).toBe('/trash')
  } finally {
    host.close()
  }
})

test('signs in through a popup when the SSO refuses to be framed by TwakeSpace', async ({
  page
}) => {
  test.slow()
  const { wikiId, name } = await aliceSpaceWiki(page)
  // The offer to sign in shows at 8 s, and the silent sign-in gives up 10 s
  // after it started, which the frame logs
  const silentSignInGaveUp = page.waitForEvent('console', message =>
    message.text().startsWith('Sign-in failed:')
  )

  const host = await twakeSpace(wikiId, SSO_REFUSED_PORT)
  try {
    await page.goto(host.url)
    const frame = page.frameLocator(`iframe[name="${FRAME}"]`)

    const popup = page.waitForEvent('popup')
    await frame.getByRole('button', { name: 'Back to sign-in' }).click()
    await (await popup).waitForEvent('close')
    await expect(frame.getByRole('heading', { level: 1, name })).toBeVisible()

    // The person keeps the wiki once the silent sign-in gave up
    await silentSignInGaveUp
    await frame
      .getByRole('navigation', { name: 'Wiki' })
      .getByRole('link', { name: 'Search' })
      .click()
    await expect(
      frame.getByRole('heading', { level: 1, name: 'Search this wiki' })
    ).toBeVisible()
    // Signed in again at the top, the SSO would still not show in the frame
    expect(await postedOfType(page, 'twake-embed:login-required')).toEqual([])
  } finally {
    host.close()
  }
})

test('tells TwakeSpace to sign the person in again when the SSO wants them to sign in', async ({
  page
}) => {
  // Nobody signed in to the SSO in this browser
  const host = await twakeSpace(randomUUID(), TRUSTED_PORT)
  try {
    await page.goto(host.url)
    const frame = page.frameLocator(`iframe[name="${FRAME}"]`)

    await expect
      .poll(() => postedOfType(page, 'twake-embed:login-required'))
      .toEqual([{ type: 'twake-embed:login-required' }])
    await expect(
      frame.getByRole('heading', { name: 'We couldn’t sign you in' })
    ).toBeVisible()
  } finally {
    host.close()
  }
})

test('draws its dialogs on the page of TwakeSpace, not in its frame', async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { wikiId, name } = await aliceSpaceWiki(page)

  const host = await twakeSpace(wikiId, TRUSTED_PORT)
  try {
    await page.goto(host.url)
    const frame = page.frameLocator(`iframe[name="${FRAME}"]`)
    const overlay = page.frameLocator(`iframe[name="${FRAME}:overlay"]`)
    const clipPath = () =>
      page.locator('#overlay').evaluate(element => element.style.clipPath)
    await expect(frame.getByRole('heading', { level: 1, name })).toBeVisible()

    const options = frame.getByRole('button', { name: 'Wiki options' })
    await options.click()
    await frame.getByRole('menuitem', { name: 'Edit' }).click()

    const dialog = overlay.getByRole('dialog', { name: 'Edit wiki' })
    await expect(dialog).toBeVisible()
    await expect(frame.getByRole('dialog')).toHaveCount(0)
    await expect.poll(clipPath).toBe('none')
    // Centred on the window of TwakeSpace, not on the frame
    const box = await dialog.boundingBox()
    if (box === null) throw new Error('The dialog is not laid out')
    expect(Math.round(box.x + box.width / 2)).toBe(720)

    await dialog
      .getByRole('textbox', { name: 'Description' })
      .fill('Plans and minutes')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    await expect(frame.getByText('Plans and minutes')).toBeVisible()
    await expect.poll(clipPath).toMatch(/^inset/)
    await expect(options).toBeFocused()
  } finally {
    host.close()
  }
})

test('shows nothing to a page Twake Pages does not trust, and tells it nothing', async ({
  page
}) => {
  const { wikiId } = await aliceSpaceWiki(page)

  const host = await twakeSpace(wikiId, UNTRUSTED_PORT)
  try {
    await page.goto(host.url)

    // The browser's error page, in the frame and the overlay alike
    await expect
      .poll(() =>
        page
          .mainFrame()
          .childFrames()
          .map(frame => frame.url())
      )
      .toEqual([
        'chrome-error://chromewebdata/',
        'chrome-error://chromewebdata/'
      ])
    expect(await postedByFrame(page)).toEqual([])
  } finally {
    host.close()
  }
})
