// The SSO of the QA environment: Dex behind a shim that serves it on https,
// as openid-client and the backend require, and adds to its userinfo the
// claims of Twake Workplace's SSO that Dex never sends: the person's uuid,
// the session id, and their organization (sso/people.json; none for B2C).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { request, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer } from 'node:https'

const DEX = new URL(process.env.DEX_URL ?? 'http://dex:5556')
const PEOPLE = JSON.parse(readFileSync('/sso/people.json', 'utf8')) as Record<
  string,
  { org_id: string; org_role: string }
>

// Dex's subject is a protobuf of the user id (field 1) and the connector id
// (field 2), base64url encoded: the user id is the uuid of dex.yaml.
function uuidOf(sub: string) {
  const bytes = Buffer.from(sub, 'base64url')
  return bytes[0] === 0x0a ? bytes.subarray(2, 2 + bytes[1]).toString() : sub
}

// Dex has no session id in its tokens. Every token of one sign-in shares its
// subject and the time Dex authenticated the person.
function sessionOf(accessToken: string) {
  const [, body = ''] = accessToken.split('.')
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as {
    sub?: string
    auth_time?: number
    iat?: number
  }
  return createHash('sha256')
    .update(`${claims.sub ?? ''}:${String(claims.auth_time ?? claims.iat)}`)
    .digest('base64url')
}

function enrich(userinfo: Record<string, unknown>, authorization: string) {
  const sub = String(userinfo.sub)
  const email = String(userinfo.email)
  return {
    ...userinfo,
    uuid: uuidOf(sub),
    sid: sessionOf(authorization.replace(/^Bearer /i, '')),
    ...PEOPLE[email]
  }
}

// Dex answers the app's logout, which has no id_token_hint, with a 400 and
// keeps its session. Like the SSO of Twake Workplace, the shim ends the
// session, dropping Dex's cookie, and sends the person back.
function logout(url: URL, res: ServerResponse) {
  const back = url.searchParams.get('post_logout_redirect_uri')
  const headers = {
    'set-cookie': 'dex_session=; Path=/; Max-Age=0; Secure; HttpOnly'
  }
  if (back) {
    res.writeHead(302, { ...headers, location: back })
    res.end()
    return
  }
  res.writeHead(200, { ...headers, 'content-type': 'text/plain' })
  res.end('Signed out')
}

function forward(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', DEX)
  if (url.pathname === '/logout') {
    logout(url, res)
    return
  }
  // Not the CORS preflight, which has no body
  const isUserinfo =
    url.pathname === '/userinfo' &&
    (req.method === 'GET' || req.method === 'POST')
  const upstream = request(
    {
      host: DEX.hostname,
      port: DEX.port,
      method: req.method,
      path: req.url,
      headers: req.headers
    },
    answer => {
      if (!isUserinfo || answer.statusCode !== 200) {
        res.writeHead(answer.statusCode ?? 502, answer.headers)
        answer.pipe(res)
        return
      }
      let body = ''
      answer.on('data', (chunk: Buffer) => (body += chunk.toString()))
      answer.on('end', () => {
        const headers = { ...answer.headers }
        delete headers['content-length']
        res.writeHead(200, headers)
        try {
          const userinfo = JSON.parse(body) as Record<string, unknown>
          res.end(
            JSON.stringify(enrich(userinfo, req.headers.authorization ?? ''))
          )
        } catch (error) {
          console.error(error)
          res.end(body)
        }
      })
    }
  )
  upstream.on('error', error => {
    console.error(error)
    if (!res.headersSent) res.writeHead(502)
    res.end()
  })
  req.pipe(upstream)
}

createServer(
  {
    key: readFileSync('/certs/sso.key'),
    cert: readFileSync('/certs/sso.crt')
  },
  forward
).listen(Number(process.env.PORT ?? 18933), () => {
  console.log(`SSO shim in front of ${DEX.href}`)
})
