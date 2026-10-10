export interface Person {
  id: string
  email: string
  name: string | null
}

export function displayName(person: {
  email: string
  name: string | null
}): string {
  const name = person.name?.trim() ?? ''
  return name === '' ? person.email : name
}

/** Whether two emails are one, as the backend compares them: in any case. */
export function sameEmail(email: string, other: string | null): boolean {
  return email.toLowerCase() === other?.toLowerCase()
}
