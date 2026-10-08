import Fastify, {
  LogController,
  type FastifyBaseLogger,
  type FastifyInstance
} from 'fastify'

export function createServer(deps: {
  logger: FastifyBaseLogger
  isReady: () => Promise<boolean>
}): HttpServer {
  const app = Fastify({
    loggerInstance: deps.logger,
    logController: new LogController({
      disableRequestLogging: request => request.url.startsWith('/health/')
    })
  })

  app.get('/health/live', () => ({ status: 'ok' }))

  app.get('/health/ready', async (_request, reply) => {
    const ready = await deps.isReady().catch(() => false)
    return reply
      .code(ready ? 200 : 503)
      .send({ status: ready ? 'ok' : 'unavailable' })
  })

  return app
}

export type HttpServer = FastifyInstance
