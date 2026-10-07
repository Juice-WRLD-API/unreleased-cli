import { SITE_COMMANDS } from 'site:commands'
import { getActiveSignal } from './api'
import { fail, needAdmin, type Command, type Group } from './command'
import type { Shell } from './shell'
import { primeStore } from './shims/useStore'

// The site terminal's own command modules (lib/terminal/*.ts), run as they are:
// each is a { name, usage, run(args, ctx) } list written against a TermCtx, and
// this wraps it in the CLI's Command shape. What those modules reach for in the
// browser is answered by src/shims; see COMMAND_MODULES in site-modules.mjs for
// which ones are in.

interface TermCtx {
  print: (text: string, tone?: 'error' | 'ok' | 'plain' | 'dim') => void
  screen: (screen: { kind: string }) => void
  ask: (label: string, opts?: { secret?: boolean }) => Promise<string>
  exec: (line: string) => Promise<boolean>
  scripted: boolean
  history: () => string[]
  room: unknown
  people: unknown[]
  signal: AbortSignal
}

interface SiteCommand {
  name: string
  aliases?: string[]
  group: string
  usage: string
  description: string
  chat?: boolean
  run: (args: string, ctx: TermCtx) => void | Promise<void>
  complete?: (before: string[], partial: string) => string[] | Promise<string[]>
}

const GROUPS: Record<string, Group> = { Navigation: 'Files' }
const mapGroup = (g: string): Group => GROUPS[g] ?? (g as Group)

/** window.confirm, as the site's commands call it (see siteDefine): there is no
 *  synchronous yes/no here, so it stops the command, which is asked about and
 *  run again with -y. */
class ConfirmNeeded extends Error {
  constructor(readonly question: string) { super(question) }
}
;(globalThis as { __termConfirm?: (q: string) => boolean }).__termConfirm = (question) => { throw new ConfirmNeeded(question) }

// The shell a command is running in, for the shims that have to ask something
// (a file's path for an upload) or save something (a download).
let current: Shell | null = null
export const runningShell = (): Shell => current ?? fail('nothing is running')

/** What a site command's TermCtx is, for code that calls into one directly. */
export function termContext(sh: Shell): TermCtx {
  return {
    print: (text, tone) => sh.print(text, tone ?? 'plain'),
    screen: () => fail('that opens a full-screen view the command line does not have'),
    ask: (label, opts) => sh.ask(label, opts?.secret),
    exec: (line) => sh.execLine(line),
    scripted: sh.scripted,
    history: () => [...sh.history],
    room: { kind: 'none' },
    people: [],
    signal: getActiveSignal() ?? new AbortController().signal,
  }
}

function wrap(c: SiteCommand): Command {
  return {
    name: c.name,
    aliases: c.aliases,
    group: mapGroup(c.group),
    usage: c.usage,
    description: c.description,
    complete: c.complete && (async (arg, sh) => {
      void sh
      const words = arg.split(/\s+/)
      const partial = words.pop() ?? ''
      const before = words.filter(Boolean)
      const head = before.length ? `${before.join(' ')} ` : ''
      return (await c.complete!(before, partial)).map((w) => head + w)
    }),
    run: async (arg, sh) => {
      if (c.group === 'Admin') await needAdmin()
      const previous = current
      current = sh
      try {
        await primeStore()
        try { await c.run(arg, termContext(sh)) } catch (err) {
          if (!(err instanceof ConfirmNeeded)) throw err
          if (sh.scripted || !process.stdin.isTTY) fail(`${c.name}: this needs confirmation - add -y to run it without being asked`)
          if (!/^y(es)?$/i.test((await sh.ask(`${err.question} [y/N] `)).trim())) { sh.print('cancelled', 'dim'); return }
          await c.run(`${arg} -y`, termContext(sh))
        }
      } finally { current = previous }
    },
  }
}

/** The site's commands that run here, minus any the CLI already has its own of
 *  and the ones that act on chat (the CLI has no chat). */
export function siteCommands(taken: Set<string>): Command[] {
  return (SITE_COMMANDS as SiteCommand[])
    .filter((c) => !c.chat && ![c.name, ...(c.aliases ?? [])].some((n) => taken.has(n)))
    .map(wrap)
}
