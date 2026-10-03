import { apiFetch, describeError } from './api'
import { getToken } from './config'
import type { Track } from './player'

// Credits a listened-to play to the account, the way the site does
// (store/useStore.ts, bumpSongPlaycount). Two things happen, both on the
// profile (docs: accounts, "listening-plays" and "Per-Song Preferences"):
//
//   - the play goes into the listening history, one POST to
//     /accounts/account/me/listening-plays/ (what stats, Home and the public
//     profile read);
//   - the song's playcount goes up by one in `user_preferences`. That is a
//     single JSON blob the client owns and replaces whole, with no increment
//     endpoint, so it is read, changed and written back - and debounced, so a
//     run of plays becomes one write. The site merges counts with max(), so a
//     count bumped here is never lost to a stale copy there.
//
// Signed out, nothing is sent.

const DEBOUNCE_MS = 3000
/** The server's cap on user_preferences rows. */
const PREFS_LIMIT = 500

type PrefRow = { song: number; name?: string | null; cover_url?: string | null; default_version?: string | null; excluded_versions?: string[]; playcount?: number; [k: string]: unknown }

let warnedPlay = false
let warnedCount = false
let warn: (text: string) => void = () => undefined

/** Plays waiting to be added to the playcounts: song id -> how many. */
const pending = new Map<number, number>()
let timer: NodeJS.Timeout | null = null
let flushing: Promise<void> = Promise.resolve()

/** Rows with a real override (name, cover, version) are worth more than a
 *  bare count, so those survive the server's cap first, then higher counts. */
function capRows(rows: PrefRow[]): PrefRow[] {
  if (rows.length <= PREFS_LIMIT) return rows
  const overrides = (r: PrefRow): boolean => r.name != null || r.cover_url != null || r.default_version != null || (r.excluded_versions?.length ?? 0) > 0
  return [...rows]
    .sort((a, b) => (Number(overrides(b)) - Number(overrides(a))) || ((b.playcount ?? 0) - (a.playcount ?? 0)))
    .slice(0, PREFS_LIMIT)
}

async function pushCounts(counts: Map<number, number>): Promise<void> {
  const me = await apiFetch<{ user_preferences?: PrefRow[] }>('/accounts/account/me/', {}, { detached: true })
  // Not present on every payload yet; without it there is nothing safe to write back.
  if (!Array.isArray(me.user_preferences)) throw new Error('the server doesn’t report per-song settings')
  const rows = me.user_preferences.map((r) => ({ ...r }))
  for (const [song, n] of counts) {
    const row = rows.find((r) => r.song === song)
    if (row) row.playcount = (Number(row.playcount) || 0) + n
    else rows.push({ song, playcount: n })
  }
  await apiFetch('/accounts/account/me/', {}, { method: 'PATCH', body: { user_preferences: capRows(rows) }, detached: true })
}

/** Writes any waiting playcounts now. The shell awaits this when it closes so
 *  plays from the last few seconds aren't lost. */
export function flushPlays(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null }
  if (pending.size === 0) return flushing
  const counts = new Map(pending)
  pending.clear()
  flushing = flushing.then(() => pushCounts(counts)).catch((err) => {
    // Kept for the next flush, so a hiccup doesn't drop them.
    for (const [song, n] of counts) pending.set(song, (pending.get(song) ?? 0) + n)
    if (!warnedCount) { warnedCount = true; warn(`couldn’t update your play counts (${describeError(err)})`) }
  })
  return flushing
}

/** Records the play. `onWarn` hears about a failure (once per shell for each
 *  kind, so a server outage doesn't print under every song). */
export function recordPlay(track: Track, onWarn: (text: string) => void): void {
  if (track.songId === undefined || !getToken()) return
  warn = onWarn
  apiFetch('/accounts/account/me/listening-plays/', {}, {
    method: 'POST',
    body: { song: track.songId, played_at: new Date().toISOString() },
    detached: true,
  }).catch((err) => {
    if (warnedPlay) return
    warnedPlay = true
    onWarn(`couldn’t add that play to your history (${describeError(err)})`)
  })
  pending.set(track.songId, (pending.get(track.songId) ?? 0) + 1)
  timer ??= setTimeout(() => { void flushPlays() }, DEBOUNCE_MS)
  timer.unref()
}
