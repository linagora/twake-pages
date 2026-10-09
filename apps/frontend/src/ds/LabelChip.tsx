import { Box } from '@linagora/twake-mui'
import type { ReactElement } from 'react'

import { Highlight } from '@/ds/Highlight'

function hueOf(name: string): number {
  let hash = 7
  for (let index = 0; index < name.length; index++) {
    hash = (hash * 31 + name.charCodeAt(index)) % 360
  }
  return hash
}

// A label comes with no words the backend found, so the chip finds the search
// in the name itself, as Twake Tasks finds the query in the text it marks.
function partsOf(name: string, search: string) {
  if (search === '') return [{ text: name, highlighted: false }]
  const [before = '', ...after] = name.split(search)
  return [
    { text: before, highlighted: false },
    ...after.flatMap(text => [
      { text: search, highlighted: true },
      { text, highlighted: false }
    ])
  ].filter(part => part.text !== '')
}

// Labels have no stored colour, so each name gets a stable hue. Unlike
// Twake Tasks' chip, it may tell how many pages carry the label.
export function LabelChip({
  name,
  highlight = '',
  count
}: {
  name: string
  highlight?: string
  count?: number | undefined
}): ReactElement {
  const hue = hueOf(name)
  return (
    <Box
      component="span"
      sx={theme => ({
        display: 'inline-flex',
        alignItems: 'center',
        height: 20,
        px: 1,
        borderRadius: 10,
        typography: 'caption',
        fontWeight: 500,
        lineHeight: 1,
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: `hsl(${String(hue)} 60% 32%)`,
        bgcolor: `hsl(${String(hue)} 75% 93%)`,
        ...theme.applyStyles('dark', {
          color: `hsl(${String(hue)} 70% 78%)`,
          bgcolor: `hsl(${String(hue)} 40% 24%)`
        })
      })}
    >
      <Highlight parts={partsOf(name, highlight)} />
      {count !== undefined && (
        <Box component="span" sx={{ ml: 0.75, opacity: 0.75 }}>
          {count}
        </Box>
      )}
    </Box>
  )
}
