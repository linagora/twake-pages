// A stand-in for Grist: at every address, a page whose heading is the path
// of that address. As Twake Pages needs of a Grist deployment (ADR 012), it
// lets the hosts of FRAME_ANCESTORS frame its pages, and only them.
import { createServer } from 'node:http'

const FRAME_ANCESTORS = process.env.FRAME_ANCESTORS ?? "'self'"

/** `text` written as HTML text. */
const escaped = (text: string) =>
  text.replace(/[&<>"']/g, char => `&#${String(char.charCodeAt(0))};`)

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://grist')
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': `frame-ancestors ${FRAME_ANCESTORS}`
  })
  res.end(`<!doctype html><title>Grist</title><h1>${escaped(pathname)}</h1>`)
})

server.listen(Number(process.env.PORT ?? 3504), () => {
  console.log('stand-in Grist listening')
})
