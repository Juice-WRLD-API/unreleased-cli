import { apiFetch } from '../api'
import { fail } from '../command'

// Stands in for the site's lib/terminal/users.ts (which finds people through the
// chat member lists) inside the command modules that only need to turn a typed
// name or id into a user. Here that goes through the admin account list, so
// names work for administrators and anyone can be given by id.

export interface DirUser { id: number; username: string; display: string; discord: string; role: string }

let cache: DirUser[] | null = null

export async function directory(): Promise<DirUser[]> {
  if (!cache) {
    const rows = await apiFetch<{ user_id: number; username: string; discord_username: string; role: string }[]>('/accounts/admin/users/')
    cache = rows.map((u) => ({ id: u.user_id, username: u.username, display: '', discord: u.discord_username, role: u.role }))
  }
  return cache
}

export async function resolveUser(handle: string): Promise<DirUser> {
  const q = handle.trim().replace(/^@/, '')
  if (!q) fail('name a user')
  if (/^\d+$/.test(q)) return { id: Number(q), username: `user #${q}`, display: '', discord: '', role: '' }
  const lower = q.toLowerCase()
  const list = await directory()
  const hits = list.filter((u) => u.username.toLowerCase().includes(lower) || u.discord.toLowerCase().includes(lower))
  const exact = hits.find((u) => u.username.toLowerCase() === lower)
  if (exact) return exact
  if (hits.length === 1) return hits[0]
  if (hits.length > 1) fail(`"${q}" could be: ${hits.slice(0, 6).map((u) => u.username).join(', ')}${hits.length > 6 ? ', …' : ''}`)
  return fail(`no user matching "${q}" (names need an administrator account; anyone can be given by id)`)
}
