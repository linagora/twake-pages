import { expect, test } from '@playwright/test'
import { publishText } from './editor.ts'
import { aliceWiki, newPage } from './wiki.ts'

// The first block of the How-to template, which version 1 of the page holds.
const INTRO = 'What this guide helps to do, and for whom.'
const TEXT = 'Bring your badge on the first day.'

test('alice opens the history of "Onboarding", views version 1, restores it: the page shows version 1\'s text as version 3', async ({
  page
}) => {
  await aliceWiki(page)
  await newPage(page, 'Onboarding', 'How-to')
  await publishText(page, TEXT, INTRO)

  await page.getByRole('link', { name: 'Version 2', exact: true }).click()
  await page.getByRole('link', { name: 'Version 1', exact: true }).click()
  await page.getByRole('button', { name: 'Restore this version' }).click()

  const main = page.getByRole('main')
  await expect(
    main.getByRole('heading', { level: 1, name: 'Onboarding', exact: true })
  ).toBeVisible()
  await expect(
    main.getByRole('link', { name: 'Version 3', exact: true })
  ).toBeVisible()
  await expect(main.getByText(INTRO)).toBeVisible()
  await expect(main.getByText(TEXT)).toBeHidden()
})
