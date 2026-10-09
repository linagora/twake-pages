import { and, desc, eq, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { z } from 'zod'
import { inTenant, type Db, type Tx } from '../../infra/db.ts'
import type { HttpServer } from '../../infra/http.ts'
import { refuse } from '../../infra/refusals.ts'
import { storable } from '../../infra/text.ts'
import type { Identity, RequireIdentity } from '../auth/index.ts'
import { roleOn } from '../wikis/access.ts'
import { pageRefOf, reachablePages } from './refs.ts'
import { pages, SEARCHED_LENGTH } from './schema.ts'

// Twake Tasks' query. A NUL character, which PostgreSQL refuses, is refused
// as in a page title.
const searchQuery = z.object({
  q: z.string().trim().min(1).max(200).refine(storable)
})

// A malformed wiki id answers as one in a path does.
const searchedWiki = z.object({ wikiId: z.uuid().optional() })

const SEARCH_LIMIT = 50

// The contract's markers of a word found, U+E000 and U+E001.
const FOUND_START = String.fromCharCode(0xe000)
const FOUND_END = String.fromCharCode(0xe001)

/**
 * The words of the text as PostgreSQL finds them in a page, with the parser
 * and the dictionaries of the `simple` configuration of the search column,
 * so that an email, a host or a version number is one word in both. A
 * hyphenated word or an address also comes in its parts, which alone are
 * kept, so that its last part matches while the person types it.
 */
async function wordsOf(tx: Tx, text: string): Promise<string[]> {
  const rows = await tx.execute<{ word: string }>(sql`
    select word
    from ts_parse('default', ${text}) with ordinality as token (type, text, at)
    join pg_ts_config_map
      on mapcfg = 'simple'::regconfig and maptokentype = token.type
    cross join unnest(ts_lexize(mapdict, token.text)) as word
    where token.type not in (
      select tokid from ts_token_type('default')
      where alias in ('url', 'asciihword', 'hword', 'numhword'))
    order by token.at`)
  return rows.map(row => row.word)
}

// Quoted, a word holds no operator of a tsquery.
const quoted = (word: string) =>
  `'${word.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`

/**
 * Each word as a tsquery operand, the last one as the beginning of a word
 * (ADR 012), found under the given weights of the search column, or under
 * any.
 */
const operandsOf = (words: string[], weights = '') =>
  words.map(
    (word, at) =>
      `${quoted(word)}:${at === words.length - 1 ? '*' : ''}${weights}`
  )

/** Every word. */
const queryOf = (words: string[]) =>
  sql`${operandsOf(words).join(' & ')}::tsquery`

/**
 * How many of the words the title holds: the search column weighs the words
 * of the title A.
 */
const inTitle = (words: string[]) =>
  sql.join(
    operandsOf(words, 'A').map(
      operand => sql`(${pages.search} @@ ${operand}::tsquery)::int`
    ),
    sql` + `
  )

// ts_headline's options. A headline of the whole value keeps it as written,
// where one cut around the words found, as `MaxFragments` cuts it, shows what
// looks like an HTML tag as a blank.
const HEADLINE_OPTIONS = `HighlightAll=true, StartSel=${FOUND_START}, StopSel=${FOUND_END}`

/**
 * The value with every word found between the markers, and the markers it
 * holds itself as blanks. PostgreSQL puts this costly function off until
 * after the sort and the limit, so it marks the pages kept alone.
 */
function marked(value: SQLWrapper, query: SQL) {
  const blanked = sql`translate(${value}, ${FOUND_START + FOUND_END}, '  ')`
  return sql<string>`ts_headline('simple', ${blanked}, ${query}, ${HEADLINE_OPTIONS})`
}

const WORDS_BEFORE = 5
const WORDS_AFTER = 8

/**
 * The words around the first word found in the text, as Twake Tasks quotes
 * a task's description, with an ellipsis where the text goes on. Empty when
 * the text holds none of the words found, as Tasks quotes no description
 * without the text searched.
 */
function excerptOf(markedText: string) {
  const words = markedText.split(/\s+/).filter(Boolean)
  const first = words.findIndex(word => word.includes(FOUND_START))
  if (first === -1) return ''
  const from = Math.max(0, first - WORDS_BEFORE)
  const to = Math.min(words.length, first + 1 + WORDS_AFTER)
  return `${from > 0 ? '…' : ''}${words.slice(from, to).join(' ')}${to < words.length ? '…' : ''}`
}

/**
 * The live pages of the person's wikis, or of the one wiki, with every word
 * of the text, best first. Null for a wiki out of the person's reach.
 *
 * ts_rank alone may put a text above a title: it adds up every word the last
 * word begins, badges and badger as well as badge, and weighs several words
 * by how close they are. So the pages whose titles hold more of the words
 * come first, ts_rank orders those whose titles hold as many, and the last
 * published comes first among equals.
 */
function foundPages(
  db: Db,
  identity: Identity,
  text: string,
  wikiId: string | undefined
) {
  return inTenant(db, identity, async tx => {
    if (wikiId !== undefined && !(await roleOn(tx, identity, wikiId))) {
      return null
    }
    const words = await wordsOf(tx, text)
    if (words.length === 0) return []
    const query = queryOf(words)
    const reachable = reachablePages(tx, identity.userId)
    const found = await tx
      .select({
        ...pageRefOf(reachable),
        updatedAt: pages.updatedAt,
        markedTitle: marked(pages.title, query),
        markedText: marked(sql`left(${pages.text}, ${SEARCHED_LENGTH})`, query)
      })
      .from(pages)
      .innerJoin(reachable, eq(reachable.id, pages.id))
      .where(
        and(
          sql`${pages.search} @@ ${query}`,
          wikiId === undefined ? undefined : eq(pages.wikiId, wikiId)
        )
      )
      .orderBy(
        desc(inTitle(words)),
        desc(sql`ts_rank(${pages.search}, ${query})`),
        desc(pages.updatedAt)
      )
      .limit(SEARCH_LIMIT)
    return found.map(({ updatedAt, markedTitle, markedText, ...page }) => ({
      page,
      markedTitle,
      excerpt: excerptOf(markedText),
      updatedAt
    }))
  })
}

export function registerSearch(
  app: HttpServer,
  deps: { db: Db; requireIdentity: RequireIdentity }
): void {
  app.get(
    '/search',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const query = searchQuery.safeParse(request.query)
      if (!query.success) {
        return reply.code(400).send({ error: 'invalid_request' })
      }
      const scope = searchedWiki.safeParse(request.query)
      if (!scope.success) return refuse(reply, 'not_found')
      const results = await foundPages(
        deps.db,
        identity,
        query.data.q,
        scope.data.wikiId
      )
      if (!results) return refuse(reply, 'not_found')
      return { results }
    }
  )
}
