import { z } from 'zod'
import type { Db } from '../../infra/db.ts'
import type { HttpServer } from '../../infra/http.ts'
import { refuse } from '../../infra/refusals.ts'
import { storable } from '../../infra/text.ts'
import type { RequireIdentity } from '../auth/index.ts'
import { pageParams } from '../pages/routes.ts'
import { createCommentStore } from './store.ts'

// At most 10 000 characters, as Twake Tasks takes, refused rather than
// changed on their way to the database, as a page's title.
const commentBody = z.string().trim().min(1).max(10_000).refine(storable)

const newComment = z.object({
  body: commentBody,
  // Null answers no comment, as the parentId of a Comment says.
  parentId: z.uuid().nullable().optional()
})

const commentEdit = z.object({ body: commentBody })

const commentParams = z.object({ commentId: z.uuid() })

export function registerComments(
  app: HttpServer,
  deps: { db: Db; requireIdentity: RequireIdentity }
): void {
  const store = createCommentStore(deps.db)

  app.get(
    '/pages/:pageId/comments',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = pageParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const listed = await store.listComments(identity, params.data.pageId)
      return listed ? { comments: listed } : refuse(reply, 'not_found')
    }
  )

  app.post(
    '/pages/:pageId/comments',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = pageParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const body = newComment.safeParse(request.body)
      if (!body.success) {
        return reply.code(400).send({ error: 'invalid_request' })
      }
      const result = await store.addComment(
        identity,
        params.data.pageId,
        body.data
      )
      if (!result.ok) return refuse(reply, result.error)
      return reply.code(201).send(result.value)
    }
  )

  app.patch(
    '/comments/:commentId',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = commentParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const body = commentEdit.safeParse(request.body)
      if (!body.success) {
        return reply.code(400).send({ error: 'invalid_request' })
      }
      const result = await store.editComment(
        identity,
        params.data.commentId,
        body.data.body
      )
      return result.ok ? result.value : refuse(reply, result.error)
    }
  )
}
