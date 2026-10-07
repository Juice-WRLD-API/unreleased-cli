import { accountName, accountRole, apiFetch, passwordLogin } from '../api'
import { getToken, loadConfig, saveConfig } from '../config'

// Stands in for the site's zustand store inside the site modules the CLI
// compiles in. Only what they read is here: the signed-in account (fetched
// before each command, see primeStore), the liked ids, and the sign-in actions,
// which save the token the way the CLI's own login does. libraryArt is the
// local-library cover art fileTypes.ts looks up, which the CLI never has.

interface State {
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
  account: null,
  likedTrackIds: [],
  libraryArt: {},
  playlists: [],
  refreshPlaylists: async () => { /* the CLI re-reads playlists when it needs them */ },
  toggleLike: () => { throw new Error('liking from here goes through the like command') },
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

/** Loads the signed-in account (and liked songs) into the store, at most once a
 *  minute; a guest gets none. Commands read the store synchronously. */
export async function primeStore(force = false): Promise<void> {
  if (!getToken()) { state = { ...state, account: null, likedTrackIds: [] }; return }
  if (!force && state.account && Date.now() - primedAt < 60_000) return
  const [account, favorites] = await Promise.all([
    apiFetch<State['account']>('/accounts/account/me/'),
    apiFetch<{ song: { id: number } }[]>('/library/favorites/').catch(() => []),
  ])
  state = { ...state, account, likedTrackIds: favorites.map((f) => `jw-${f.song.id}`) }
  primedAt = Date.now()
}

export function useStorePick(): never { throw new Error('not available outside the browser') }
