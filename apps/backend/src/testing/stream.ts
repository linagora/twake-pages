// Reads server-sent events as `id` and `data` pairs, one per message.
export function openStream(url: string, token: string) {
  const controller = new AbortController()
  const response = fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: controller.signal
  })
  let buffer = ''
  const decoder = new TextDecoder()
  async function* messages() {
    const body = (await response).body
    if (!body) return
    for await (const chunk of body) {
      buffer += decoder.decode(chunk as Uint8Array, { stream: true })
      let end = buffer.indexOf('\n\n')
      while (end >= 0) {
        const block = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const fields = Object.fromEntries(
          block
            .split('\n')
            .filter(line => !line.startsWith(':'))
            .map(line => [
              line.slice(0, line.indexOf(':')),
              line.slice(line.indexOf(':') + 2)
            ])
        ) as Record<string, string>
        if (fields.id !== undefined) yield fields
        end = buffer.indexOf('\n\n')
      }
    }
  }
  return {
    response,
    messages: messages(),
    close: () => {
      controller.abort()
    }
  }
}
