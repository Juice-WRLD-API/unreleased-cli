import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { VERSION } from './api'
import { fail, type Command } from './command'
import { HOME_DIR } from './config'
import type { Shell } from './shell'

// `update`: checks npm for a newer release and installs it. It works out how
// this copy was installed - from npm, from the Ubuntu PPA, or from a source
// checkout - and only runs the installer for the npm case; for the others it
// says what to run, since apt needs sudo.

const PACKAGE = 'unreleased-cli'

async function latestVersion(): Promise<string> {
  let res: Response
  try {
    res = await fetch(`https://registry.npmjs.org/${PACKAGE}/latest`, { signal: AbortSignal.timeout(10_000) })
  } catch {
    return fail("couldn't reach npm to check for updates (are you online?)")
  }
  if (!res.ok) fail(`npm answered ${res.status} when checking for updates`)
  const { version } = (await res.json()) as { version?: string }
  return version ?? fail('npm sent no version number')
}

/** Positive when a is newer than b (plain x.y.z numbers). */
function compare(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}

type Install = 'npm' | 'apt' | 'source'

function installKind(): Install {
  let file = process.argv[1] ?? ''
  try { file = realpathSync(file) } catch { /* keep the path as given */ }
  const p = file.replace(/\\/g, '/')
  if (p.startsWith('/usr/lib/unreleased-cli/')) return 'apt'
  if (p.includes('/node_modules/')) return 'npm'
  return 'source'
}

function runNpmInstall(): Promise<number> {
  return new Promise((resolve) => {
    // npm is npm.cmd on Windows, which only runs through a shell.
    const child = spawn('npm', ['install', '-g', `${PACKAGE}@latest`], { stdio: 'inherit', shell: process.platform === 'win32' })
    child.on('error', () => resolve(1))
    child.on('close', (code) => resolve(code ?? 1))
  })
}

// The startup notice: the newest version seen is cached in ~/.unreleased, and
// npm is asked again at most once a day, in the background, so starting the
// shell never waits on the network. Any failure is silent. UNRELEASED_NO_UPDATE_CHECK=1 turns it off.
const CHECK_FILE = join(HOME_DIR, 'update-check.json')
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000

interface UpdateCheck { checkedAt: number; latest: string }

function readCheck(): UpdateCheck | null {
  try {
    const c = JSON.parse(readFileSync(CHECK_FILE, 'utf8')) as Partial<UpdateCheck>
    return typeof c.checkedAt === 'number' && typeof c.latest === 'string' ? { checkedAt: c.checkedAt, latest: c.latest } : null
  } catch { return null }
}

export function announceUpdate(notify: (text: string) => void): void {
  if (process.env.UNRELEASED_NO_UPDATE_CHECK) return
  const say = (latest: string): void => {
    if (compare(latest, VERSION) > 0) notify(`new version available: v${latest} (you have v${VERSION}) - run update to install it`)
  }
  const cached = readCheck()
  if (cached) say(cached.latest)
  if (cached && Date.now() - cached.checkedAt < CHECK_EVERY_MS) return
  void (async () => {
    try {
      const res = await fetch(`https://registry.npmjs.org/${PACKAGE}/latest`, { signal: AbortSignal.timeout(5_000) })
      if (!res.ok) return
      const { version } = (await res.json()) as { version?: string }
      if (!version) return
      mkdirSync(HOME_DIR, { recursive: true })
      writeFileSync(CHECK_FILE, JSON.stringify({ checkedAt: Date.now(), latest: version }))
      // Already told about this one from the cache; only speak up for news.
      if (version !== cached?.latest) say(version)
    } catch { /* offline or npm is down: try again next start */ }
  })()
}

export const UPDATE_COMMANDS: Command[] = [
  {
    name: 'update', aliases: ['upgrade'], group: 'Shell', usage: 'update [-c]',
    description: 'Check for a newer version and install it. -c only checks',
    run: async (arg, sh: Shell) => {
      const checkOnly = /^-c$|^--check$/.test(arg.trim())
      if (arg.trim() && !checkOnly) fail('usage: update [-c]')
      const latest = await latestVersion()
      if (compare(latest, VERSION) <= 0) { sh.print(`you're up to date (v${VERSION})`, 'ok'); return }
      sh.print(`new version: v${latest} (you have v${VERSION})`)
      if (checkOnly) { sh.print('run update to install it', 'dim'); return }

      const kind = installKind()
      if (kind === 'apt') {
        sh.print('this copy came from the Ubuntu PPA, so update it with:\n  sudo apt update && sudo apt install --only-upgrade unreleased-cli')
        return
      }
      if (kind === 'source') {
        sh.print('this copy runs from a source checkout, so update it with:\n  git pull && npm install && npm run build')
        return
      }
      sh.print(`installing v${latest}…`, 'dim')
      const code = await runNpmInstall()
      if (code !== 0) fail(`the install failed (npm exit code ${code}). If it says permission denied, run it with sudo: sudo npm install -g ${PACKAGE}@latest`)
      sh.print(`updated to v${latest} - leave and start unreleased again to use it`, 'ok')
    },
  },
]
