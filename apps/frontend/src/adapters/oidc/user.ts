import type { UserInfoResponse } from 'openid-client'

import type { User } from '@/application/session'

/** The signed-in user, from the SSO's answer */
export function userOf(
  userinfo: UserInfoResponse,
  idToken: string | undefined
): User {
  const { workplaceFqdn } = userinfo
  return {
    name: userinfo.name ?? null,
    email: userinfo.email ?? null,
    workplaceFqdn: typeof workplaceFqdn === 'string' ? workplaceFqdn : null,
    idToken: idToken ?? null
  }
}
