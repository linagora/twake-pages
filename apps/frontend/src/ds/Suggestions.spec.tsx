import { Dialog } from '@linagora/twake-mui'
import { act, fireEvent, screen } from '@testing-library/react'
import { useState, type ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { SuggestionField, type Suggestions } from '@/ds/Suggestions'
import { renderWithProviders } from '@/testing/renderWithProviders'

const PEOPLE: Suggestions = {
  trigger: '@',
  after: /\s/u,
  label: 'People to mention',
  search: query =>
    ['alice', 'albert']
      .filter(name => name.startsWith(query))
      .map(name => ({ key: name, insert: `@${name} `, label: name }))
}

function Field(): ReactElement {
  const [value, setValue] = useState('')
  return (
    <SuggestionField
      label="Comment"
      placeholder="Write a comment…"
      value={value}
      onChange={setValue}
      onSubmit={() => undefined}
      suggestions={PEOPLE}
      helperText={null}
      inputRef={null}
      minRows={2}
    />
  )
}

/** The field, focused, with `text` typed in. */
async function typeInField(text: string): Promise<HTMLElement> {
  const field = await screen.findByRole('textbox', { name: 'Comment' })
  act(() => {
    field.focus()
  })
  fireEvent.change(field, { target: { value: text } })
  return field
}

describe('SuggestionField', () => {
  it('closes its list on Escape, and the dialog around it on the next', async () => {
    const onClose = vi.fn()
    renderWithProviders(
      <Dialog open onClose={onClose}>
        <Field />
      </Dialog>
    )
    const field = await typeInField('@al')
    // React tells where the caret is as the last key typed is released.
    fireEvent.keyUp(field, { key: 'l' })
    expect(
      screen.getByRole('listbox', { name: 'People to mention' })
    ).toBeVisible()

    fireEvent.keyDown(field, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(field, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('opens its list again as the field takes the focus back', async () => {
    renderWithProviders(<Field />)
    const field = await typeInField('@al')
    // React tells where the caret is as the last key typed is released.
    fireEvent.keyUp(field, { key: 'l' })
    expect(
      screen.getByRole('listbox', { name: 'People to mention' })
    ).toBeVisible()

    fireEvent.blur(field)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    // The text area keeps its caret while away, after the `@`: taking the
    // focus back finds the options where they were left.
    fireEvent.focus(field)

    expect(
      screen.getByRole('listbox', { name: 'People to mention' })
    ).toBeVisible()
  })

  it('stays closed by Escape, though the caret is told after the key', async () => {
    renderWithProviders(<Field />)
    // Nothing told where the caret is since the field took the focus, so
    // React tells it along with the next key, once the field handled it.
    const field = await typeInField('@al')
    expect(
      screen.getByRole('listbox', { name: 'People to mention' })
    ).toBeVisible()

    fireEvent.keyDown(field, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
