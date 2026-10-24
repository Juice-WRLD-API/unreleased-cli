import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { Shell } from '../src/shell'
import { Player, trackFromSong } from '../src/player'
import { tracksFromArg } from '../src/playback'
import { HOME_DIR } from '../src/config'
import { installLocalStorage } from '../src/shims/localStorage'
import { folderFiles } from '../src/shims/pick'
import { primeStore, useStore } from '../src/shims/useStore'
import { runSiteAction } from '../src/siteCommands'
import { setActiveSignal } from '../src/api'
import { siteCommands } from '../src/siteCommands'
import { XMLHttpRequest } from '../src/shims/browser'
import { saveConfig } from '../src/config'

installLocalStorage()
const realFetch = globalThis.fetch
after(() => { globalThis.fetch = realFetch })
let requests: { url: URL; init: RequestInit }[] = []
let prefs: Record<string, unknown>[] = []
const song = { id: 10, public_id: 42, name: 'Example', path: 'Compilation/Example.mp3', length: '2:00', category: 'unreleased', era: { name: 'Era' }, lyrics: 'one line', record_dates: 'Recorded\nOctober 24, 2018.', credited_artists: '', producers: '' }
const job = { id: 'a'.repeat(8) + '-aaaa-aaaa-aaaa-' + 'a'.repeat(12), mode: 'synced', filename: 'Example.mp3', status: 'completed', created_at: '2026-10-24T00:00:00Z', result: { plain_lyrics: 'one line\nsecond line', synced_lyrics: '[00:01.00]one line\n[00:03.00]second line', segments: [{ start: 1, end: 2, text: 'one line' }, { start: 3, end: 4, text: 'second line' }] } }
const items = [
  { id: 1, position: 0, song, source: 'song' },
  { id: 2, position: 1, song: null, source: 'comp', channel: 'legacy', filepath: 'Songs/File.mp3', title: 'Comp file' },
  { id: 3, position: 2, song: null, source: 'donor', donor_file: { file_id: 'private-id', filename: 'mine.mp3', mime_type: 'audio/mpeg' }, title: 'My file' },
  { id: 4, position: 3, song: null, source: 'local', local_id: 'local-other-device', title: 'Elsewhere' },
]

beforeEach(async () => {
  requests = []
  prefs = [{ song: 10, name: 'Personal', playcount: 17, excluded_versions: ['v2'] }, { song: 11, cover_url: 'cover.png', playcount: 4 }]
  saveConfig({ user: { id: 1, name: 'tester', role: 'admin' } })
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    requests.push({ url, init })
    const path = url.pathname.replace(/^\/juicewrld/, '')
    let data: unknown
    if (path === '/accounts/account/me/') {
      if (init.method === 'PATCH') prefs = JSON.parse(String(init.body)).user_preferences
      data = { id: 1, username: 'tester', is_administrator: true, is_donor: true, user_preferences: prefs }
    } else if (path === '/library/favorites/') data = []
    else if (path === '/library/playlists/') data = [{ id: 5, name: 'Mix', track_count: 4, is_public: false }]
    else if (path === '/library/playlists/5/') data = { id: 5, name: 'Mix', items }
    else if (path.startsWith('/library/playlists/5/entries/')) return new Response(null, { status: 204 })
    else if (path === '/songs/') data = url.searchParams.has('all') ? [song] : { results: [song] }
    else if (path === '/songs/10/') data = song
    else if (path === '/accounts/donor/lyrics/options/') data = { available: true, max_file_size: 100000, options: [{ mode: 'plain', label: 'Plain', available: true }] }
    else if (path === '/accounts/donor/lyrics/jobs/') data = init.method === 'POST' ? job : { results: [job] }
    else if (path.includes(`/lyrics/jobs/${job.id}/`)) {
      if (url.searchParams.has('output')) return new Response(job.result.synced_lyrics)
      data = job
    } else if (path === '/accounts/admin/logs/events/') data = { results: [], count: 0, scanned_lines: 0 }
    else if (path === '/accounts/admin/logs/ws-ticket/') data = { ticket: 'local-ticket', expires_in: 60 }
    else if (path.endsWith('/contributor/proposals/upload/init/')) data = { upload_id: 'upload', chunk_size: 8 * 1024 * 1024, total_chunks: 3 }
    else if (path.endsWith('/contributor/proposals/upload/chunk/')) data = { ok: true }
    else if (path.endsWith('/contributor/proposals/upload/complete/')) data = { id: 30, status: 'pending' }
    else if (path.endsWith('/contributor/proposals/upload/stage/')) data = { uploads: [{ upload_id: 'staged-id' }] }
    else if (path.endsWith('/contributor/proposals/')) data = { id: 30, status: 'pending' }
    else if (path.endsWith('/admin/comp-replace/')) data = { files: 1, added: 1, changed: 0, removed: 0, unchanged: 0, commit_id: 'commit' }
    else if (path.startsWith('/files/')) data = { entries: [] }
    else throw new Error(`unmocked ${init.method || 'GET'} ${path}`)
    return Response.json(data)
  }
  await primeStore(true)
})

function shell(answers: string[] = []) {
  const lines: string[] = []
  const questions: string[] = []
  const sh = new Shell({ ask: async (question) => { questions.push(question); return answers.shift() ?? '' } }, false)
  sh.localDir = HOME_DIR
  const print = sh.print.bind(sh)
  sh.print = (line, tone) => { lines.push(line); if (tone === 'error') print(line, tone) }
  return { sh, lines, questions }
}

test('the standalone bundle starts without runtime dependencies', async () => {
  const file = join(HOME_DIR, 'standalone.mjs')
  await copyFile('dist/unreleased.mjs', file)
  const result = spawnSync(process.execPath, [file, '--version'], { encoding: 'utf8', cwd: HOME_DIR })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /unreleased-cli /)
})

test('new commands are registered with help and aliases', async () => {
  const { sh, lines } = shell()
  for (const name of ['lyricsgen', 'lyricgen', 'lyricsjobs', 'lyricsmodel', 'logs', 'serverlog', 'beta', 'comp-replace', 'onthisday', 'otd', 'versionprefs']) assert.equal(await sh.execLine(`help ${name}`), true, name)
  assert.match(lines.join('\n'), /lyricsgen/)
})

test('On this day uses app date parsing and remembers numbered songs', async () => {
  const { sh, lines } = shell()
  assert.equal(await sh.execLine('onthisday oct 24'), true)
  assert.match(lines.join('\n'), /Recorded.*Example/)
  assert.equal((await tracksFromArg('1', sh)).tracks[0].songId, 10)
  assert.equal(await sh.execLine('onthisday 02-30'), false)
})

test('mixed playlists keep every row and play the correct file number', async () => {
  const { sh, lines } = shell()
  assert.equal(await sh.execLine('playlist show Mix'), true)
  assert.match(lines.join('\n'), /2\s+Comp file/)
  assert.match(lines.join('\n'), /4\s+Elsewhere.*not on this device/)
  const comp = (await tracksFromArg('2', sh)).tracks[0]
  assert.equal(new URL(comp.url).searchParams.get('channel'), 'legacy')
  assert.equal((await tracksFromArg('3', sh)).tracks[0].headers?.Authorization, 'Token test-token')
  await assert.rejects(tracksFromArg('4', sh), /unavailable/)
  assert.equal(await sh.execLine('playlist remove Mix -- at 4'), true)
  assert(requests.some((r) => r.url.pathname.endsWith('/entries/4/') && r.init.method === 'DELETE'))
})

test('folder selection preserves relative paths and file bytes', async () => {
  const root = await mkdtemp(join(HOME_DIR, 'comp-'))
  await mkdir(join(root, 'Songs'))
  await writeFile(join(root, 'Songs', 'test.mp3'), 'audio')
  const files = await folderFiles(root)
  assert.match((files[0] as File & { webkitRelativePath: string }).webkitRelativePath, /\/Songs\/test.mp3$/)
  assert.equal(await files[0].text(), 'audio')
  assert.equal(files[0].type, 'audio/mpeg')
})

test('small proposal uploads use multipart data and the signed-in token', async () => {
  const path = join(HOME_DIR, 'upload.mp3')
  await writeFile(path, 'audio')
  const { sh } = shell([path])
  assert.equal(await sh.execLine('comp new replace Compilation/Example.mp3'), true)
  const req = requests.find((r) => r.url.pathname.endsWith('/contributor/proposals/') && r.init.method === 'POST')!
  assert(req.init.body instanceof FormData)
  assert.equal(new Headers(req.init.headers).get('authorization'), 'Token test-token')
  assert.equal(await (req.init.body.get('file') as File).text(), 'audio')
})

test('large proposal uploads keep every chunk, channel and auth header', async () => {
  const path = join(HOME_DIR, 'large.mp3')
  const size = 17 * 1024 * 1024
  await writeFile(path, Buffer.alloc(size))
  const { sh, lines } = shell([path])
  assert.equal(await sh.execLine('comp new replace Compilation/Large.mp3 --channel legacy'), true, lines.join('\n'))
  const chunks = requests.filter((r) => r.url.pathname.endsWith('/upload/chunk/'))
  assert.equal(chunks.length, 3)
  assert.equal(chunks.reduce((n, r) => n + ((r.init.body as FormData).get('chunk') as Blob).size, 0), size)
  assert(chunks.every((r) => (r.init.body as FormData).get('channel') === 'legacy' && new Headers(r.init.headers).get('authorization') === 'Token test-token'))
})

test('comp replacement dry-run sends no mutation', async () => {
  const root = await mkdtemp(join(HOME_DIR, 'dry-run-'))
  await writeFile(join(root, 'song.mp3'), 'audio')
  const { sh, lines } = shell([root])
  assert.equal(await sh.execLine('comp-replace --dry-run --channel legacy'), true, lines.join('\n'))
  assert(requests.every((r) => !r.init.method || r.init.method === 'GET'))
})

test('confirmation retries reuse the folder that was reviewed', async () => {
  const root = await mkdtemp(join(HOME_DIR, 'replace-'))
  await writeFile(join(root, 'song.mp3'), 'audio')
  const { sh, lines, questions } = shell([root, 'y'])
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
  try {
    assert.equal(await sh.execLine('comp-replace --channel legacy'), true, lines.join('\n'))
    assert.equal(questions.length, 2)
    const req = requests.find((r) => r.url.pathname.endsWith('/admin/comp-replace/'))!
    assert.deepEqual(JSON.parse(String(req.init.body)).files, [{ file_path: 'song.mp3', upload_id: 'staged-id' }])
  } finally {
    if (descriptor) Object.defineProperty(process.stdin, 'isTTY', descriptor)
    else delete (process.stdin as { isTTY?: boolean }).isTTY
  }
})

test('play history survives queue replacement and private headers are cleared', async () => {
  const player = new Player(() => {})
  const writes: [string, unknown][] = []
  const engine = {
    set: async (name: string, value: unknown) => { writes.push([name, value]) },
    command: async (name: string) => { if (name === 'loadfile') (player as any).loadWaiter?.({ event: 'file-loaded' }) },
  }
  ;(player as any).engine = async () => engine
  const privateTrack = { title: 'Private', url: 'https://example.com/private', duration: 1, headers: { Authorization: 'Token private' } }
  await player.playCollection([privateTrack])
  await player.playCollection([trackFromSong(song)])
  assert.deepEqual(player.history, [privateTrack])
  assert.deepEqual(writes.filter(([key]) => key === 'http-header-fields').map(([, value]) => value), [['Authorization: Token private'], []])
})

test('lyrics can name the playing server song without uploading it', async () => {
  const { sh } = shell()
  sh.player = new Player(() => {})
  sh.player.queue = [trackFromSong(song)]
  sh.player.index = 0
  assert.equal(await sh.execLine('lyricsgen plain --now'), true)
  const req = requests.find((r) => r.url.pathname.endsWith('/lyrics/jobs/') && r.init.method === 'POST')!
  assert(req.init.body instanceof FormData)
  assert.equal(req.init.body.get('song_id'), '10')
  assert.equal(req.init.body.get('file'), null)
})

test('lyrics timing drafts reach the downloaded output', async () => {
  const { sh, lines } = shell()
  assert.equal(await sh.execLine('lyricsgen timing 1 1 +0.2'), true, lines.join('\n'))
  assert.equal(await sh.execLine('lyricsgen get 1 lrc'), true, lines.join('\n'))
  assert.match(await readFile(join(HOME_DIR, 'Example.lrc'), 'utf8'), /\[00:01\.20\]/)
})

test('version preference writes preserve unrelated fields and rows', async () => {
  const { sh } = shell()
  await runSiteAction(sh, async () => {
    useStore.getState().setSongDefaultVersion(10, 'v1')
    useStore.getState().setSongExcludedVersions(10, [])
  })
  assert.equal(prefs[0].name, 'Personal')
  assert.equal(prefs[0].playcount, 17)
  assert.equal(prefs[0].default_version, 'v1')
  assert.deepEqual(prefs[0].excluded_versions, [])
  assert.equal(prefs[1].cover_url, 'cover.png')
})

test('logs preserve the comp-channel filter', async () => {
  const { sh } = shell()
  assert.equal(await sh.execLine('logs --channel legacy --json'), true)
  assert(requests.some((r) => r.url.pathname.endsWith('/admin/logs/events/') && r.url.searchParams.get('channel') === 'legacy'))
})

test('upload cancellation calls abort and loadend', async () => {
  const controller = new AbortController()
  setActiveSignal(controller.signal)
  globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  })
  const xhr = new XMLHttpRequest()
  let ended = false
  const aborted = new Promise<void>((resolve) => { xhr.onabort = resolve })
  xhr.onloadend = () => { ended = true }
  xhr.open('POST', 'http://localhost/upload')
  xhr.send('audio')
  controller.abort()
  await aborted
  assert.equal(ended, true)
  setActiveSignal(undefined)
})

test('live logs connect over WebSocket and stop on Ctrl+C', async () => {
  const server = createServer()
  const wss = new WebSocketServer({ server })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  saveConfig({ user: { id: 1, name: 'tester', role: 'admin' }, rules: [{ prefix: '/accounts', base: `http://127.0.0.1:${address.port}/juicewrld` }] })
  const { sh, lines } = shell()
  const controller = new AbortController()
  wss.on('connection', (socket) => socket.on('message', (data) => {
    assert.equal(JSON.parse(String(data)).ticket, 'local-ticket')
    socket.send(JSON.stringify({ type: 'connected' }))
    socket.send(JSON.stringify({ type: 'events', results: [{ ts: '2026-10-24T00:00:00Z', level: 'INFO', category: 'comp', msg: 'local event' }], dropped: 0, skipped_bytes: 0 }))
  }))
  const command = siteCommands(new Set()).find((c) => c.name === 'logs')!
  sh.print = (line) => { lines.push(line); if (line.includes('local event')) controller.abort() }
  setActiveSignal(controller.signal)
  const timeout = setTimeout(() => controller.abort(), 2000)
  try { await command.run('tail --channel legacy', sh); assert.match(lines.join('\n'), /local event/) }
  finally { clearTimeout(timeout); setActiveSignal(undefined); wss.clients.forEach((c) => c.terminate()); await new Promise<void>((resolve) => wss.close(() => server.close(() => resolve()))) }
})
