import { pino } from 'pino'
import { describe, expect, it } from 'vitest'
import { createServer } from './http.ts'

interface LogLine {
  level: number
  msg?: string
}

function serverLoggingTo(lines: LogLine[]) {
  return createServer({
    logger: pino(
      {},
      {
        write: (line: string) => {
          lines.push(JSON.parse(line) as LogLine)
        }
      }
    ),
    isReady: () => Promise.resolve(true)
  })
}

describe('the server', () => {
  it('answers a failure without its cause, which goes to the log', async () => {
    const lines: LogLine[] = []
    const app = serverLoggingTo(lines)
    app.get('/fails', () => {
      throw new Error('Failed query: select name from wikis')
    })

    const response = await app.inject('/fails')

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ error: 'server_error' })
    expect(
      lines.filter(line => line.level >= 50).map(line => line.msg)
    ).toEqual(['Failed query: select name from wikis'])
  })

  it('still says what is wrong with a request it cannot read', async () => {
    const app = serverLoggingTo([])
    app.post('/echo', request => request.body)

    const response = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{'
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      code: 'FST_ERR_CTP_INVALID_JSON_BODY'
    })
  })
})
