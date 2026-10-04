import { fail, type Command } from './command'
import { accentRamp, color } from './out'
import { playerOf } from './playback'
import type { Track } from './player'
import { canOpenScreen, openScreen, wrapText, type Screen, type ScreenBody } from './screen'
import { getSong } from './songs'

// `karaoke` (alias `lyrics`): the current song's lyrics, following along. Synced
// (LRC) lyrics highlight the line being sung and scroll with the song; plain
// lyrics just scroll with the arrow keys. Same screen as the site terminal's.

interface Line { time: number; text: string }

const TIME = /\[(\d{1,2}):(\d{2})[.:](\d{2,3})\]/g

/** The site's parseLrc (lib/lyrics.ts pulls in React, so it can't be compiled in). */
function parseLrc(lrc: string): Line[] | null {
  const lines: Line[] = []
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(TIME)]
    if (stamps.length === 0) continue
    const text = raw.replace(TIME, '').trim()
    for (const m of stamps) lines.push({ time: Number(m[1]) * 60 + Number(m[2]) + Number(m[3].padEnd(3, '0')) / 1000, text })
  }
  return lines.length ? lines.sort((a, b) => a.time - b.time) : null
}

/** Index of the line being sung at `time` (-1 before the first). */
function currentIndex(lines: Line[], time: number): number {
  let idx = -1
  for (let i = 0; i < lines.length && lines[i].time <= time; i++) idx = i
  return idx
}

type Lyrics = { kind: 'synced'; lines: Line[] } | { kind: 'plain'; text: string } | { kind: 'none' } | { kind: 'error' }

async function loadLyrics(track: Track): Promise<Lyrics> {
  if (track.songId === undefined) return { kind: 'none' }
  try {
    const song = await getSong(track.songId) as { lyrics?: string | null; synced_lyrics?: string | null }
    const synced = song.synced_lyrics ? parseLrc(song.synced_lyrics) : null
    if (synced) return { kind: 'synced', lines: synced }
    const raw = song.lyrics?.trim()
    if (!raw) return { kind: 'none' }
    return parseLrc(raw) ? { kind: 'synced', lines: parseLrc(raw) as Line[] } : { kind: 'plain', text: raw }
  } catch { return { kind: 'error' } }
}

function karaokeScreen(sh: Parameters<Command['run']>[1]): ScreenBody {
  const player = playerOf(sh)
  let timer: NodeJS.Timeout | null = null
  let poller: NodeJS.Timeout | null = null
  let loaded: Track | null = null
  let lyrics: Lyrics | null = null // null while loading
  let base = 0
  let baseAt = Date.now()
  let moving = false
  let scroll = 0 // plain lyrics only

  const poll = async (s: Screen): Promise<void> => {
    const track = player.current
    if (!track) { s.exit('nothing is playing'); return }
    if (track !== loaded) {
      loaded = track
      lyrics = null
      scroll = 0
      void loadLyrics(track).then((l) => { if (loaded === track) lyrics = l })
    }
    const [pos, paused] = await Promise.all([player.position(), player.paused()])
    base = pos
    baseAt = Date.now()
    moving = !paused
  }

  const frame = (s: Screen): void => {
    if (s.closed) return
    const now = base + (moving ? ((Date.now() - baseAt) / 1000) * player.speed : 0)
    const accent = `\x1b[${accentRamp()[2]};1m`
    const height = Math.max(3, s.rows - 4)
    const width = Math.max(10, s.cols - 4)
    const out: string[] = [`${color.bold(`karaoke · ${loaded?.title ?? ''}`)}${moving ? '' : color.dim('  ⏸')}`, '']

    if (lyrics === null) out.push(color.dim('  looking for lyrics…'))
    else if (lyrics.kind === 'none') out.push(color.dim('  no lyrics for this song'))
    else if (lyrics.kind === 'error') out.push(color.dim('  couldn’t load the lyrics'))
    else if (lyrics.kind === 'plain') {
      const wrapped = wrapText(lyrics.text, width)
      scroll = Math.max(0, Math.min(scroll, wrapped.length - height))
      out.push(...wrapped.slice(scroll, scroll + height).map((l) => `  ${l}`))
    } else {
      // Wrapped rows per lyric line; keep the current line centred.
      const rows: { text: string; hot: boolean; first: boolean }[] = []
      const index = currentIndex(lyrics.lines, now)
      let centre = 0
      lyrics.lines.forEach((l, i) => {
        if (i === index) centre = rows.length
        wrapText(l.text || ' ', width - 2).forEach((text, k) => rows.push({ text, hot: i === index, first: k === 0 }))
      })
      const top = Math.max(0, Math.min(centre - Math.floor(height / 2), rows.length - height))
      for (const r of rows.slice(top, top + height)) {
        out.push(r.hot ? `${accent}${r.first ? '▶ ' : '  '}${r.text}\x1b[0m` : color.dim(`  ${r.text}`))
      }
    }
    while (out.length < s.rows - 1) out.push('')
    out.push(color.dim(` q leaves · space pauses${lyrics?.kind === 'plain' ? ' · ↑↓ scroll' : ''}`))
    s.draw(out)
  }

  return {
    start: async (s) => {
      await poll(s)
      timer = setInterval(() => frame(s), 120)
      poller = setInterval(() => { void poll(s).catch(() => undefined) }, 150)
    },
    key: (str, key, s) => {
      if (str === 'q' || key.name === 'escape' || (key.ctrl && key.name === 'c')) s.exit()
      else if (str === ' ') { void player.paused().then((p) => player.setPaused(!p)).catch(() => undefined) }
      else if (key.name === 'up') scroll--
      else if (key.name === 'down') scroll++
      else if (key.name === 'pageup') scroll -= Math.max(1, s.rows - 5)
      else if (key.name === 'pagedown') scroll += Math.max(1, s.rows - 5)
    },
    stop: () => {
      if (timer) clearInterval(timer)
      if (poller) clearInterval(poller)
    },
  }
}

export const KARAOKE_COMMANDS: Command[] = [
  {
    name: 'karaoke', aliases: ['lyrics'], group: 'Fun', usage: 'karaoke',
    description: 'The current song’s lyrics, following along (synced lyrics scroll with the song). q leaves',
    run: async (_a, sh) => {
      if (sh.scripted) fail('karaoke: not inside a script or watch')
      if (!canOpenScreen()) fail('karaoke: needs an interactive terminal')
      if (!playerOf(sh).current) fail('nothing is playing')
      const message = await openScreen(karaokeScreen(sh))
      if (message) sh.print(message, 'dim')
    },
  },
]
