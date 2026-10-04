import { parseBool, pickByName } from 'site:termTypes'
import { TERM_THEMES } from 'site:termThemes'
import { fail, type Command } from './command'
import { currentTheme, setTheme, swatch } from './out'
import { pref, setPref } from './prefs'
import type { Shell } from './shell'

// `set`, `settings` and `termtheme`: the site terminal's settings commands
// (lib/terminal/settings.ts), for the settings the command line has. The site's
// Settings screen is mostly look and layout, which don't apply here; what does
// is the colours and the player's modes. They are kept in settings.json, so
// they carry over between sessions - and the player commands (volume, speed,
// shuffle, repeat) change the same values.

type Value = string | number | boolean

interface Setting {
  key: string
  desc: string
  kind: 'bool' | 'number' | 'enum'
  min?: number
  max?: number
  unit?: string
  options?: () => { value: string; label: string }[]
  get: (sh: Shell) => Value
  /** Without a player (one-shot use) the value is just saved for next time. */
  set: (sh: Shell, value: Value) => void | Promise<void>
}

const REPEATS = ['none', 'all', 'one']

const SETTINGS: Setting[] = [
  {
    key: 'theme', desc: 'Terminal colour scheme (see termtheme)', kind: 'enum',
    options: () => TERM_THEMES.map((t) => ({ value: t.id, label: t.label })),
    get: () => currentTheme().id,
    set: (_sh, v) => { setTheme(String(v)) },
  },
  {
    key: 'color', desc: 'Colour in the output (NO_COLOR turns it off too)', kind: 'bool',
    get: () => pref('color', true),
    set: (_sh, v) => setPref('color', Boolean(v)),
  },
  {
    key: 'volume', desc: 'Volume', kind: 'number', min: 0, max: 100, unit: '%',
    get: (sh) => sh.player?.volume ?? pref('volume', 100),
    set: (sh, v) => (sh.player ? sh.player.setVolume(Number(v)) : setPref('volume', Number(v))),
  },
  {
    key: 'speed', desc: 'Playback speed', kind: 'number', min: 0.5, max: 2, unit: 'x',
    get: (sh) => sh.player?.speed ?? pref('speed', 1),
    set: (sh, v) => (sh.player ? sh.player.setSpeed(Number(v)) : setPref('speed', Number(v))),
  },
  {
    key: 'hotkey-seek', desc: 'Seconds the skip shortcuts jump (see bind)', kind: 'number', min: 1, max: 120, unit: 's',
    get: () => pref('hotkey-seek', 10),
    set: (_sh, v) => setPref('hotkey-seek', Number(v)),
  },
  {
    key: 'repeat', desc: 'What happens at the end of the queue', kind: 'enum',
    options: () => REPEATS.map((value) => ({ value, label: value })),
    get: (sh) => sh.player?.repeat ?? pref('repeat', 'none'),
    set: (sh, v) => { if (sh.player) sh.player.repeat = v as 'none' | 'all' | 'one'; else setPref('repeat', String(v)) },
  },
  {
    key: 'shuffle', desc: 'Shuffle what is still to come in the queue', kind: 'bool',
    get: (sh) => sh.player?.shuffle ?? pref('shuffle', false),
    set: (sh, v) => { if (sh.player) sh.player.setShuffle(Boolean(v)); else setPref('shuffle', Boolean(v)) },
  },
  {
    key: 'pitch-shift', desc: 'Let pitch follow the speed (off keeps the pitch)', kind: 'bool',
    get: (sh) => sh.player?.pitchShift ?? pref('pitch-shift', false),
    set: (sh, v) => (sh.player ? sh.player.setPitchShift(Boolean(v)) : setPref('pitch-shift', Boolean(v))),
  },
]

const show = (s: Setting, sh: Shell): string => {
  const v = s.get(sh)
  if (s.kind === 'bool') return v ? 'on' : 'off'
  if (s.kind === 'enum') {
    const label = s.options?.().find((o) => o.value === v)?.label
    return label && label !== v ? `${String(v)} (${label})` : String(v)
  }
  return `${v}${s.unit ?? ''}`
}

function describeRange(s: Setting): string {
  if (s.kind === 'bool') return 'on | off'
  if (s.kind === 'number') return `${s.min}-${s.max}${s.unit ?? ''}`
  return (s.options?.() ?? []).map((o) => o.value).join(' | ')
}

function findSetting(key: string): Setting {
  const k = key.trim().toLowerCase().replace(/_/g, '-')
  return SETTINGS.find((s) => s.key === k) ?? pickByName(SETTINGS, (s) => s.key, k) ?? fail(`no setting "${key}" (try: settings)`)
}

async function applySetting(s: Setting, raw: string, sh: Shell): Promise<void> {
  const value = raw.trim()
  if (s.kind === 'bool') {
    const b = value.toLowerCase() === 'toggle' ? !s.get(sh) : parseBool(value)
    if (b === null) fail(`${s.key}: use on or off`)
    await s.set(sh, b!)
  } else if (s.kind === 'number') {
    const n = Number(value.replace(/[x%]$/i, ''))
    if (!Number.isFinite(n)) fail(`${s.key}: expected a number (${describeRange(s)})`)
    if (n < (s.min ?? -Infinity) || n > (s.max ?? Infinity)) fail(`${s.key}: out of range (${describeRange(s)})`)
    await s.set(sh, n)
  } else {
    const options = s.options?.() ?? []
    const match = options.find((o) => o.value.toLowerCase() === value.toLowerCase())
      ?? pickByName(options, (o) => o.value, value) ?? pickByName(options, (o) => o.label, value)
    if (!match) fail(`${s.key}: choose one of ${describeRange(s)}`)
    await s.set(sh, match!.value)
  }
}

const startsWith = (arg: string) => (c: string): boolean => c.toLowerCase().startsWith(arg.trim().toLowerCase())

export const SETTINGS_COMMANDS: Command[] = [
  {
    name: 'settings', group: 'Settings', usage: 'settings [filter]', description: 'List every setting you can change here with its current value',
    run: (args, sh) => {
      const q = args.trim().toLowerCase()
      const rows = SETTINGS.filter((s) => !q || s.key.includes(q) || s.desc.toLowerCase().includes(q))
      if (rows.length === 0) { sh.print(`no settings match "${args.trim()}"`, 'dim'); return }
      sh.print(rows.map((s) => `${s.key.padEnd(13)}${show(s, sh).padEnd(18)}${s.desc}`).join('\n'))
    },
  },
  {
    name: 'set', aliases: ['config'], group: 'Settings', usage: 'set <setting> [value]',
    description: 'Show or change a setting. "set <setting>" shows its value and choices; "settings" lists them all. Kept between sessions',
    complete: async (arg) => {
      const m = /^(\S*)(\s+)?([\s\S]*)$/.exec(arg)!
      if (!m[2]) return SETTINGS.map((s) => s.key).filter(startsWith(m[1]))
      const s = SETTINGS.find((x) => x.key === m[1].toLowerCase())
      if (!s) return []
      const options = s.kind === 'bool' ? ['on', 'off', 'toggle'] : s.kind === 'enum' ? (s.options?.() ?? []).map((o) => o.value) : []
      return options.filter(startsWith(m[3])).map((o) => `${m[1]} ${o}`)
    },
    run: async (args, sh) => {
      const [key, ...rest] = args.trim().split(/\s+/)
      if (!key) fail('usage: set <setting> [value]  (settings lists them)')
      const setting = findSetting(key)
      if (rest.length === 0) { sh.print(`${setting.key} = ${show(setting, sh)}\n  ${setting.desc} · ${describeRange(setting)}`); return }
      await applySetting(setting, rest.join(' '), sh)
      sh.print(`${setting.key} = ${show(setting, sh)}`, 'ok')
    },
  },
  {
    name: 'termtheme', aliases: ['colors'], group: 'Settings', usage: 'termtheme [name]',
    description: 'List the terminal colour schemes, or switch to one. They colour the prompt, messages, rain and visualizer, not the terminal background',
    complete: async (arg) => TERM_THEMES.map((t) => t.id).filter(startsWith(arg)),
    run: (args, sh) => {
      const want = args.trim()
      if (!want) {
        const now = currentTheme().id
        sh.print(TERM_THEMES.map((t) => `${t.id === now ? '*' : ' '} ${t.id.padEnd(8)} ${t.label.padEnd(16)} ${[t.user, t.path, t.ok, t.err, t.dim, t.accent].map(swatch).join(' ')}`).join('\n'))
        return
      }
      const found = TERM_THEMES.find((t) => t.id === want.toLowerCase()) ?? pickByName(TERM_THEMES, (t) => t.id, want) ?? pickByName(TERM_THEMES, (t) => t.label, want) ?? fail(`no theme "${want}" (try: termtheme)`)
      setTheme(found.id)
      sh.print(`terminal theme: ${found.label}`, 'ok')
    },
  },
]
