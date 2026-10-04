import type { Interface } from 'node:readline'
import { apiFetch } from './api'
import { fail, needSignIn, type Command } from './command'
import { color, type Tone } from './out'
import type { Player } from './player'
import { pref, setPref } from './prefs'
import { clock } from 'site:termTypes'
import type { Key } from './screen'

// Keyboard shortcuts at the prompt: seek, skip, volume and the rest of the
// player, without typing a command. The actions, their ids and the combo format
// ("Shift+ArrowRight", "Alt+P") are the site's (lib/hotkeys.ts), so `bind` here
// reads like Settings > Shortcuts there. A terminal can't tell a bare letter
// from typing, so the defaults that are letters on the site use Alt here.
//
// Combos the line editor already uses (Ctrl+letters, Alt+B/F/D) can't be bound.
// A combo with no modifier (the bare arrow keys, Home, F-keys...) only fires on
// an empty line; the rest fire any time the prompt is up.

export type HotkeyCategory = 'Playback' | 'Volume'

export interface HotkeyAction { id: string; label: string; category: HotkeyCategory; defaultBinding: string }

export const HOTKEY_ACTIONS: readonly HotkeyAction[] = [
  { id: 'play-pause',    label: 'Play / pause',            category: 'Playback', defaultBinding: 'Alt+P' },
  { id: 'next',          label: 'Next track',              category: 'Playback', defaultBinding: 'Ctrl+ArrowRight' },
  { id: 'previous',      label: 'Previous track',          category: 'Playback', defaultBinding: 'Ctrl+ArrowLeft' },
  { id: 'seek-forward',  label: 'Skip forward',            category: 'Playback', defaultBinding: 'Shift+ArrowRight' },
  { id: 'seek-backward', label: 'Skip backward',           category: 'Playback', defaultBinding: 'Shift+ArrowLeft' },
  { id: 'speed-up',      label: 'Increase playback speed', category: 'Playback', defaultBinding: 'Alt+.' },
  { id: 'speed-down',    label: 'Decrease playback speed', category: 'Playback', defaultBinding: 'Alt+,' },
  { id: 'shuffle',       label: 'Toggle shuffle',          category: 'Playback', defaultBinding: 'Alt+S' },
  { id: 'loop',          label: 'Cycle repeat',            category: 'Playback', defaultBinding: 'Alt+R' },
  { id: 'like',          label: 'Like current song',       category: 'Playback', defaultBinding: 'Alt+L' },
  ...[0, 10, 20, 30, 40, 50, 60, 70, 80, 90].map((n): HotkeyAction => ({ id: `seek-${n}`, label: `Seek to ${n}%`, category: 'Playback', defaultBinding: '' })),
  { id: 'volume-up',     label: 'Volume up',               category: 'Volume',   defaultBinding: 'Ctrl+ArrowUp' },
  { id: 'volume-down',   label: 'Volume down',             category: 'Volume',   defaultBinding: 'Ctrl+ArrowDown' },
  { id: 'mute',          label: 'Mute / unmute',           category: 'Volume',   defaultBinding: 'Alt+M' },
]

const BY_ID = new Map(HOTKEY_ACTIONS.map((a) => [a.id, a]))

// ─── Bindings ────────────────────────────────────────────────────────────────

/** The user's changes only: action id → combo ('' is cleared on purpose). */
function overrides(): Record<string, string> {
  try {
    const parsed = JSON.parse(pref('hotkeys', '{}')) as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {}
  } catch { return {} }
}

const saveOverrides = (o: Record<string, string>): void => setPref('hotkeys', JSON.stringify(o))

export function effectiveBinding(id: string, o: Record<string, string> = overrides()): string {
  return Object.prototype.hasOwnProperty.call(o, id) ? o[id] : BY_ID.get(id)?.defaultBinding ?? ''
}

function setBinding(id: string, combo: string): void {
  const next = { ...overrides() }
  // A combo already on another action is handed over, so no two share a key.
  if (combo) for (const a of HOTKEY_ACTIONS) if (a.id !== id && effectiveBinding(a.id, next) === combo) next[a.id] = ''
  if (combo === (BY_ID.get(id)?.defaultBinding ?? '')) delete next[id]
  else next[id] = combo
  saveOverrides(next)
}

// ─── Keys and combos ─────────────────────────────────────────────────────────

const NAMED: Record<string, string> = {
  left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', space: 'Space',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', insert: 'Insert', delete: 'Delete',
}
/** The same keys as the user types them. */
const ALIASES: Record<string, string> = {
  arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown',
  '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown',
  pgup: 'PageUp', pgdn: 'PageDown', del: 'Delete', ins: 'Insert',
  comma: ',', period: '.', dot: '.', slash: '/', minus: '-', equals: '=', plus: '=',
}
const PUNCTUATION = ',./;\'-=`\\'
/** Keys that type nothing, so a bare press can be a shortcut. */
const BARE_OK = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete'])

function mainKey(token: string): string | null {
  const t = token.toLowerCase()
  const word = NAMED[t] ?? ALIASES[t]
  if (word) return word
  if (/^f([1-9]|1[0-2])$/.test(t)) return t.toUpperCase()
  if (/^[a-z0-9]$/.test(t)) return t.toUpperCase()
  if (token.length === 1 && PUNCTUATION.includes(token)) return token
  return null
}

/** What a typed combo ("alt+p", "shift+left") is in canonical form, or why not. */
export function parseCombo(input: string): string {
  const parts = input.trim().split('+')
  // "Alt++" and "Alt+plus": the key is the + itself.
  if (input.trim().endsWith('++')) parts.splice(-2, 2, '=')
  const keyToken = parts.pop() ?? ''
  const mods = new Set<string>()
  for (const m of parts) {
    const name = ({ ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', option: 'Alt', shift: 'Shift' } as Record<string, string>)[m.toLowerCase()]
    if (!name) return fail(`"${m}" isn't a modifier (use ctrl, alt or shift)`)
    mods.add(name)
  }
  const key = mainKey(keyToken) ?? fail(`"${keyToken}" isn't a key I can bind (letters, digits, arrows, Home, End, PageUp, PageDown, Insert, Delete, F1-F12 and , . / ; ' - = \` \\)`)
  const bare = !mods.has('Ctrl') && !mods.has('Alt')
  if (bare && !BARE_OK.has(key) && !/^F\d+$/.test(key)) fail(`${key} on its own is typing - add alt (alt+${key.toLowerCase()})`)
  if (mods.has('Ctrl') && !mods.has('Alt') && /^[A-Z]$/.test(key)) fail(`Ctrl+${key} belongs to the line editor - use alt+${key.toLowerCase()}`)
  if (mods.has('Alt') && !mods.has('Ctrl') && !mods.has('Shift') && /^[BFD]$/.test(key)) fail(`Alt+${key} moves by word in the line editor - pick another key`)
  if (mods.has('Alt') && key === 'Backspace') fail('Alt+Backspace deletes a word in the line editor')
  return ['Ctrl', 'Alt', 'Shift'].filter((m) => mods.has(m)).concat(key).join('+')
}

/** The canonical combo of a keypress, or null for one that can't be a shortcut. */
export function comboFromKey(str: string | undefined, key: Key): string | null {
  let main: string | null = null
  const name = key.name
  if (name && NAMED[name]) main = NAMED[name]
  else if (name && /^f([1-9]|1[0-2])$/.test(name)) main = name.toUpperCase()
  else if (name && /^[a-z0-9]$/.test(name)) main = name.toUpperCase()
  else {
    // Alt+punctuation has no name; its sequence is ESC and the character.
    const ch = (key.sequence ?? str ?? '').slice(-1)
    if (ch.length === 1 && PUNCTUATION.includes(ch)) main = ch
  }
  if (!main) return null
  const alt = !!key.meta
  const ctrl = !!key.ctrl
  const shift = !!key.shift
  const mods = [ctrl ? 'Ctrl' : '', alt ? 'Alt' : '', shift ? 'Shift' : ''].filter(Boolean)
  return [...mods, main].join('+')
}

// ─── What the actions do ─────────────────────────────────────────────────────

type Notify = (text: string, tone?: Tone) => void

export function seekStep(): number { return Math.max(1, Math.min(120, pref('hotkey-seek', 10))) }

async function perform(id: string, p: Player, say: Notify): Promise<void> {
  if (!p.current) { say('nothing is playing', 'dim'); return }
  const clampVolume = (v: number): number => Math.max(0, Math.min(100, v))
  switch (id) {
    case 'play-pause': {
      const was = await p.paused()
      await p.setPaused(!was)
      say(was ? '▶ playing' : '⏸ paused', 'ok'); break
    }
    case 'next': { const t = await p.advance(false); say(t ? `⏭ ${t.title}` : 'end of the queue', t ? 'ok' : 'dim'); break }
    case 'previous': { const t = await p.previous(); say(`⏮ ${t?.title ?? ''}`, 'ok'); break }
    case 'seek-forward':
    case 'seek-backward': {
      const dur = await p.duration()
      const to = Math.max(0, (await p.position()) + (id === 'seek-forward' ? seekStep() : -seekStep()))
      await p.seek(dur ? Math.min(to, Math.max(0, dur - 1)) : to)
      say(`⏩ ${clock(to)}${dur ? ` / ${clock(dur)}` : ''}`, 'ok'); break
    }
    case 'speed-up':
    case 'speed-down': {
      await p.setSpeed(Math.max(0.5, Math.min(2, Math.round((p.speed + (id === 'speed-up' ? 0.25 : -0.25)) * 100) / 100)))
      say(`speed ${p.speed}x`, 'ok'); break
    }
    case 'shuffle': p.setShuffle(!p.shuffle); say(`shuffle ${p.shuffle ? 'on' : 'off'}`, 'ok'); break
    case 'loop': {
      p.repeat = p.repeat === 'none' ? 'all' : p.repeat === 'all' ? 'one' : 'none'
      say(`repeat ${p.repeat}`, 'ok'); break
    }
    case 'like': {
      needSignIn('like songs')
      if (p.current.songId === undefined) fail('that file isn’t a library song')
      await apiFetch('/library/favorites/', {}, { method: 'POST', body: { song_id: p.current.songId } })
      say(`♥ ${p.current.title}`, 'ok'); break
    }
    case 'volume-up':
    case 'volume-down': {
      await p.setVolume(clampVolume(p.volume + (id === 'volume-up' ? 5 : -5)))
      say(`volume ${p.volume}%${p.muted ? ' (muted)' : ''}`, 'ok'); break
    }
    case 'mute': await p.setMuted(!p.muted); say(`volume ${p.volume}%${p.muted ? ' (muted)' : ''}`, 'ok'); break
    default: {
      const m = /^seek-(\d+)$/.exec(id)
      if (!m) break
      const dur = await p.duration()
      if (!dur) { say('don’t know how long this one is yet', 'dim'); break }
      const to = (dur * Number(m[1])) / 100
      await p.seek(to)
      say(`⏩ ${clock(to)} / ${clock(dur)}`, 'ok')
    }
  }
}

type Rl = Interface & { line: string }

/** Starts listening for the shortcuts at the prompt. `active` says whether the
 *  prompt is the one being used (not a full screen or a Ctrl+R search, which
 *  take the keys over anyway). */
export function installHotkeys(
  rl: Rl, player: () => Player | null, say: Notify, active: () => boolean, stdin: NodeJS.ReadStream = process.stdin,
): void {
  let busy = false
  stdin.on('keypress', (str: string | undefined, key: Key | undefined) => {
    if (!key || !active() || busy) return
    const combo = comboFromKey(str, key)
    const p = player()
    if (!combo || !p) return
    const o = overrides()
    const action = HOTKEY_ACTIONS.find((a) => effectiveBinding(a.id, o) === combo)
    if (!action) return
    // Keys the line editor owns on their own only count on an empty line.
    if (!/Ctrl|Alt|Shift/.test(combo) && rl.line) return
    busy = true
    perform(action.id, p, say).catch((err) => say((err as Error).message, 'error')).finally(() => { busy = false })
  })
}

// ─── The bind command ────────────────────────────────────────────────────────

const show = (combo: string): string => (combo ? combo : color.dim('—'))

function listing(): string {
  const o = overrides()
  const idWidth = Math.max(...HOTKEY_ACTIONS.map((a) => a.id.length)) + 2
  const labelWidth = Math.max(...HOTKEY_ACTIONS.map((a) => a.label.length)) + 2
  const out: string[] = []
  for (const category of ['Playback', 'Volume'] as const) {
    out.push(color.bold(category))
    for (const a of HOTKEY_ACTIONS.filter((x) => x.category === category)) {
      const combo = effectiveBinding(a.id, o)
      const changed = Object.prototype.hasOwnProperty.call(o, a.id) ? color.dim('  (changed)') : ''
      // The unbound seek-N rows are left out until they have a key.
      if (!combo && /^seek-\d+$/.test(a.id)) continue
      out.push(`  ${a.id.padEnd(idWidth)}${a.label.padEnd(labelWidth)}${show(combo)}${changed}`)
    }
  }
  out.push('', color.dim(`skip jumps ${seekStep()}s (set hotkey-seek) · bind <action> <combo> · bind <action> none · bind reset`))
  return out.join('\n')
}

export const HOTKEY_COMMANDS: Command[] = [
  {
    name: 'bind', aliases: ['shortcuts', 'hotkeys'], group: 'Settings',
    usage: 'bind  ·  bind <action> <combo | none>  ·  bind reset [action]',
    description: 'List the keyboard shortcuts for the player, or change one (bind seek-forward shift+right, bind mute alt+m). They work at the prompt',
    complete: async (arg) => {
      const words = arg.split(/\s+/)
      if (words.length > 1) return []
      return ['reset', ...HOTKEY_ACTIONS.map((a) => a.id)].filter((w) => w.startsWith(arg.trim().toLowerCase()))
    },
    run: (args, sh) => {
      const words = args.trim().split(/\s+/).filter(Boolean)
      if (words.length === 0) { sh.print(listing()); return }
      if (words[0].toLowerCase() === 'reset') {
        if (words.length === 1) { saveOverrides({}); sh.print('shortcuts back to their defaults', 'ok'); return }
        const id = words[1].toLowerCase()
        if (!BY_ID.has(id)) fail(`no action "${words[1]}" (try: bind)`)
        setBinding(id, BY_ID.get(id)!.defaultBinding)
        sh.print(`${id}: ${show(effectiveBinding(id))}`, 'ok'); return
      }
      const id = words[0].toLowerCase()
      if (!BY_ID.has(id)) {
        // `bind alt+p` says what that key does.
        const hit = (() => { try { return parseCombo(args) } catch { return null } })()
        const owner = hit ? HOTKEY_ACTIONS.find((a) => effectiveBinding(a.id) === hit) : undefined
        if (owner) { sh.print(`${hit}: ${owner.label} (${owner.id})`); return }
        fail(`no action "${words[0]}" (try: bind)`)
      }
      const rest = words.slice(1).join('')
      if (!rest) { sh.print(`${id}: ${show(effectiveBinding(id))}`); return }
      if (/^(none|clear|off|unbind)$/i.test(rest)) { setBinding(id, ''); sh.print(`${id}: no shortcut`, 'ok'); return }
      const combo = parseCombo(rest)
      const taken = HOTKEY_ACTIONS.find((a) => a.id !== id && effectiveBinding(a.id) === combo)
      setBinding(id, combo)
      sh.print(`${id}: ${combo}${taken ? `  (took it from ${taken.id})` : ''}`, 'ok')
    },
  },
]
