import { Box, Typography } from '@linagora/twake-mui'
import type { ReactElement, ReactNode } from 'react'

/** Results under their title and count, as Twake Tasks groups its tasks. */
export function ResultList({
  label,
  count,
  children
}: {
  label: string
  count: number
  children: ReactNode
}): ReactElement {
  return (
    <Box component="section" aria-label={label} sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1 }}>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
          {label}
        </Typography>
        <Typography variant="caption" color="textSecondary">
          {count}
        </Typography>
      </Box>
      <Box
        component="ul"
        sx={{
          listStyle: 'none',
          m: 0,
          p: 0,
          border: 1,
          borderColor: 'divider',
          borderRadius: 2,
          overflow: 'hidden'
        }}
      >
        {children}
      </Box>
    </Box>
  )
}

/**
 * A result whose title, a link, covers the row, above an excerpt and its
 * place. Unlike the rows of Twake Tasks, the excerpt wraps, so that the words
 * found show on a phone too.
 */
export function ResultRow({
  label,
  title,
  excerpt,
  place
}: {
  label: string
  title: ReactNode
  excerpt?: ReactNode
  place: string
}): ReactElement {
  return (
    <Box
      component="li"
      aria-label={label}
      sx={{
        position: 'relative',
        px: 2,
        py: 1,
        bgcolor: 'background.paper',
        '& + &': { borderTop: 1, borderColor: 'divider' },
        '&:hover, &:focus-within': { bgcolor: 'action.hover' },
        '& a': { color: 'text.primary', textDecoration: 'none' },
        '& a::after': { content: '""', position: 'absolute', inset: 0 },
        '& a:focus-visible': { outline: 'none' }
      }}
    >
      <Typography variant="body1" noWrap>
        {title}
      </Typography>
      {excerpt && (
        <Typography variant="body2" color="textSecondary">
          {excerpt}
        </Typography>
      )}
      <Typography variant="caption" component="p" color="textSecondary" noWrap>
        {place}
      </Typography>
    </Box>
  )
}
