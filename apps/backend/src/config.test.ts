import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.ts'

const required = {
  RABBITMQ_URL: 'amqp://rabbitmq:5672',
  DATABASE_URL: 'postgres://pages@postgres/pages',
  APP_URL: 'https://pages.example.com',
  OIDC_ISSUER: 'https://auth.example.com',
  OIDC_CLIENT_SECRET: 'secret'
}

describe('the RabbitMQ names', () => {
  it('default to the names the platform uses', () => {
    expect(loadConfig(required)).toMatchObject({
      RABBITMQ_SPACE_EXCHANGE: 'space',
      RABBITMQ_B2B_EXCHANGE: 'b2b',
      RABBITMQ_AUTH_EXCHANGE: 'auth',
      RABBITMQ_ACTIVITY_EXCHANGE: 'activity',
      RABBITMQ_QUEUE: 'platform.all.twake-pages',
      RABBITMQ_DEAD_LETTER_EXCHANGE: 'twake-pages.dlx'
    })
  })

  it('can be renamed, but not emptied', () => {
    expect(
      loadConfig({ ...required, RABBITMQ_QUEUE: 'staging.twake-pages' })
    ).toMatchObject({ RABBITMQ_QUEUE: 'staging.twake-pages' })
    expect(() =>
      loadConfig({ ...required, RABBITMQ_ACTIVITY_EXCHANGE: '' })
    ).toThrow(/RABBITMQ_ACTIVITY_EXCHANGE/)
  })
})

describe('the OIDC client', () => {
  it('defaults to the Twake Pages client and audience', () => {
    expect(loadConfig(required)).toMatchObject({
      OIDC_AUDIENCE: 'twakepages',
      OIDC_CLIENT_ID: 'twakepages-backend'
    })
  })
})

describe('the space integration setting', () => {
  it('is off by default', () => {
    expect(loadConfig(required)).toMatchObject({ SPACE_INTEGRATION: 'false' })
  })

  it('can be turned on, with nothing else to set', () => {
    expect(
      loadConfig({ ...required, SPACE_INTEGRATION: 'true' })
    ).toMatchObject({ SPACE_INTEGRATION: 'true' })
  })

  it('takes only true or false', () => {
    expect(() => loadConfig({ ...required, SPACE_INTEGRATION: 'yes' })).toThrow(
      /SPACE_INTEGRATION/
    )
  })
})

describe('the Grist origins', () => {
  it('are none by default', () => {
    expect(loadConfig(required).GRIST_ORIGINS).toEqual([])
    expect(
      loadConfig({ ...required, GRIST_ORIGINS: ' ' }).GRIST_ORIGINS
    ).toEqual([])
  })

  it('are listed with spaces between them', () => {
    expect(
      loadConfig({
        ...required,
        GRIST_ORIGINS: 'https://grist.example.com  http://localhost:8484\n'
      }).GRIST_ORIGINS
    ).toEqual(['https://grist.example.com', 'http://localhost:8484'])
  })

  it('are kept as origins', () => {
    expect(
      loadConfig({
        ...required,
        GRIST_ORIGINS: 'https://Grist.Example.com:443/'
      }).GRIST_ORIGINS
    ).toEqual(['https://grist.example.com'])
  })

  it.each([
    'grist.example.com',
    'ftp://grist.example.com',
    'https://grist.example.com/o/docs',
    'https://grist.example.com/?doc=1',
    'https://user@grist.example.com'
  ])('refuse %s', value => {
    expect(() =>
      loadConfig({
        ...required,
        GRIST_ORIGINS: `https://grist.example.com ${value}`
      })
    ).toThrow(/GRIST_ORIGINS/)
  })
})
