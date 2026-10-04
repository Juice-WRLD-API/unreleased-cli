import { pref, setPref } from './prefs'

// The equalizer and sound effects, as an mpv audio-filter chain. The presets
// and ranges are the site's (lib/audioEffects.ts - it pulls in browser code, so
// it can't be compiled in); mpv gets the same settings through its lavfi
// filters instead of Web Audio, so the reverb is an echo approximation rather
// than the site's convolver.

export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

export interface EqPreset { id: string; name: string; gains: number[] }

export const EQ_PRESETS: EqPreset[] = [
  { id: 'flat',           name: 'Flat',           gains: EQ_BANDS.map(() => 0) },
  { id: 'bass-boost',     name: 'Bass Boost',     gains: [6, 5, 4, 2.5, 1, 0, 0, 0, 0, 0] },
  { id: 'bass-reducer',   name: 'Bass Reducer',   gains: [-6, -5, -4, -2.5, -1, 0, 0, 0, 0, 0] },
  { id: 'treble-boost',   name: 'Treble Boost',   gains: [0, 0, 0, 0, 0, 1, 2.5, 4, 5, 6] },
  { id: 'treble-reducer', name: 'Treble Reducer', gains: [0, 0, 0, 0, 0, -1, -2.5, -4, -5, -6] },
  { id: 'vocal',          name: 'Vocal Boost',    gains: [-2, -3, -3, 1, 4, 4, 3, 1.5, 0, -1.5] },
  { id: 'rock',           name: 'Rock',           gains: [5, 4, 3, 1.5, -0.5, -1, 0.5, 2.5, 3.5, 4.5] },
  { id: 'pop',            name: 'Pop',            gains: [-1.5, -1, 0, 2, 4, 4, 2, 0, -1, -1.5] },
  { id: 'hip-hop',        name: 'Hip-Hop',        gains: [5, 4, 1.5, 3, -1, -1, 1.5, -0.5, 2, 3] },
  { id: 'electronic',     name: 'Electronic',     gains: [4.5, 4, 1.5, 0, -2, 2, 1, 1.5, 4, 5] },
  { id: 'jazz',           name: 'Jazz',           gains: [4, 3, 1.5, 2, -1.5, -1.5, 0, 1.5, 3, 4] },
  { id: 'classical',      name: 'Classical',      gains: [4.5, 3.5, 3, 2.5, -1.5, -1.5, 0, 2, 3, 4] },
  { id: 'acoustic',       name: 'Acoustic',       gains: [5, 5, 4, 1, 2, 1.5, 3.5, 4, 3.5, 2] },
  { id: 'small-speakers', name: 'Small Speakers', gains: [5.5, 4.5, 4, 2.5, 1.5, 0, -1.5, -3, -4, -4.5] },
]

export interface Effects {
  eq: boolean
  preset: string
  boost: number // 1..2
  balance: number // -1..1
  mono: boolean
  reverb: boolean
  reverbMix: number // 0..1
  reverbDecay: number // seconds, 1..8
}

export const effects = (): Effects => ({
  eq: pref('eq', false),
  preset: pref('eq-preset', 'flat'),
  boost: pref('eq-boost', 1),
  balance: pref('eq-balance', 0),
  mono: pref('eq-mono', false),
  reverb: pref('reverb', false),
  reverbMix: pref('reverb-mix', 0.3),
  reverbDecay: pref('reverb-decay', 2),
})

const KEYS: Record<keyof Effects, string> = {
  eq: 'eq', preset: 'eq-preset', boost: 'eq-boost', balance: 'eq-balance', mono: 'eq-mono',
  reverb: 'reverb', reverbMix: 'reverb-mix', reverbDecay: 'reverb-decay',
}

export function saveEffect<K extends keyof Effects>(key: K, value: Effects[K]): void { setPref(KEYS[key], value) }

const num = (n: number): string => String(Math.round(n * 1000) / 1000)

/** The value for mpv's `af` property: '' when nothing is switched on. */
export function filterChain(e: Effects = effects()): string {
  const f: string[] = []
  const gains = EQ_PRESETS.find((p) => p.id === e.preset)?.gains
  if (e.eq && gains) {
    gains.forEach((g, i) => { if (g) f.push(`equalizer=f=${EQ_BANDS[i]}:width_type=o:width=1:g=${num(g)}`) })
  }
  if (e.mono) f.push('pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1')
  if (e.balance) f.push(`stereotools=balance_out=${num(e.balance)}`)
  if (e.reverb && e.reverbMix > 0) {
    // A handful of echoes spread over the decay time, quieter the later they land.
    const delays = [0.04, 0.09, 0.17, 0.3].map((t) => Math.round(Math.min(1, t * e.reverbDecay / 2) * 1000))
    const decays = [0.6, 0.5, 0.4, 0.3].map((d) => num(d * e.reverbMix * 2 > 0.9 ? 0.9 : d * e.reverbMix * 2))
    f.push(`aecho=in_gain=${num(1 - e.reverbMix * 0.4)}:out_gain=${num(0.6 + e.reverbMix * 0.3)}:delays=${delays.join('|')}:decays=${decays.join('|')}`)
  }
  if (e.boost > 1) f.push(`volume=${num(e.boost)}`)
  // Boost and EQ gain can push past full scale; keep them from clipping.
  if (f.length) f.push('alimiter=limit=0.95')
  return f.length ? `lavfi=[${f.join(',')}]` : ''
}
