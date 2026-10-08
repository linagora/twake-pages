import { Box } from '@linagora/twake-mui'
import type { ReactElement } from 'react'

const fold = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

// Matches ignore case and accents, so each folded character keeps the
// offset of the original one it came from.
function matches(
  text: string,
  query: string
): { start: number; end: number }[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  let folded = ''
  const starts: number[] = []
  const ends: number[] = []
  let offset = 0
  for (const char of text) {
    for (const piece of fold(char)) {
      folded += piece
      starts.push(offset)
      ends.push(offset + char.length)
    }
    offset += char.length
  }
  const found: { start: number; end: number }[] = []
  for (const word of words) {
    let from = folded.indexOf(word)
    while (from !== -1) {
      const last = from + word.length - 1
      found.push({ start: starts[from] ?? 0, end: ends[last] ?? text.length })
      from = folded.indexOf(word, last + 1)
    }
  }
  found.sort((a, b) => a.start - b.start)
  const merged: typeof found = []
  for (const range of found) {
    const previous = merged.at(-1)
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end)
    } else {
      merged.push({ ...range })
    }
  }
  return merged
}

export function Highlight({
  text,
  query
}: {
  text: string
  query: string
}): ReactElement {
  const parts: (string | ReactElement)[] = []
  let shown = 0
  for (const { start, end } of matches(text, query)) {
    parts.push(
      text.slice(shown, start),
      <Box
        key={start}
        component="mark"
        sx={theme => ({
          color: 'inherit',
          bgcolor: theme.alpha(theme.vars.palette.primary.main, 0.2),
          borderRadius: 0.5
        })}
      >
        {text.slice(start, end)}
      </Box>
    )
    shown = end
  }
  parts.push(text.slice(shown))
  return <>{parts}</>
}
