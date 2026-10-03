import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, fstatSync, openSync, readSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clock } from 'site:termTypes'
import { VERSION } from './api'
import { fail, type Command } from './command'
import { findMpv, MPV_MISSING } from './mpv'
import { accentRamp, color } from './out'
import { playerOf } from './playback'
import type { Track } from './player'
import { canOpenScreen, openScreen, type Screen, type ScreenBody } from './screen'

// `visualizer`: a live spectrum of the song that's playing. mpv can't hand the
// audio over, so a second mpv decodes the same stream to raw samples in a temp
// file (it runs far faster than playback, so it stays ahead), and the bars are
// the FFT of the slice at the playing position. Costs one extra download of
// the song while the screen is open.

const RATE = 22050
const SIZE = 2048 // samples per FFT window: ~93 ms, bins ~11 Hz wide
const LOW_HZ = 40
const HIGH_HZ = 10000
const FPS = 30
const BLOCKS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

// ─── The decoder ─────────────────────────────────────────────────────────────

class Decoder {
  readonly file = join(tmpdir(), `unreleased-viz-${process.pid}-${Date.now()}.pcm`)
  private proc: ChildProcess
  private fd = -1
  finished = false
  failed = false

  constructor(binary: string, url: string) {
    this.proc = spawn(binary, [
      '--no-config', '--no-video', '--no-terminal', '--really-quiet', '--audio-display=no', '--no-resume-playback',
      '--ao=pcm', `--ao-pcm-file=${this.file}`, '--ao-pcm-waveheader=no',
      '--audio-format=s16', '--audio-channels=mono', `--audio-samplerate=${RATE}`,
      `--user-agent=unreleased-cli/${VERSION}`, url,
    ], { stdio: 'ignore', windowsHide: true })
    this.proc.on('exit', (code) => { this.finished = true; this.failed = code !== 0 })
    this.proc.on('error', () => { this.finished = true; this.failed = true })
  }

  /** `count` samples (-1..1) from sample `from`, or null while the decoder
   *  hasn't got that far. */
  read(from: number, count: number): Float64Array | null {
    if (this.fd === -1) {
      try { this.fd = openSync(this.file, 'r') } catch { return null }
    }
    const bytes = count * 2
    const buf = Buffer.alloc(bytes)
    let got = 0
    try {
      if (fstatSync(this.fd).size < from * 2 + bytes && !this.finished) return null
      got = readSync(this.fd, buf, 0, bytes, from * 2)
    } catch { return null }
    const out = new Float64Array(count)
    // Past the end of a finished file the window is padded with silence.
    for (let i = 0; i < Math.floor(got / 2); i++) out[i] = buf.readInt16LE(i * 2) / 32768
    return got > 0 ? out : null
  }

  close(): void {
    if (this.fd !== -1) { try { closeSync(this.fd) } catch { /* gone */ } this.fd = -1 }
    if (this.proc.exitCode === null) { try { this.proc.kill() } catch { /* gone */ } }
    // mpv may still hold the file for a moment on Windows; try again shortly.
    const remove = (): void => { try { rmSync(this.file, { force: true }) } catch { /* next try */ } }
    remove()
    setTimeout(remove, 1000).unref()
  }
}

// ─── The spectrum ────────────────────────────────────────────────────────────

const WINDOW = Float64Array.from({ length: SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (SIZE - 1)))
const BIT_REVERSE = (() => {
  const bits = Math.log2(SIZE)
  return Uint16Array.from({ length: SIZE }, (_, i) => {
    let r = 0
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b)
    return r
  })
})()
const COS = Float64Array.from({ length: SIZE / 2 }, (_, i) => Math.cos((2 * Math.PI * i) / SIZE))
const SIN = Float64Array.from({ length: SIZE / 2 }, (_, i) => -Math.sin((2 * Math.PI * i) / SIZE))

/** Magnitudes of the first SIZE/2 bins of `samples` (Hann-windowed). */
function magnitudes(samples: Float64Array): Float64Array {
  const re = new Float64Array(SIZE)
  const im = new Float64Array(SIZE)
  for (let i = 0; i < SIZE; i++) re[BIT_REVERSE[i]] = samples[i] * WINDOW[i]
  for (let len = 2; len <= SIZE; len <<= 1) {
    const half = len >> 1
    const step = SIZE / len
    for (let start = 0; start < SIZE; start += len) {
      for (let k = 0; k < half; k++) {
        const wr = COS[k * step]
        const wi = SIN[k * step]
        const a = start + k
        const b = a + half
        const tr = re[b] * wr - im[b] * wi
        const ti = re[b] * wi + im[b] * wr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
      }
    }
  }
  const out = new Float64Array(SIZE / 2)
  for (let i = 0; i < out.length; i++) out[i] = (Math.hypot(re[i], im[i]) * 4) / SIZE
  return out
}

/** Bar levels (0..1) from the bins: bands spaced evenly on a log scale, the
 *  highs lifted a little because music has far less energy up there. */
function bands(mags: Float64Array, count: number): number[] {
  const binHz = RATE / SIZE
  const ratio = HIGH_HZ / LOW_HZ
  return Array.from({ length: count }, (_, i) => {
    const lo = LOW_HZ * ratio ** (i / count)
    const hi = LOW_HZ * ratio ** ((i + 1) / count)
    const from = Math.min(mags.length - 1, Math.floor(lo / binHz))
    const to = Math.min(mags.length - 1, Math.max(from, Math.ceil(hi / binHz) - 1))
    let peak = 0
    for (let b = from; b <= to; b++) peak = Math.max(peak, mags[b])
    const db = 20 * Math.log10(peak + 1e-9) + 3 * Math.log2(Math.sqrt(lo * hi) / 200)
    // The squaring spreads the bars out; unsquared, a loud mix is a solid wall.
    return Math.max(0, Math.min(1, (db + 66) / 50)) ** 1.8
  })
}

// ─── The screen ──────────────────────────────────────────────────────────────

function visualizerScreen(sh: Parameters<Command['run']>[1], binary: string): ScreenBody {
  const player = playerOf(sh)
  let timer: NodeJS.Timeout | null = null
  let poller: NodeJS.Timeout | null = null
  let decoder: Decoder | null = null
  let decoding: Track | null = null
  let levels: number[] = []
  // The playing position as last polled, and when - frames in between
  // extrapolate from it.
  let base = 0
  let baseAt = Date.now()
  let moving = false
  let ended = false

  const poll = async (s: Screen): Promise<void> => {
    const track = player.current
    if (!track) { ended = true; s.exit('nothing is playing'); return }
    if (track !== decoding) {
      decoder?.close()
      decoder = new Decoder(binary, track.url)
      decoding = track
      levels = []
    }
    const [pos, paused] = await Promise.all([player.position(), player.paused()])
    base = pos
    baseAt = Date.now()
    moving = !paused
  }

  const frame = (s: Screen): void => {
    if (s.closed || ended) return
    const track = decoding
    const now = base + (moving ? ((Date.now() - baseAt) / 1000) * player.speed : 0)
    const bars = Math.max(8, Math.min(64, Math.floor((s.cols - 2) / 2)))
    if (levels.length !== bars) levels = new Array(bars).fill(0)

    const samples = decoder?.read(Math.max(0, Math.floor(now * RATE) - SIZE / 2), SIZE) ?? null
    const fresh = samples ? bands(magnitudes(samples), bars) : null
    // Bars jump up quickly and fall back slowly.
    levels = levels.map((old, i) => (fresh ? Math.max(fresh[i], old * 0.86) : old * 0.86))

    const height = Math.max(3, s.rows - 4)
    const [dark, mid, bright, hot] = accentRamp().map((p) => `\x1b[${p}m`)
    const lines: string[] = []
    const status = !track ? '' : !samples && decoder && !decoder.finished ? 'analysing…' : decoder?.failed && !samples ? 'couldn’t analyse this one' : ''
    const title = track ? track.title : ''
    const time = track ? `${clock(now)}${track.duration ? ` / ${clock(track.duration)}` : ''}` : ''
    lines.push(`${color.bold(title)}  ${color.dim(time)}${status ? `  ${color.dim(status)}` : ''}`, '')
    for (let row = height - 1; row >= 0; row--) {
      const tone = row >= height * 0.85 ? hot : row >= height * 0.55 ? bright : row >= height * 0.25 ? mid : dark
      let line = ' '
      for (let i = 0; i < bars; i++) {
        const filled = levels[i] * height
        const cell = Math.max(0, Math.min(8, Math.round((filled - row) * 8)))
        line += cell === 0 ? '  ' : `${tone}${BLOCKS[cell].repeat(2)}\x1b[0m`
      }
      lines.push(line)
    }
    lines.push('', color.dim(' any key leaves'))
    s.draw(lines)
  }

  return {
    start: async (s) => {
      await poll(s)
      timer = setInterval(() => frame(s), 1000 / FPS)
      poller = setInterval(() => { void poll(s).catch(() => undefined) }, 150)
    },
    key: (_str, _key, s) => s.exit(),
    stop: () => {
      if (timer) clearInterval(timer)
      if (poller) clearInterval(poller)
      decoder?.close()
    },
  }
}

export const VISUALIZER_COMMANDS: Command[] = [
  {
    name: 'visualizer', aliases: ['viz'], group: 'Fun', usage: 'visualizer',
    description: 'A live spectrum of whatever is playing. Any key leaves',
    run: async (_a, sh) => {
      if (sh.scripted) fail('visualizer: not inside a script or watch')
      if (!canOpenScreen()) fail('visualizer: needs an interactive terminal')
      const player = playerOf(sh)
      if (!player.current) fail('nothing is playing')
      const binary = findMpv() ?? fail(MPV_MISSING)
      const message = await openScreen(visualizerScreen(sh, binary))
      if (message) sh.print(message, 'dim')
    },
  },
]
