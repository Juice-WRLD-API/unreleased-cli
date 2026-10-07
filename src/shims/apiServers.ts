import { apiBase, baseFor as cliBaseFor } from '../api'

// Stands in for the site's lib/apiServers.ts: which server each API path goes to
// is the CLI's own setting here (the `api` command), not the browser's.

export const DEFAULT_JWAPI_BASE = 'https://juicewrldapi.com/juicewrld'
export const JWAPI_BASE = apiBase()
export const baseFor = (path: string): string => cliBaseFor(path)
export const routeUrl = (path: string): string => `${cliBaseFor(path)}${path}`
export const CHAT_API_BASE = cliBaseFor('/chat')
export const RADIO_API_BASE = cliBaseFor('/radio')
