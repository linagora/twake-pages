import { Avatar, getInitials, nameToColor } from '@linagora/twake-mui'
import type { ComponentProps, ReactElement } from 'react'

import { displayName } from '@/domain/person'

export function PersonAvatar({
  email,
  name = null,
  avatar = null,
  label,
  size = 24
}: {
  email: string
  name?: string | null
  avatar?: string | null | undefined
  label?: string
  size?: ComponentProps<typeof Avatar>['size']
}): ReactElement {
  return (
    <Avatar
      size={size}
      {...(avatar && { src: avatar })}
      color={nameToColor(email) ?? 'sunrise'}
      {...(label
        ? { role: 'img', 'aria-label': label }
        : { 'aria-hidden': true })}
    >
      {getInitials(displayName({ email, name }), email)}
    </Avatar>
  )
}
