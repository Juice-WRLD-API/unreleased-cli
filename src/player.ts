import { streamUrl } from './api'
import { findMpv, Mpv, MPV_MISSING, type MpvEvent } from './mpv'
import { pref, setPref } from './prefs'

// The play queue, the way the site's store/queueSlice.ts runs it: a list and
// an index, repeat none/all/one, shuffle that reorders what's still to come
// (and reshuffles on wrap with repeat all), previous restarting the song after
// three seconds. mpv plays one file at a time; when it reaches the end, the
// next one is loaded here.

export interface Track {
  title: string
  /** Library song id; absent for a file played straight from the tree. */
  songId?: number
  era?: string
  url: string
  /** Seconds, from the library; 0 when unknown (mpv knows once it's loaded). */
  duration: number
}

export type Repeat = 'none' | 'all' | 'one'

export function trackFromSong(song: { id: number; name: string; path: string; length?: string; era?: { name: string } | null }): Track {
  return { title: song.name, songId: song.id, era: song.era?.name, url: streamUrl(song.path), duration: parseClock(song.length) }
}

export function trackFromFile(name: string, path: string, channel: string): Track {
  return { title: name.replace(/\.[a-z0-9]{2,4}$/i, ''), url: streamUrl(path, channel), duration: 0 }
}

function parseClock(length: string | null | undefined): number {
  const parts = (length ?? '').split(':').map(Number)
  if (parts.some((n) => !Number.isFinite(n))) return 0
  return parts.length === 2 ? parts[0] * 60 + parts[1] : parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : 0
}

function fisherYates<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export class Player {
  queue: Track[] = []
  index = -1
  // The modes persist between sessions, as they do on the site (set / termtheme
  // keep them in settings.json).
  shuffle = pref<boolean>('shuffle', false)
  private repeatMode: Repeat = pref<Repeat>('repeat', 'none')
  volume = pref<number>('volume', 100)
  muted = false
  speed = pref<number>('speed', 1)
  /** Let the pitch follow the speed (off: mpv corrects it). */
  pitchShift = pref<boolean>('pitch-shift', false)
  sleepEnd: number | null = null
  private sleepTimer: NodeJS.Timeout | null = null
  private mpv: Mpv | null = null
  private starting: Promise<Mpv> | null = null
  /** Waiting on the file being loaded; it gets mpv's events first. */
  private loadWaiter: ((e: MpvEvent) => boolean) | null = null
  /** Called once per play that has been listened to (see credit). */
  onCredit: ((track: Track) => void) | null = null
  /** The track mpv has open now: position updates before its file-loaded
   *  still belong to the previous song and must not count for this one. */
  private loadedTrack: Track | null = null
  private mpvDuration = 0
  private credited: Track | null = null

  /** `notify` prints something that happened on its own (next track, an error). */
  constructor(private readonly notify: (text: string, tone?: 'ok' | 'error' | 'dim') => void) {}

  get repeat(): Repeat { return this.repeatMode }
  set repeat(mode: Repeat) {
    this.repeatMode = mode
    setPref('repeat', mode)
  }

  get current(): Track | null { return this.queue[this.index] ?? null }
  get running(): boolean { return !!this.mpv?.alive }

  private async engine(): Promise<Mpv> {
    if (this.mpv?.alive) return this.mpv
    this.starting ??= (async () => {
      const binary = findMpv()
      if (!binary) throw new Error(MPV_MISSING)
      const mpv = new Mpv((e) => this.onEvent(e), () => this.onEngineExit())
      await mpv.start(binary)
      await mpv.set('volume', this.volume)
      await mpv.set('mute', this.muted)
      await mpv.set('speed', this.speed)
      await mpv.set('audio-pitch-correction', !this.pitchShift)
      await mpv.command('observe_property', 1, 'time-pos')
      await mpv.command('observe_property', 2, 'duration')
      this.mpv = mpv
      return mpv
    })().finally(() => { this.starting = null })
    return this.starting
  }

  private onEngineExit(): void {
    this.mpv = null
    if (this.current) this.notify('the player stopped unexpectedly (play to start it again)', 'error')
  }

  private onEvent(e: MpvEvent): void {
    if (e.event === 'property-change') { this.onProperty(e); return }
    if (this.loadWaiter?.(e)) return
    // A song replaced by loadfile ends with reason 'stop', which isn't an ending.
    if (e.event !== 'end-file') return
    if (e.reason === 'error') {
      // It loaded, then the stream broke partway.
      this.notify(`couldn't play ${this.current?.title ?? 'that'}${e.file_error ? ` (${e.file_error})` : ''} - skipping`, 'error')
      void this.autoNext(false)
    } else if (e.reason === 'eof') {
      void this.autoNext(true)
    }
  }

  private onProperty(e: MpvEvent): void {
    if (e.name === 'duration') this.mpvDuration = Number(e.data) || 0
    else if (e.name === 'time-pos') this.credit(Number(e.data))
  }

  /** Counts a play once the song has actually been listened to - 30 seconds in,
   *  or halfway through anything shorter - the way the site's player does
   *  (Player.tsx, creditPlayIfListened). Skipping through a queue doesn't count.
   *  Back at the start of a song that already counted (repeat one, a seek back)
   *  it can count again. Files from the tree have no song id and never count. */
  private credit(position: number): void {
    const track = this.loadedTrack
    if (!track || track.songId === undefined || !Number.isFinite(position)) return
    if (this.credited === track && position < 1) this.credited = null
    if (this.credited === track) return
    const length = this.mpvDuration || track.duration
    if (length <= 0 || position < Math.min(30, length / 2)) return
    this.credited = track
    this.onCredit?.(track)
  }

  /** Moves on by itself after a song ends. A song that won't load is skipped,
   *  at most once round the queue so a list of broken files can't spin. */
  private async autoNext(ended: boolean, failures = 0): Promise<void> {
    try {
      const track = await this.advance(ended)
      if (track) this.notify(`▶ ${track.title}`, 'dim')
      else this.notify('end of the queue', 'dim')
    } catch (err) {
      this.notify(`${(err as Error).message} - skipping`, 'error')
      if (failures + 1 < this.queue.length) await this.autoNext(false, failures + 1)
    }
  }

  /** Loads queue[i] and resolves once mpv has it open (so seeking works right
   *  after), or rejects when the file can't be played. */
  private async load(i: number): Promise<Track> {
    const mpv = await this.engine()
    this.index = i
    const track = this.queue[i]
    this.loadedTrack = null
    this.mpvDuration = 0
    const opened = new Promise<void>((resolve, reject) => {
      const done = (): void => { clearTimeout(timer); this.loadWaiter = null }
      // A slow stream isn't an error; stop waiting and let it start when it can.
      const timer = setTimeout(() => { done(); resolve() }, 20_000)
      this.loadWaiter = (e) => {
        if (e.event === 'file-loaded') { done(); resolve(); return true }
        if (e.event === 'end-file' && e.reason === 'error') {
          done()
          reject(new Error(`couldn't play ${track.title}${e.file_error ? ` (${e.file_error})` : ''}`))
          return true
        }
        return false
      }
    })
    try {
      await mpv.command('loadfile', track.url, 'replace')
    } catch (err) {
      this.loadWaiter = null
      throw err
    }
    await opened
    this.loadedTrack = track
    await mpv.set('pause', false)
    return track
  }

  /** Replace the queue and start at `start` (shuffled first, if shuffle is on). */
  async playCollection(tracks: Track[], start = 0): Promise<Track> {
    if (tracks.length === 0) throw new Error('nothing to play')
    if (this.shuffle) {
      this.queue = [tracks[start], ...fisherYates(tracks.filter((_, i) => i !== start))]
      start = 0
    } else this.queue = [...tracks]
    // A song that won't load is skipped (said once each); if none will, the
    // queue is left empty rather than holding songs that can't play.
    for (let i = start, tries = 0; tries < this.queue.length; i = (i + 1) % this.queue.length, tries++) {
      try {
        return await this.load(i)
      } catch (err) {
        if (this.queue.length === 1) { this.queue = []; this.index = -1; throw err }
        this.notify(`${(err as Error).message} - skipping`, 'error')
      }
    }
    this.queue = []
    this.index = -1
    throw new Error('none of those would play')
  }

  /** One song: the site plays it on its own, replacing the queue. */
  playTrack(track: Track): Promise<Track> { return this.playCollection([track]) }

  /** End of a song (auto) or the next command. Null when the queue ran out. */
  async advance(auto: boolean): Promise<Track | null> {
    if (this.queue.length === 0) return null
    let next: number
    if (this.repeat === 'one' && auto) next = this.index
    else if (this.index + 1 < this.queue.length) next = this.index + 1
    else if (this.repeat === 'all' || (this.repeat === 'one' && !auto)) {
      if (this.shuffle) this.queue = fisherYates(this.queue)
      next = 0
    } else {
      if (auto) await this.mpv?.command('stop').catch(() => {})
      return null
    }
    return this.load(next)
  }

  async previous(): Promise<Track | null> {
    if (!this.current) return null
    if ((await this.position()) > 3) { await this.seek(0); return this.current }
    return this.load(Math.max(0, this.index - 1))
  }

  async jump(i: number): Promise<Track> { return this.load(i) }

  add(track: Track): void { this.queue.push(track) }
  playNext(track: Track): void { this.queue.splice(this.index + 1, 0, track) }

  remove(i: number): Track {
    if (i === this.index) throw new Error('that one is playing (next first, then remove it)')
    const [gone] = this.queue.splice(i, 1)
    if (i < this.index) this.index--
    return gone
  }

  clear(): void {
    // Like the site: the current song stays, everything else goes.
    const cur = this.current
    this.queue = cur ? [cur] : []
    this.index = cur ? 0 : -1
  }

  setShuffle(on: boolean): void {
    if (on && !this.shuffle) {
      const played = this.queue.slice(0, this.index + 1)
      this.queue = [...played, ...fisherYates(this.queue.slice(this.index + 1))]
    }
    this.shuffle = on
    setPref('shuffle', on)
  }

  async paused(): Promise<boolean> {
    if (!this.mpv?.alive) return true
    return (await this.mpv.get<boolean>('pause').catch(() => true)) || (await this.mpv.get<boolean>('idle-active').catch(() => true))
  }

  async setPaused(pause: boolean): Promise<void> {
    if (!this.current) throw new Error('nothing is playing')
    // After the queue ran out (or the player was restarted) there is nothing
    // loaded; play starts the current song again.
    if (!pause && (!this.mpv?.alive || (await this.mpv.get<boolean>('idle-active').catch(() => true)))) { await this.load(this.index); return }
    await this.mpv?.set('pause', pause)
  }

  async position(): Promise<number> {
    if (!this.mpv?.alive) return 0
    return Number(await this.mpv.get<number>('time-pos').catch(() => 0)) || 0
  }

  async duration(): Promise<number> {
    const known = this.mpv?.alive ? Number(await this.mpv.get<number>('duration').catch(() => 0)) || 0 : 0
    return known || this.current?.duration || 0
  }

  async seek(seconds: number): Promise<void> {
    if (!this.mpv?.alive || !this.current) throw new Error('nothing is playing')
    try {
      await this.mpv.command('seek', seconds, 'absolute')
    } catch {
      throw new Error(`couldn't seek (the song may still be loading, or it ended)`)
    }
  }

  async setVolume(v: number): Promise<void> {
    this.volume = Math.max(0, Math.min(100, Math.round(v)))
    setPref('volume', this.volume)
    if (this.mpv?.alive) await this.mpv.set('volume', this.volume)
  }

  async setMuted(m: boolean): Promise<void> {
    this.muted = m
    if (this.mpv?.alive) await this.mpv.set('mute', m)
  }

  async setSpeed(s: number): Promise<void> {
    this.speed = s
    setPref('speed', s)
    if (this.mpv?.alive) await this.mpv.set('speed', s)
  }

  async setPitchShift(on: boolean): Promise<void> {
    this.pitchShift = on
    setPref('pitch-shift', on)
    if (this.mpv?.alive) await this.mpv.set('audio-pitch-correction', !on)
  }

  setSleep(minutes: number | null): void {
    if (this.sleepTimer) clearTimeout(this.sleepTimer)
    this.sleepTimer = null
    this.sleepEnd = null
    if (minutes === null) return
    this.sleepEnd = Date.now() + minutes * 60_000
    this.sleepTimer = setTimeout(() => {
      this.sleepEnd = null
      this.sleepTimer = null
      void this.mpv?.set('pause', true).catch(() => {})
      this.notify('sleep timer: paused', 'dim')
    }, minutes * 60_000)
    this.sleepTimer.unref()
  }

  /** `stop`: silence and an empty queue (mpv is shut down too). */
  stop(): void {
    this.queue = []
    this.index = -1
    this.loadedTrack = null
    this.setSleep(null)
    this.mpv?.stop()
    this.mpv = null
  }

  shutdown(): void { this.stop() }
}
