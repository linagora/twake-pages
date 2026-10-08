export function displayName(person: {
  email: string
  name: string | null
}): string {
  const name = person.name?.trim() ?? ''
  return name === '' ? person.email : name
}
