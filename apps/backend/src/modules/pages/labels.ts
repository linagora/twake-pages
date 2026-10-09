import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  notExists,
  notInArray
} from 'drizzle-orm'
import { z } from 'zod'
import { inTenant, type Db, type Tx } from '../../infra/db.ts'
import type { HttpServer } from '../../infra/http.ts'
import { Refused, refuse, writeOrRefuse } from '../../infra/refusals.ts'
import type { Identity, RequireIdentity } from '../auth/index.ts'
import { checkRole, roleOn } from '../wikis/access.ts'
import { bumpWiki } from '../wikis/live.ts'
import { pageParams, wikiParams } from './routes.ts'
import { labels, pageLabels, pages } from './schema.ts'
import { labelsOf } from './store.ts'

// At most 50 names, as Twake Tasks takes at most 50 label ids.
const labelling = z.object({ names: z.array(z.string()).max(50) })

// The contract's letters and digits, in every alphabet: a letter keeps the
// marks written with it, such as the vowel signs of Hindi, an accent typed
// apart or the dot of "İ" once lowercased, and a digit is a decimal one,
// which "½", "²" or "Ⅻ" are not.
const LABEL_NAME = /^[\p{L}\p{M}\p{Nd}_-]{1,50}$/u

/**
 * The label name the text makes, or null for none: trimmed, lowercased, then
 * composed (NFC), so that an "é" typed in one character or in two makes one
 * label.
 */
function labelNameOf(text: string) {
  const name = text.trim().toLowerCase().normalize('NFC')
  return LABEL_NAME.test(name) ? name : null
}

/** The label names the texts make, once each, unless one makes none. */
function labelNamesOf(texts: string[]) {
  const names = new Set<string>()
  for (const text of texts) {
    const name = labelNameOf(text)
    if (name === null) throw new Refused('invalid_label')
    names.add(name)
  }
  return [...names]
}

/** Makes the named labels the wiki lacks; answers the ids of all of them. */
async function ensureLabels(
  tx: Tx,
  wiki: { id: string; organizationId: string | null },
  names: string[]
) {
  await tx
    .insert(labels)
    .values(
      names.map(name => ({
        wikiId: wiki.id,
        organizationId: wiki.organizationId,
        name
      }))
    )
    .onConflictDoNothing()
  const named = await tx
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.wikiId, wiki.id), inArray(labels.name, names)))
  return named.map(({ id }) => id)
}

// A page in the trash still carries its labels, but the wiki lists only its
// live pages, and the labels they carry.
const toItsLivePage = and(
  eq(pages.id, pageLabels.pageId),
  isNull(pages.deletedAt)
)

function createLabelStore(db: Db) {
  return {
    /**
     * The page's labels once it carries the named ones, and only those.
     * Twake Tasks gives a task labels made beforehand, by id, and keeps a
     * label no task carries. A page names its labels instead, so the missing
     * ones are made here, and those no page carries any more are deleted,
     * as api.md says.
     */
    setLabels(identity: Identity, pageId: string, names: string[]) {
      return writeOrRefuse(db, identity, async tx => {
        const [found] = await tx
          .select({ wikiId: pages.wikiId })
          .from(pages)
          .where(eq(pages.id, pageId))
        if (!found) throw new Refused('not_found')
        await checkRole(tx, identity, found.wikiId, 'editor')
        const wiki = await bumpWiki(tx, found.wikiId)
        // Read after the lock, which every change to the wiki's pages takes.
        const [page] = await tx
          .select({ deletedAt: pages.deletedAt })
          .from(pages)
          .where(eq(pages.id, pageId))
        if (!page) throw new Refused('not_found')
        if (page.deletedAt) throw new Refused('in_trash')
        const wanted = labelNamesOf(names)
        const kept =
          wanted.length === 0
            ? []
            : await ensureLabels(tx, { id: found.wikiId, ...wiki }, wanted)
        const dropped = await tx
          .delete(pageLabels)
          .where(
            and(
              eq(pageLabels.pageId, pageId),
              notInArray(pageLabels.labelId, kept)
            )
          )
          .returning({ labelId: pageLabels.labelId })
        if (dropped.length > 0) {
          // A page in the trash still carries its labels, and may come back
          // with them.
          await tx.delete(labels).where(
            and(
              inArray(
                labels.id,
                dropped.map(({ labelId }) => labelId)
              ),
              notExists(
                tx
                  .select({ labelId: pageLabels.labelId })
                  .from(pageLabels)
                  .where(eq(pageLabels.labelId, labels.id))
              )
            )
          )
        }
        if (kept.length > 0) {
          await tx
            .insert(pageLabels)
            .values(
              kept.map(labelId => ({
                pageId,
                labelId,
                organizationId: wiki.organizationId
              }))
            )
            .onConflictDoNothing()
        }
        return labelsOf(tx, pageId)
      })
    },

    /**
     * The labels the wiki's live pages carry, by name, with how many carry
     * each, or null for a wiki out of the person's reach.
     */
    wikiLabels(identity: Identity, wikiId: string) {
      return inTenant(db, identity, async tx => {
        if (!(await roleOn(tx, identity, wikiId))) return null
        return tx
          .select({ name: labels.name, pages: count() })
          .from(labels)
          .innerJoin(pageLabels, eq(pageLabels.labelId, labels.id))
          .innerJoin(pages, toItsLivePage)
          .where(eq(labels.wikiId, wikiId))
          .groupBy(labels.name)
          .orderBy(asc(labels.name))
      })
    }
  }
}

export function registerLabels(
  app: HttpServer,
  deps: { db: Db; requireIdentity: RequireIdentity }
): void {
  const store = createLabelStore(deps.db)

  app.put(
    '/pages/:pageId/labels',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = pageParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const body = labelling.safeParse(request.body)
      if (!body.success) {
        return reply.code(400).send({ error: 'invalid_request' })
      }
      const result = await store.setLabels(
        identity,
        params.data.pageId,
        body.data.names
      )
      if (!result.ok) return refuse(reply, result.error)
      return { labels: result.value }
    }
  )

  app.get(
    '/wikis/:wikiId/labels',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = wikiParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const listed = await store.wikiLabels(identity, params.data.wikiId)
      return listed ? { labels: listed } : refuse(reply, 'not_found')
    }
  )
}
