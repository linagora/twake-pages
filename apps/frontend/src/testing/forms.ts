import { fireEvent, within } from '@testing-library/react'

/** Types `value` into the text field labelled `field`, inside `container`. */
export function typeIn(
  container: HTMLElement,
  field: string,
  value: string
): void {
  fireEvent.change(within(container).getByRole('textbox', { name: field }), {
    target: { value }
  })
}

/** Chooses `option` in the select field labelled `field`, inside `container`. */
export function chooseIn(
  container: HTMLElement,
  field: string,
  option: string
): void {
  const select = within(container).getByRole('combobox', { name: field })
  const { value } = within(select).getByRole<HTMLOptionElement>('option', {
    name: option
  })
  fireEvent.change(select, { target: { value } })
}
