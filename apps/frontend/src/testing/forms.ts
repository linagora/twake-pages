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
