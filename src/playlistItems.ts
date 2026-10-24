import { apiFetch, apiUrl } from './api'
import { getToken } from './config'
import { fail } from './command'
import { getSong, type SongRef, type ListedRow } from './songs'
import { trackFromFile, trackFromSong } from './player'

export interface PlaylistItem {
  id: number
  position: number
  source?: 'song' | 'comp' | 'donor' | 'local'
  song: (SongRef & { path?: string; length?: string; era?: { name: string } | null }) | null
  channel?: string | null
  filepath?: string
  donor_file?: { file_id: string; filename: string; mime_type: string } | null
  local_id?: string
  title?: string
}

export type PlaylistEntry = { song_id: number } | { source: 'comp'; path: string; channel?: string } | { source: 'donor'; file_id: string }
export interface PlaylistRow extends ListedRow { item: PlaylistItem }

export async function playlistRows(id: number): Promise<{ name: string; rows: PlaylistRow[] }> {
  const detail = await apiFetch<{ name: string; items: PlaylistItem[] }>(`/library/playlists/${id}/`, { omit_cover_image: 'true' })
  const rows = await Promise.all([...detail.items].sort((a, b) => a.position - b.position).map(async (item): Promise<PlaylistRow> => {
    const name = item.song?.name || item.title || item.donor_file?.filename || item.filepath?.split('/').pop() || 'Unavailable file'
    if (item.song) {
      const song = item.song.path === undefined ? await getSong(item.song.id) : item.song
      return { item, name, song: item.song, track: song.path ? trackFromSong({ ...song, path: song.path }) : undefined }
    }
    if (item.source === 'comp' && item.filepath) return { item, name, track: trackFromFile(name, item.filepath, item.channel || 'comp') }
    if (item.source === 'donor' && item.donor_file && !item.donor_file.mime_type.startsWith('image/')) {
      const token = getToken()
      return { item, name, track: { title: name, url: apiUrl(`/accounts/donor/files/${encodeURIComponent(item.donor_file.file_id)}/download/`), duration: 0, headers: token ? { Authorization: `Token ${token}` } : {} } }
    }
    return { item, name }
  }))
  return { name: detail.name, rows }
}

export function playlistRowLabel(row: PlaylistRow): string {
  if (row.song) return `${row.name}${row.track ? '' : '  (no audio)'}`
  const kind = row.item.source === 'donor' ? 'my file' : row.item.source === 'local' ? 'local, not on this device' : `file${row.item.channel && row.item.channel !== 'comp' ? `, ${row.item.channel}` : ''}`
  return `${row.name}  (${kind})`
}

export function matchingEntry(items: PlaylistItem[], entry: PlaylistEntry): PlaylistItem {
  return items.find((item) => 'song_id' in entry ? item.song?.id === entry.song_id
    : entry.source === 'donor' ? item.donor_file?.file_id === entry.file_id
      : item.source === 'comp' && item.filepath === entry.path && (item.channel || 'comp') === (entry.channel || 'comp')) ?? fail('that entry is not in the playlist')
}
