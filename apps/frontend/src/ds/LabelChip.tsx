import { Box } from '@linagora/twake-mui'
import type { ReactElement } from 'react'

function hueOf(name: string): number {
  let hash = 7
  for (let index = 0; index < name.length; index++) {
    hash = (hash * 31 + name.charCodeAt(index)) % 360
  }
  return hash
}

// Labels have no stored colour, so each name gets a stable hue.
export function LabelChip({ name }: { name: string }): ReactElement {
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
      {name}
    </Box>
  )
}
