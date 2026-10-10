import { Box } from '@linagora/twake-mui'
import type { ReactElement } from 'react'

/**
 * A person a text mentions, as `@` and their name, titled with the email it
 * was written with, in the look Twake Tasks gives one.
 */
export function Mention({
  name,
  email
}: {
  name: string
  email: string
}): ReactElement {
  return (
    <Box
      component="span"
      title={email}
      sx={theme => ({
        padding: '0.05em 0.35em',
        borderRadius: 4,
        fontWeight: 500,
        color: theme.vars.palette.primary.main,
        backgroundColor: theme.alpha(theme.vars.palette.primary.main, 0.12)
      })}
    >
      {`@${name}`}
    </Box>
  )
}
