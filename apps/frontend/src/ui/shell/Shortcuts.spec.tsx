import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderRoute } from '@/testing/renderWithProviders'

const press = (key: string, target: Element = document.body) => {
  fireEvent.keyDown(target, { key })
}

async function elsewhere() {
  renderRoute('/no-such-page')
  return screen.findByRole('navigation')
}

describe('keyboard shortcuts', () => {
  it('goes to a view with g then its letter', async () => {
    await elsewhere()

    press('g')
    press('w')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Twake Pages' })
    ).toBeVisible()
  })

  it('leaves keys alone while typing', async () => {
    await elsewhere()
    const field = document.body.appendChild(document.createElement('input'))

    press('?', field)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    field.remove()
  })

  it('lists the shortcuts with ?', async () => {
    await elsewhere()

    press('?')

    const help = await screen.findByRole('dialog', {
      name: 'Keyboard shortcuts'
    })
    expect(help).toHaveTextContent('g then w')
    expect(help).toHaveTextContent('Wikis')
  })

  it('names the keys that move a page in the tree', async () => {
    await elsewhere()

    press('?')

    const help = await screen.findByRole('dialog', {
      name: 'Keyboard shortcuts'
    })
    const rows = within(help)
      .getAllByRole('term')
      .map(term => [term.textContent, term.nextElementSibling?.textContent])
    expect(rows).toEqual(
      expect.arrayContaining([
        ['Alt+Shift+↑', 'Move the page up in the tree'],
        ['Alt+Shift+↓', 'Move the page down in the tree'],
        ['Alt+Shift+→', 'Move the page under the previous page at its level'],
        ['Alt+Shift+←', 'Move the page out to its parent’s level']
      ])
    )
  })
})
