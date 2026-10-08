import Fastify, {
  LogController,
  type FastifyBaseLogger,
  type FastifyError,
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

  // Fastify answers with the error's message, which for a failed query holds
  // its SQL and parameters. Twake Tasks keeps that answer.
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const status =
      error.statusCode !== undefined && error.statusCode >= 400
        ? error.statusCode
        : 500
    if (status < 500) return reply.send(error)
    reply.code(status)
    reply.log.error({ req: request, res: reply, err: error }, error.message)
    return reply.send({ error: 'server_error' })
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
