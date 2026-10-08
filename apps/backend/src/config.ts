import { z } from 'zod'

// Embeds compare the origin of a document with these, so each one must be a
// bare origin: anything after the host would never match. A value that is no
// URL stops there, before the refinement parses it.
const origin = z
  .url({ protocol: /^https?$/, abort: true })
  .refine(
    value => {
      const url = new URL(value)
      return (
        url.pathname === '/' &&
        url.search === '' &&
        url.hash === '' &&
        url.username === '' &&
        url.password === ''
      )
    },
    { message: 'Expected an origin, such as https://grist.example.com' }
  )
  .transform(value => new URL(value).origin)

const configSchema = z.object({
  RABBITMQ_URL: z.url({ protocol: /^amqps?$/ }),
  RABBITMQ_SPACE_EXCHANGE: z.string().min(1).default('space'),
  RABBITMQ_B2B_EXCHANGE: z.string().min(1).default('b2b'),
  RABBITMQ_AUTH_EXCHANGE: z.string().min(1).default('auth'),
  RABBITMQ_SETTINGS_EXCHANGE: z.string().min(1).default('settings'),
  RABBITMQ_ACTIVITY_EXCHANGE: z.string().min(1).default('activity'),
  RABBITMQ_QUEUE: z.string().min(1).default('platform.all.twake-pages'),
  RABBITMQ_DEAD_LETTER_EXCHANGE: z.string().min(1).default('twake-pages.dlx'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  APP_URL: z.url({ protocol: /^https?$/ }),
  OIDC_ISSUER: z.url({ protocol: /^https$/ }),
  OIDC_AUDIENCE: z.string().min(1).default('twakepages'),
  OIDC_CLIENT_ID: z.string().min(1).default('twakepages-backend'),
  OIDC_CLIENT_SECRET: z.string().min(1),
  // Off where there are no spaces; the integration only follows their events.
  SPACE_INTEGRATION: z.enum(['true', 'false']).default('false'),
  // Space separated, empty when no Grist instance may be embedded.
  GRIST_ORIGINS: z
    .string()
    .default('')
    .transform(value => value.split(/\s+/).filter(Boolean))
    .pipe(z.array(origin)),
  SMTP_URL: z.url({ protocol: /^smtps?$/ }).optional(),
  MAIL_FROM: z.string().min(1).default('Twake Pages <pages@twake.app>'),
  HTTP_HOST: z.string().min(1).default('0.0.0.0'),
  HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info')
})

export type Config = z.infer<typeof configSchema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env)
  if (!result.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`)
  }
  return result.data
}
