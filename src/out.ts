import { TERM_THEMES, type TermTheme } from 'site:termThemes'
import { pref, setPref } from './prefs'

// Output: the four tones the site terminal prints in, as ANSI colours when the
// stream is a terminal (and NO_COLOR isn't set, and `set color off` hasn't
// been run), plain text otherwise so piping into another program gets clean
// lines.
//
// Colours follow the terminal theme (termtheme). The default theme uses the
// terminal's own 16 colours, so it looks right in whatever palette the user has;
// the others are the site's themes, painted in truecolor.
export type Tone = 'error' | 'ok' | 'plain' | 'dim'

const colorOn = (stream: NodeJS.WriteStream): boolean =>
  !!stream.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb' && pref('color', true)

// ─── The theme ───────────────────────────────────────────────────────────────

let themeId: string | null = null

export function currentTheme(): TermTheme {
  themeId ??= pref('theme', 'default')
  return TERM_THEMES.find((t) => t.id === themeId) ?? TERM_THEMES[0]
}

/** Switches to a theme by id and remembers it; null when there is no such theme. */
export function setTheme(id: string): TermTheme | null {
  const found = TERM_THEMES.find((t) => t.id === id.trim().toLowerCase())
  if (!found) return null
  themeId = found.id
  setPref('theme', found.id)
  return found
}

/** A coloured block in a theme colour (for listing themes); a plain one without colour. */
export const swatch = (hex: string): string => (colorOn(process.stdout) ? `\x1b[${fgOf(hex)}m██\x1b[0m` : '██')

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
const fgOf = (hex: string): string => `38;2;${rgb(hex).join(';')}`
const shade = (hex: string, factor: number): string => fgOf(`#${rgb(hex).map((c) => Math.round(c * factor).toString(16).padStart(2, '0')).join('')}`)

const BASE: Record<string, string> = { red: '31', green: '32', yellow: '33', blue: '34', cyan: '36', dim: '2', bold: '1', user: '32' }
const THEMED: Record<string, keyof TermTheme> = { red: 'err', green: 'ok', blue: 'path', cyan: 'accent', dim: 'dim', user: 'user' }

function code(role: string): string {
  const theme = currentTheme()
  const key = THEMED[role]
  return theme.id !== 'default' && key ? fgOf(theme[key]) : BASE[role]
}

/** Four steps of the theme's accent, darkest first (the last is the hot tip):
 *  what the matrix rain and the visualizer are drawn in. Each is an SGR
 *  parameter string, ready for `\x1b[<it>m`. */
export function accentRamp(): [string, string, string, string] {
  const theme = currentTheme()
  if (theme.id === 'default') return ['2;32', '32', '92', '1;97']
  return [shade(theme.accent, 0.4), shade(theme.accent, 0.65), fgOf(theme.accent), `1;${fgOf(theme.fg)}`]
}

// ─── Painting ────────────────────────────────────────────────────────────────

const paint = (role: string, stream: NodeJS.WriteStream = process.stdout) =>
  (s: string): string => (colorOn(stream) ? `\x1b[${code(role)}m${s}\x1b[0m` : s)

export const color = {
  red: paint('red'),
  green: paint('green'),
  yellow: paint('yellow'),
  blue: paint('blue'),
  cyan: paint('cyan'),
  dim: paint('dim'),
  bold: paint('bold'),
  /** user@host in the prompt. */
  user: paint('user'),
  errRed: paint('red', process.stderr),
  errDim: paint('dim', process.stderr),
}

/** Writes one block of output. Errors go to stderr so a one-shot command's
 *  stdout stays clean for a pipe. */
export function writeTone(text: string, tone: Tone): void {
  if (tone === 'error') { process.stderr.write(color.errRed(text) + '\n'); return }
  const painted = tone === 'ok' ? color.green(text) : tone === 'dim' ? color.dim(text) : text
  process.stdout.write(painted + '\n')
}

/** A single status line on stderr that rewrites itself (downloads). Silent
 *  when stderr isn't a terminal. */
export function progressLine(): { update: (text: string) => void; done: () => void } {
  const tty = !!process.stderr.isTTY
  let last = 0
  let shown = false
  return {
    update(text) {
      if (!tty) return
      const now = Date.now()
      if (now - last < 100) return
      last = now
      const width = Math.max(20, (process.stderr.columns || 80) - 1)
      process.stderr.write(`\r\x1b[2K${text.length > width ? `${text.slice(0, width - 1)}…` : text}`)
      shown = true
    },
    done() {
      if (shown) process.stderr.write('\r\x1b[2K')
    },
  }
}
