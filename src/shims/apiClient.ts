import { getActiveSignal, VERSION } from '../api'
import { getToken } from '../config'

// Stands in for the site's lib/apiClient.ts inside the site modules the CLI
// compiles in (heardle, versionsApi, and every lib/*Api.ts the terminal commands
// call): the same exports, over Node's fetch, with the CLI's token, user agent
// and Ctrl+C. The offline cache and request de-duplication the site has are
// left out - a command runs one request at a time.

export interface ApiRequestOptions extends RequestInit {
  cacheKey?: string
  parseError?: (res: Response) => Promise<string>
}

async function defaultParseError(res: Response): Promise<string> {
  try {
    const body = await res.json() as Record<string, unknown>
    if (typeof body === 'string') return body
    if (body.detail) return String(body.detail)
    const firstKey = Object.keys(body)[0]
    if (firstKey) {
      const val = body[firstKey]
      return Array.isArray(val) ? String(val[0]) : String(val)
    }
  } catch { /* not JSON */ }
  return `Request failed (${res.status})`
}

export function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Token ${token}` } : {}
}

export async function apiRequest<T>(url: string, options: ApiRequestOptions = {}): Promise<T> {
  const { cacheKey: _cacheKey, parseError = defaultParseError, ...init } = options
  const given = (init.headers ?? {}) as Record<string, string>
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': `unreleased-cli/${VERSION}`,
    // A plain GET goes out signed in, as the CLI's other requests do.
    ...(Object.keys(given).some((k) => k.toLowerCase() === 'authorization') ? {} : authHeaders(getToken())),
    ...given,
  }
  const res = await fetch(url, { ...init, headers, signal: init.signal ?? getActiveSignal() })
  if (!res.ok) throw new Error(await parseError(res))
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export async function authedRequest<T>(url: string, options: ApiRequestOptions = {}, token: string | null): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeaders(token) }
  return apiRequest<T>(url, { ...options, headers: { ...headers, ...(options.headers as Record<string, string>) } })
}

export const isAbortError = (err: unknown): boolean => (err as Error | null)?.name === 'AbortError'

export function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
    if (signal.aborted) { onAbort(); return }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export function cacheDelete(): void { /* no offline cache here */ }
