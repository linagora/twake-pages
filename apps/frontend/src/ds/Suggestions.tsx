import {
  List,
  ListItemButton,
  Paper,
  Popper,
  TextField
} from '@linagora/twake-mui'
import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type SyntheticEvent
} from 'react'

export interface SuggestionOption {
  key: string
  /** The text that replaces the trigger and what was typed after it. */
  insert: string
  label: ReactNode
}

export interface Suggestions {
  /** The character that opens the list, such as "@". */
  trigger: string
  /** The characters the trigger may follow, unless it starts the text. */
  after: RegExp
  /** The listbox's accessible name. */
  label: string
  search: (query: string) => SuggestionOption[]
}

/**
 * The trigger typed before the caret, and what was typed after it, when the
 * trigger starts the text or follows a character it may follow. What follows
 * holds no space and no trigger, so that no list opens inside an email.
 */
function typedTrigger(
  text: string,
  caret: number,
  { trigger, after }: Pick<Suggestions, 'trigger' | 'after'>
): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const start = before.lastIndexOf(trigger)
  if (start === -1) return null
  const query = before.slice(start + trigger.length)
  if (/\s/u.test(query)) return null
  return start === 0 || after.test(before.charAt(start - 1))
    ? { start, query }
    : null
}

const optionId = (listId: string, index: number): string =>
  `${listId}-option-${String(index)}`

/**
 * The listbox of a field that keeps the focus: the field points at the
 * active option with aria-activedescendant.
 */
function SuggestionList({
  anchor,
  listId,
  label,
  options,
  active,
  onPick
}: {
  anchor: HTMLElement
  listId: string
  label: string
  options: SuggestionOption[]
  active: number
  onPick: (option: SuggestionOption) => void
}): ReactElement {
  return (
    <Popper
      open
      anchorEl={anchor}
      placement="bottom-start"
      sx={theme => ({ zIndex: theme.zIndex.modal + 1 })}
    >
      <Paper
        elevation={8}
        sx={{ minWidth: 240, maxWidth: 'calc(100vw - 32px)' }}
      >
        <List
          id={listId}
          role="listbox"
          aria-label={label}
          dense
          sx={{ maxHeight: 280, overflowY: 'auto', py: 0.5 }}
        >
          {options.map((option, index) => (
            <SuggestionRow
              key={option.key}
              id={optionId(listId, index)}
              selected={index === active}
              onPick={() => {
                onPick(option)
              }}
            >
              {option.label}
            </SuggestionRow>
          ))}
        </List>
      </Paper>
    </Popper>
  )
}

function SuggestionRow({
  id,
  selected,
  onPick,
  children
}: {
  id: string
  selected: boolean
  onPick: () => void
  children: ReactNode
}): ReactElement {
  return (
    <ListItemButton
      component="li"
      role="option"
      id={id}
      aria-selected={selected}
      selected={selected}
      // The field keeps its focus and caret while the pointer picks.
      onMouseDown={event => {
        event.preventDefault()
      }}
      onClick={onPick}
      ref={row => {
        if (selected) row?.scrollIntoView({ block: 'nearest' })
      }}
      sx={{ gap: 1.5 }}
    >
      {children}
    </ListItemButton>
  )
}

/**
 * A text area that suggests options as its trigger is typed, as Twake Tasks'
 * editor does: the arrows move through them, Enter or Tab picks one, Escape
 * closes the list and keeps the text, and Ctrl+Enter submits once the list
 * is closed. The list opens below the field, where Tasks' opens below the
 * caret, whose place a text area does not tell.
 */
export function SuggestionField({
  label,
  placeholder,
  value,
  onChange,
  onSubmit,
  suggestions,
  helperText,
  inputRef,
  minRows
}: {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  /** Called on Ctrl+Enter or ⌘+Enter, once the list is closed. */
  onSubmit: () => void
  suggestions: Suggestions
  /** Said below the field, such as why nothing is suggested, or null. */
  helperText: string | null
  /** The text area's own ref, or null. */
  inputRef: ((element: HTMLTextAreaElement | null) => void) | null
  minRows: number
}): ReactElement {
  const listId = useId()
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null)
  const input = useRef<HTMLTextAreaElement | null>(null)
  const [caret, setCaret] = useState<number | null>(null)
  const [focused, setFocused] = useState(false)
  // The start of the trigger that Escape closed the list on, until the caret
  // leaves it.
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [active, setActive] = useState(0)
  // Where the caret goes once the text with an option picked shows.
  const placed = useRef<number | null>(null)
  const typed = caret === null ? null : typedTrigger(value, caret, suggestions)
  const options =
    focused && typed !== null && typed.start !== dismissed
      ? suggestions.search(typed.query)
      : []
  const open = options.length > 0
  const index = Math.min(active, options.length - 1)

  const fieldRef = useCallback(
    (element: HTMLTextAreaElement | null) => {
      input.current = element
      inputRef?.(element)
    },
    [inputRef]
  )
  useLayoutEffect(() => {
    if (placed.current === null) return
    input.current?.setSelectionRange(placed.current, placed.current)
    placed.current = null
  })

  const follow = (text: string, at: number | null) => {
    const next = at === null ? null : typedTrigger(text, at, suggestions)
    // A new query starts from its best match.
    if (next?.query !== typed?.query) setActive(0)
    if (next?.start !== dismissed) setDismissed(null)
    setCaret(at)
  }
  const pick = (option: SuggestionOption) => {
    if (typed === null || caret === null) return
    const at = typed.start + option.insert.length
    placed.current = at
    onChange(value.slice(0, typed.start) + option.insert + value.slice(caret))
    setCaret(at)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    const chosen = options[index]
    if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      const count = options.length
      setActive((index + (event.key === 'ArrowDown' ? 1 : count - 1)) % count)
    } else if (
      chosen &&
      (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey))
    ) {
      event.preventDefault()
      pick(chosen)
    } else if (open && typed && event.key === 'Escape') {
      // Closing the list must not also close a dialog around the field.
      event.stopPropagation()
      setDismissed(typed.start)
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      onSubmit()
    }
  }

  return (
    <>
      <TextField
        ref={setAnchor}
        label={label}
        placeholder={placeholder}
        inputRef={fieldRef}
        value={value}
        onChange={event => {
          onChange(event.target.value)
          follow(event.target.value, event.target.selectionStart)
        }}
        // Taking the focus back with the caret after a trigger opens the
        // list again, where Twake Tasks' editor waits for the next edit: the
        // list follows the caret alone, which a text area keeps while away,
        // so the person finds the options they left. An Escape keeps it
        // closed until the caret leaves the trigger.
        onFocus={() => {
          setFocused(true)
        }}
        onBlur={() => {
          setFocused(false)
        }}
        onKeyDown={onKeyDown}
        helperText={helperText}
        multiline
        minRows={minRows}
        fullWidth
        size="small"
        slotProps={{
          htmlInput: {
            'aria-haspopup': 'listbox',
            'aria-autocomplete': 'list',
            'aria-controls': open ? listId : undefined,
            'aria-activedescendant': open ? optionId(listId, index) : undefined,
            // The caret moves by the keyboard and the pointer too. React
            // also tells where it is along with the first key after the
            // focus, once that key is handled: a caret that has not moved
            // leaves what the key did.
            onSelect: (event: SyntheticEvent<HTMLTextAreaElement>) => {
              const at = event.currentTarget.selectionStart
              if (at !== caret) follow(event.currentTarget.value, at)
            }
          }
        }}
      />
      {open && anchor && (
        <SuggestionList
          anchor={anchor}
          listId={listId}
          label={suggestions.label}
          options={options}
          active={index}
          onPick={pick}
        />
      )}
    </>
  )
}
