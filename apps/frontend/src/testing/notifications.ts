import type { Page } from '@/domain/page'
import type { FakePagesApi } from '@/testing/fakePagesApi'

/**
 * Publishes a version of the page, so its followers each get a notification
 * about it. The version starts from the page's first, as a fresh page's does.
 */
export function toldAboutAVersion(
  api: FakePagesApi,
  pageId: string,
  title: string
): Promise<Page> {
  return api.publish(pageId, { baseVersion: 1, title, content: [] })
}
