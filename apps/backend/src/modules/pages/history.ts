import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { inTenant, type Db } from '../../infra/db.ts'
import type { HttpServer } from '../../infra/http.ts'
import { Refused, refuse, writeOrRefuse } from '../../infra/refusals.ts'
import type { Identity, RequireIdentity } from '../auth/index.ts'
import { checkBlocks, checkGristUrl, type Blocks } from './blocks.ts'
import { pageParams } from './routes.ts'
import { pageVersions } from './schema.ts'
import {
  pageInReach,
  pageToPublish,
  publishVersion,
  versionOfPage,
  versionSummary
} from './store.ts'

// Past the integers of its column, a number would fail the query: it names
// no version, as a malformed one.
const versionParams = pageParams.extend({
  number: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.int32())
})

function createHistoryStore(db: Db, gristOrigins: readonly string[]) {
  return {
    /**
     * The page's versions, newest first, or null out of the person's reach.
     * Twake Tasks orders a task's history by time, as its changes have no
     * number: a version's number tells the order it was published in.
     */
    history(identity: Identity, pageId: string) {
      return inTenant(db, identity, async tx => {
        if (!(await pageInReach(tx, identity, pageId))) return null
        return tx
          .select(versionSummary)
          .from(pageVersions)
          .where(eq(pageVersions.pageId, pageId))
          .orderBy(desc(pageVersions.number))
      })
    },

    /**
     * The page's version with its title and content, as it was published, or
     * null out of the person's reach.
     */
    version(identity: Identity, pageId: string, number: number) {
      return inTenant(db, identity, async tx => {
        if (!(await pageInReach(tx, identity, pageId))) return null
        const [version] = await tx
          .select({
            ...versionSummary,
            content: pageVersions.content,
            gristUrl: pageVersions.gristUrl
          })
          .from(pageVersions)
          .where(versionOfPage(pageId, number))
        return version ?? null
      })
    },

    /**
     * Publishes the version's title and content again, as the page's next
     * version, which names the version it was restored from: the current
     * version too.
     */
    restore(identity: Identity, pageId: string, number: number) {
      return writeOrRefuse(db, identity, async tx => {
        // Out of the person's reach, a version is as unknown as its page.
        if (!(await pageInReach(tx, identity, pageId))) {
          throw new Refused('not_found')
        }
        const [version] = await tx
          .select({
            title: pageVersions.title,
            content: pageVersions.content,
            gristUrl: pageVersions.gristUrl
          })
          .from(pageVersions)
          .where(versionOfPage(pageId, number))
        if (!version) throw new Refused('not_found')
        // Checked as a draft is, before the wiki's row lock: the checks may
        // have changed since it was published, as the Grist origins may.
        const blocks = checkBlocks(version.content as Blocks, gristOrigins)
        const gristUrl =
          version.gristUrl === null
            ? null
            : checkGristUrl(version.gristUrl, gristOrigins)
        const page = await pageToPublish(tx, identity, pageId)
        return publishVersion(
          tx,
          identity,
          page,
          { title: version.title, ...blocks, gristUrl },
          number
        )
      })
    }
  }
}

export function registerHistory(
  app: HttpServer,
  deps: { db: Db; requireIdentity: RequireIdentity; gristOrigins: string[] }
): void {
  const store = createHistoryStore(deps.db, deps.gristOrigins)

  app.get(
    '/pages/:pageId/versions',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = pageParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const versions = await store.history(identity, params.data.pageId)
      return versions ? { versions } : refuse(reply, 'not_found')
    }
  )

  app.get(
    '/pages/:pageId/versions/:number',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = versionParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const version = await store.version(
        identity,
        params.data.pageId,
        params.data.number
      )
      return version ?? refuse(reply, 'not_found')
    }
  )

  app.post(
    '/pages/:pageId/versions/:number/restore',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = versionParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const result = await store.restore(
        identity,
        params.data.pageId,
        params.data.number
      )
      if (!result.ok) return refuse(reply, result.error)
      return reply.code(201).send(result.value)
    }
  )
}
