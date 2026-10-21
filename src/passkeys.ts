import { apiFetch } from './api'
import { confirm, relativeTime } from './admin'
import { fail, needSignIn, plural, type Command } from './command'

// The site's Settings → Passkeys (lib/passkeyApi.ts): list, rename and remove
// the account's passkeys. Adding one, or signing in with one, needs the
// browser's passkey prompt, which a terminal can't show; both point to the
// site instead. These endpoints take a session token only - an API key gets 401.

interface Passkey {
  id: string
  name: string
  transports: string[]
  backed_up: boolean
  last_used_at: string | null
  created_at: string | null
}

export const NO_PROMPT = 'a terminal can\'t show the passkey prompt. Use player.juicewrldapi.com in a browser'

const BASE = '/accounts/account/passkeys'
const TRANSPORT_LABEL: Record<string, string> = {
  internal: 'device', hybrid: 'phone', usb: 'security key', nfc: 'NFC', ble: 'Bluetooth',
}

async function listPasskeys(): Promise<Passkey[]> {
  try {
    return (await apiFetch<{ passkeys?: Passkey[] }>(`${BASE}/`))?.passkeys ?? []
  } catch (err) {
    if (/API error 401/.test((err as Error).message)) fail('passkeys need the token from `token copy` on the site, not an API key')
    throw err
  }
}

// A passkey by full id, id prefix or exact name, like the site's terminal.
async function findPasskey(ref: string): Promise<Passkey> {
  if (!ref) fail('which passkey? (id, prefix or name - see passkeys)')
  const all = await listPasskeys()
  const exact = all.find((p) => p.id === ref || p.name === ref)
  if (exact) return exact
  const pool = all.filter((p) => p.id.startsWith(ref) || p.name.toLowerCase() === ref.toLowerCase())
  if (pool.length === 1) return pool[0]
  return fail(pool.length ? `${ref} matches ${plural(pool.length, 'passkey')} - use more of the id` : `no passkey matches ${ref}`)
}

const line = (p: Passkey): string => {
  const where = p.transports.map((t) => TRANSPORT_LABEL[t]).filter(Boolean).join(', ') || 'passkey'
  return `${p.id.slice(0, 8)}  ${p.name.padEnd(24)}  ${where.padEnd(20)}  ${p.last_used_at ? `used ${relativeTime(p.last_used_at)}` : 'never used'}${p.backed_up ? '  synced' : ''}`
}

export const PASSKEY_COMMANDS: Command[] = [
  {
    name: 'passkeys', aliases: ['passkey'], group: 'Account',
    usage: 'passkeys [ls] | rename <passkey> <name> | rm [-y] <passkey>',
    description: 'Your passkeys for signing in without a password: list, rename or remove them (<passkey> is an id, id prefix or name). Adding one needs the site',
    complete: async (arg) => ['ls', 'add', 'rename ', 'rm '].filter((w) => w.startsWith(arg.trimStart().toLowerCase())),
    run: async (arg, sh) => {
      needSignIn('manage your passkeys')
      const words = arg.trim().split(/\s+/).filter(Boolean)
      const sub = (words.shift() ?? 'ls').toLowerCase()
      if (sub === 'ls' || sub === 'list') {
        const all = await listPasskeys()
        sh.print(all.length ? all.map(line).join('\n') : 'no passkeys yet (add one on the site: Settings → Account → Passkeys)', all.length ? 'plain' : 'dim')
        return
      }
      if (sub === 'add') fail(`passkeys add: ${NO_PROMPT} (Settings → Account → Passkeys)`)
      if (sub === 'rename') {
        const p = await findPasskey(words.shift() ?? '')
        const name = words.join(' ').trim().slice(0, 100)
        if (!name) fail('usage: passkeys rename <passkey> <name>')
        await apiFetch(`${BASE}/${encodeURIComponent(p.id)}/`, {}, { method: 'PATCH', body: { name } })
        sh.print(`renamed ${p.name} to ${name}`, 'ok')
        return
      }
      if (sub === 'rm' || sub === 'remove' || sub === 'delete') {
        const yes = words[0] === '-y'
        if (yes) words.shift()
        const p = await findPasskey(words.join(' '))
        if (!(await confirm(sh, `Remove passkey ${p.name}? You won't be able to sign in with it any more.`, yes, 'passkeys'))) return
        await apiFetch(`${BASE}/${encodeURIComponent(p.id)}/`, {}, { method: 'DELETE' })
        sh.print(`removed ${p.name}. Also delete it from the device or password manager that holds it`, 'ok')
        return
      }
      fail('usage: passkeys [ls | rename | rm]')
    },
  },
]
