import { accountName, accountRole, apiFetch, passwordLogin } from '../api'
import { getToken, loadConfig, saveConfig } from '../config'
import { activePlayerTrack, deferCommand } from '../siteCommands'
import { getSong } from '../songs'
import { flushPlays } from '../plays'

// Stands in for the site's zustand store inside the site modules the CLI
// compiles in. Only what they read is here: the signed-in account (fetched
// before each command, see primeStore), the liked ids, and the sign-in actions,
// which save the token the way the CLI's own login does. libraryArt is the
// local-library cover art fileTypes.ts looks up, which the CLI never has.

interface State {
  songPrefs: Record<string, Record<string, unknown>>
  setSongDefaultVersion: (id: number, label: string | null) => void
  setSongExcludedVersions: (id: number, labels: string[]) => void
  _scheduleProfilePush: () => void
  currentTrack?: { id: string; title: string; path: string; streamUrl: string }
  currentTrackFull?: { id: string; lyrics?: string | null; syncedLyrics?: string | null }
  account: (Record<string, unknown> & { id: number }) | null
  likedTrackIds: string[]
  libraryArt: Record<string, string>
  playlists: { id: number; name: string; track_count: number }[]
  toggleLike: (id: string) => void
  refreshPlaylists: () => Promise<void>
  loadAccount: () => Promise<void>
  loginWithPassword: (username: string, password: string, otp?: string) => Promise<void>
  loginWithDiscord: () => Promise<void>
  completeDiscordLogin: (code: string, state: string) => Promise<void>
  completeApprovedLogin: (token: string, user: Record<string, unknown>) => Promise<void>
  signupWithPassword: (username: string, password: string, name?: string) => Promise<void>
}

async function saveSignIn(token: string): Promise<void> {
  const me = await apiFetch<Record<string, unknown> & { id: number }>('/accounts/account/me/', {}, { token })
  const account = { id: me.id, username: me.username as string | undefined, discord_username: me.discord_username as string | undefined, display_name: me.display_name as string | undefined, is_administrator: me.is_administrator as boolean | undefined, is_manager: me.is_manager as boolean | undefined, is_editor: me.is_editor as boolean | undefined }
  saveConfig({ ...loadConfig(), token, user: { id: me.id, name: accountName(account), role: accountRole(account) } })
  state = { ...state, account: me }
}

const notHere = (what: string) => async (): Promise<never> => { throw new Error(`${what} isn't available on the command line (try: login)`) }

let state: State = {
  songPrefs: {},
  setSongDefaultVersion: (id, label) => saveSongPreference(id, { default_version: label }),
  setSongExcludedVersions: (id, labels) => saveSongPreference(id, { excluded_versions: labels }),
  _scheduleProfilePush: () => deferCommand(flushPlays),
  account: null,
  likedTrackIds: [],
  libraryArt: {},
  playlists: [],
  refreshPlaylists: async () => { /* the CLI re-reads playlists when it needs them */ },
  toggleLike: (id) => {
    const songId = Number(id.replace(/^jw-/, ''))
    const liked = state.likedTrackIds.includes(id)
    deferCommand(async () => {
      await apiFetch(liked ? `/library/favorites/${songId}/` : '/library/favorites/', {}, liked ? { method: 'DELETE' } : { method: 'POST', body: { song_id: songId } })
      state.likedTrackIds = liked ? state.likedTrackIds.filter((x) => x !== id) : [...state.likedTrackIds, id]
    })
  },
  loadAccount: async () => { await primeStore(true) },
  loginWithPassword: async (username, password, otp) => { await saveSignIn((await passwordLogin(username, password, otp)).token) },
  loginWithDiscord: notHere('Discord sign-in'),
  completeDiscordLogin: notHere('Discord sign-in'),
  completeApprovedLogin: async (token) => { await saveSignIn(token) },
  signupWithPassword: notHere('signing up'),
}

export const useStore = {
  getState: (): State => state,
  setState: (patch: Partial<State> | ((s: State) => Partial<State>)): void => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  },
}

let primedAt = 0
let primedToken: string | null = null

function saveSongPreference(id: number, patch: Record<string, unknown>): void {
  const song = Number(id)
  if (!Number.isInteger(song) || song <= 0) throw new Error('not a catalogue song')
  state.songPrefs = { ...state.songPrefs, [id]: { ...state.songPrefs[id], ...patch } }
  deferCommand(async () => {
    primedAt = 0
    // Read before writing the JSON blob, preserving names, counts and every
    // preference the CLI does not own.
    const me = await apiFetch<{ user_preferences?: Record<string, unknown>[] }>('/accounts/account/me/')
    if (!Array.isArray(me.user_preferences)) throw new Error('the server does not report song preferences')
    const rows = me.user_preferences.map((row) => ({ ...row }))
    const row = rows.find((r) => r.song === song)
    if (row) Object.assign(row, patch)
    else rows.push({ song, ...patch })
    await apiFetch('/accounts/account/me/', {}, { method: 'PATCH', body: { user_preferences: rows } })
  })
}

export async function primeLyrics(): Promise<void> {
  const track = activePlayerTrack()
  if (track?.songId !== undefined) {
    const song = await getSong(track.songId)
    state.currentTrackFull = { id: `jw-${song.id}`, lyrics: song.lyrics, syncedLyrics: song.synced_lyrics }
  }
}

/** Loads the signed-in account (and liked songs) into the store, at most once a
 *  minute; a guest gets none. Commands read the store synchronously. */
export async function primeStore(force = false): Promise<void> {
  const track = activePlayerTrack()
  const path = track ? new URL(track.url).searchParams.get('path') ?? '' : ''
  state.currentTrack = track ? { id: track.songId === undefined ? `api-file-${path}` : `jw-${track.songId}`, title: track.title, path, streamUrl: track.url } : undefined
  state.currentTrackFull = undefined
  const token = getToken()
  if (!token) { state = { ...state, account: null, likedTrackIds: [], songPrefs: {} }; primedToken = null; return }
  if (!force && token === primedToken && state.account && Date.now() - primedAt < 60_000) return
  const [account, favorites] = await Promise.all([
    apiFetch<State['account']>('/accounts/account/me/'),
    apiFetch<{ song: { id: number } }[]>('/library/favorites/').catch(() => []),
  ])
  const rows = (account?.user_preferences ?? []) as { song: number; [key: string]: unknown }[]
  state = { ...state, account, likedTrackIds: favorites.map((f) => `jw-${f.song.id}`), songPrefs: Object.fromEntries(rows.map((r) => [r.song, r])) }
  primedAt = Date.now()
  primedToken = token
}

export function useStorePick(): never { throw new Error('not available outside the browser') }
