import { getSong, searchSongs, songFromArg as cliSongFromArg } from '../songs'
import type { Song } from '../songs'

// Stands in for the site's lib/terminal/player.ts (which is the player itself)
// inside the command modules that only want to name a song: a title or a number
// from the last find/lyricfind list.

export async function songFromArg(arg: string): Promise<Song & { id: number; name: string }> {
  const ref = await cliSongFromArg(arg)
  return getSong(ref.id)
}

/** Tab candidates for a song title typed over several words (see the site's own). */
export async function completeSongs(before: string[], partial: string): Promise<string[]> {
  const typed = [...before, partial].join(' ').trim().toLowerCase()
  if (typed.length < 2 || /^\d+$/.test(typed)) return []
  const skip = before.length > 0 ? before.join(' ').length + 1 : 0
  const results = await searchSongs(typed, 15)
  return results.map((s) => s.name).filter((n) => n.toLowerCase().startsWith(typed)).map((n) => n.slice(skip))
}
