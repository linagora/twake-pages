import { QueryClient } from '@tanstack/react-query'

const MAX_QUERY_RETRIES = 2

function httpStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return null
  }
  return typeof error.status === 'number' ? error.status : null
}

export function shouldRetryQuery(
  failureCount: number,
  error: unknown
): boolean {
  const status = httpStatus(error)
  if (status !== null && status >= 400 && status < 500) return false
  return failureCount < MAX_QUERY_RETRIES
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetryQuery, refetchOnWindowFocus: false },
      mutations: { retry: false }
    }
  })
}
