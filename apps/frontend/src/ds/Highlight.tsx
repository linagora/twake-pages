import { Box } from '@linagora/twake-mui'
import { Fragment, type ReactElement } from 'react'

/**
 * Text with the words found marked, each part as text. Twake Tasks finds the
 * words of the query in the text itself; full text search tells which words
 * it found, the last one by its beginning only, so the parts come marked.
 */
export function Highlight({
  parts
}: {
  parts: readonly { text: string; highlighted: boolean }[]
}): ReactElement {
  return (
    <>
      {parts.map((part, index) =>
        part.highlighted ? (
          <Box
            key={index}
            component="mark"
            sx={theme => ({
              color: 'inherit',
              bgcolor: theme.alpha(theme.vars.palette.primary.main, 0.2),
              borderRadius: 0.5
            })}
          >
            {part.text}
          </Box>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        )
      )}
    </>
  )
}
