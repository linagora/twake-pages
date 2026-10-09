// A stable callback ref: an inline one is re-invoked on every render and steals focus.
// The caret goes after the text the field opens with, an edit's, where the
// person goes on writing, rather than wherever the browser leaves it.
export const focusOnMount = (
  field: HTMLInputElement | HTMLTextAreaElement | null
): void => {
  if (!field) return
  field.focus()
  field.setSelectionRange(field.value.length, field.value.length)
}
