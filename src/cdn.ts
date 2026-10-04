import { formatBytes } from 'site:format'
import { apiFetch } from './api'
import { admin, confirm, kindComplete, relativeTime } from './admin'
import { fail, plural, type Command } from './command'
import { color } from './out'

// The Admin page's CDN nodes tab (lib/cdnAdminApi.ts on the site): the roster
// of volunteer nodes, approvals and CDN-wide stats under /cdn/admin/. Nodes
// register anonymously and serve nothing until approved. Disabling keeps a
// node's history; deleting wipes it. Same endpoints and rules as the site.

interface CdnNode {
  node_id: string
  name: string
  owner_username: string
  region: string
  is_public: boolean
  is_active: boolean
  is_approved: boolean
  status: string
  online: boolean
  file_count: number
  current_storage_bytes: number
  max_storage_bytes: number
  upload_speed_mbps: number
  download_speed_mbps: number
  observed_download_speed_mbps?: number | null
  trust_score: number
  hash_violations: number
  total_bytes_served: number
  total_requests: number
  ip_address: string | null
  port: number
  public_base_url: string
  last_heartbeat: string | null
  created_at: string
  manifest_version?: number
  synced_manifest_version?: number | null
}

interface CdnStats {
  total_nodes: number
  online_nodes: number
  pending_nodes: number
  total_bytes_served: number
  total_requests: number
  manifest_version: number
  master_files: number
  master_bytes: number
}

const DEFAULT_TRUST = 100
/** The server auto-disables a node at trust <= 0 or this many violations. */
const VIOLATION_LIMIT = 5

const ACTIONS = ['approve', 'revoke', 'enable', 'disable', 'reset', 'restore', 'delete'] as const
type Action = typeof ACTIONS[number]

const BASE = '/cdn/admin'
const listNodes = async (): Promise<CdnNode[]> => (await apiFetch<{ nodes?: CdnNode[] }>(`${BASE}/nodes/`))?.nodes ?? []
const nodePath = (n: CdnNode): string => `${BASE}/nodes/${encodeURIComponent(n.node_id)}/`
const patch = (n: CdnNode, body: Record<string, unknown>): Promise<CdnNode> => apiFetch(nodePath(n), {}, { method: 'PATCH', body })

const autoDisabled = (n: CdnNode): boolean => n.trust_score <= 0 || n.hash_violations >= VIOLATION_LIMIT
const mbps = (v: number | null | undefined): string => (v ? `${Math.round(v * 10) / 10} Mbps` : '—')

function state(n: CdnNode): string {
  if (!n.is_approved) return autoDisabled(n) ? 'auto-disabled' : 'pending'
  if (!n.is_active) return 'disabled'
  return n.online ? 'online' : 'offline'
}

const tone = (s: string): string => (s === 'online' ? color.green(s) : s === 'offline' ? color.dim(s) : color.red(s))

/** A node by node id (or the start of one), or by name. */
function pick(nodes: CdnNode[], arg: string): CdnNode {
  const q = arg.trim().replace(/^#/, '').toLowerCase()
  if (!q) fail('say which node (see: cdn)')
  const exact = nodes.filter((n) => n.node_id.toLowerCase() === q || n.name.toLowerCase() === q)
  const hits = exact.length ? exact : nodes.filter((n) => n.node_id.toLowerCase().startsWith(q) || n.name.toLowerCase().includes(q))
  if (hits.length === 0) fail(`no node matches "${arg.trim()}" (see: cdn)`)
  if (hits.length > 1) fail(`"${arg.trim()}" matches ${hits.length} nodes: ${hits.slice(0, 5).map((n) => n.name || n.node_id.slice(0, 8)).join(', ')}`)
  return hits[0]
}

function describeNode(n: CdnNode, latest?: number): string {
  const pct = n.max_storage_bytes > 0 ? ` of ${formatBytes(n.max_storage_bytes)} (${Math.min(100, Math.round((n.current_storage_bytes / n.max_storage_bytes) * 100))}%)` : ''
  const newest = n.manifest_version ?? latest
  const synced = n.synced_manifest_version === undefined ? ''
    : `\nsynced manifest  ${n.synced_manifest_version == null ? 'never' : `v${n.synced_manifest_version}`}${newest != null ? ` (latest v${newest})` : ''}`
  const notes: string[] = []
  if (!n.is_approved && autoDisabled(n)) notes.push('pulled for hash violations - restore it to reset trust and violations too')
  else if (!n.is_approved) notes.push('waiting for approval - it serves nothing until approved')
  else if (!n.is_active) notes.push('switched off by an admin')
  return [
    `${color.bold(n.name || n.node_id)}  ${tone(state(n))}`,
    `node id          ${n.node_id}`,
    `owner            ${n.owner_username || 'unclaimed'}`,
    `region           ${n.region || '—'} · ${n.is_public ? 'public' : 'private'}`,
    `address          ${n.ip_address ? (n.port ? `${n.ip_address}:${n.port}` : n.ip_address) : '—'}${n.public_base_url ? `  ${n.public_base_url}` : ''}`,
    `storage          ${formatBytes(n.current_storage_bytes)}${pct} · ${n.file_count.toLocaleString()} files`,
    `speed            up ${mbps(n.upload_speed_mbps)} · down ${mbps(n.download_speed_mbps)} · to listeners ${mbps(n.observed_download_speed_mbps)}`,
    `served           ${formatBytes(n.total_bytes_served)} in ${n.total_requests.toLocaleString()} requests`,
    `trust            ${Math.round(n.trust_score)} · ${plural(n.hash_violations, 'violation')}`,
    `heartbeat        ${relativeTime(n.last_heartbeat)} · registered ${new Date(n.created_at).toLocaleDateString()}${synced}`,
    ...notes.map((t) => color.yellow(`! ${t}`)),
  ].join('\n')
}

async function act(action: Action, n: CdnNode, sh: Parameters<Command['run']>[1], yes: boolean): Promise<void> {
  const name = n.name || n.node_id
  switch (action) {
    case 'approve':
      if (n.is_approved) fail(`${name} is already approved`)
      if (autoDisabled(n)) fail(`${name} was pulled for hash violations - use: cdn restore ${name}`)
      await patch(n, { is_approved: true }); break
    case 'revoke':
      if (!n.is_approved) fail(`${name} isn't approved`)
      await patch(n, { is_approved: false }); break
    case 'enable':
      if (n.is_active) fail(`${name} is already enabled`)
      if (autoDisabled(n)) fail(`${name} was pulled for hash violations - use: cdn restore ${name}`)
      await patch(n, { is_active: true }); break
    case 'disable':
      if (!n.is_active) fail(`${name} is already disabled`)
      await patch(n, { is_active: false }); break
    case 'reset':
      if (n.hash_violations === 0 && n.trust_score >= DEFAULT_TRUST) fail(`${name} has nothing to reset`)
      await patch(n, { trust_score: DEFAULT_TRUST, hash_violations: 0 }); break
    case 'restore':
      // The site's "Restore node": back on and approved, trust and violations reset.
      await patch(n, { is_approved: true, is_active: true, trust_score: DEFAULT_TRUST, hash_violations: 0 }); break
    case 'delete':
      if (!(await confirm(sh, `Permanently delete ${name}? Its file list, history and API key go with it.`, yes, 'cdn'))) return
      await apiFetch(nodePath(n), {}, { method: 'DELETE' })
      sh.print(`deleted ${name}`, 'ok')
      return
  }
  sh.print(`${action} ${name}: done`, 'ok')
}

export const CDN_COMMANDS: Command[] = [
  {
    name: 'cdn', group: 'Admin',
    usage: 'cdn [<node>]  ·  cdn approve|revoke|enable|disable|reset|restore|delete [-y] <node>',
    description: 'The CDN node roster and stats; one node in full; or approve, revoke, enable, disable, reset trust, restore or delete a node (a node is its id, the start of it, or its name)',
    complete: kindComplete(ACTIONS),
    run: admin(async (args, sh) => {
      const words = args.trim().split(/\s+/).filter(Boolean)
      const first = words[0]?.toLowerCase()
      if (first && (ACTIONS as readonly string[]).includes(first)) {
        words.shift()
        const yes = words[0] === '-y' ? (words.shift(), true) : false
        const nodes = await listNodes()
        await act(first as Action, pick(nodes, words.join(' ')), sh, yes)
        return
      }
      const [stats, nodes] = await Promise.all([apiFetch<CdnStats>(`${BASE}/stats/`), listNodes()])
      if (words.length) { sh.print(describeNode(pick(nodes, words.join(' ')), stats.manifest_version)); return }
      const lines = [
        `${plural(stats.total_nodes, 'node')} · ${stats.online_nodes} online · ${stats.pending_nodes} awaiting approval · ${formatBytes(stats.total_bytes_served)} served in ${stats.total_requests.toLocaleString()} requests`,
        `master copy: ${stats.master_files.toLocaleString()} files, ${formatBytes(stats.master_bytes)} · manifest v${stats.manifest_version}`,
      ]
      if (nodes.length === 0) { sh.print([...lines, '', color.dim('no nodes registered')].join('\n')); return }
      const order = ['pending', 'auto-disabled', 'online', 'offline', 'disabled']
      const sorted = [...nodes].sort((a, b) => order.indexOf(state(a)) - order.indexOf(state(b)) || (a.name || a.node_id).localeCompare(b.name || b.node_id))
      const rows = sorted.map((n) => {
        const s = state(n)
        return `${(n.name || n.node_id.slice(0, 8)).slice(0, 24).padEnd(26)}${tone(s)}${' '.repeat(Math.max(1, 15 - s.length))}${(n.owner_username || 'unclaimed').slice(0, 16).padEnd(18)}${formatBytes(n.current_storage_bytes).padEnd(11)}${formatBytes(n.total_bytes_served).padEnd(11)}trust ${String(Math.round(n.trust_score)).padEnd(5)}${relativeTime(n.last_heartbeat)}`
      })
      sh.print([...lines, '', ...rows].join('\n'))
    }),
  },
]
