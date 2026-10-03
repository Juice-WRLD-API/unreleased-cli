import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sitePlugin } from '../site-modules.mjs'

// Copies the site files the CLI compiles in into site/, from a checkout of the
// site repo:
//
//   npm run sync                      the checkout next to this one (../music-player-web)
//   npm run sync -- <path>            another checkout
//   UNRELEASED_SITE=<path> npm run sync
//
// It bundles the CLI against that checkout and keeps exactly the files the
// bundle read, so the copy never holds more (or less) than the build needs.
// Run it when the site's modules change, then rebuild; site/SYNCED_FROM.json
// says which site commit the copy came from.
const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const siteRoot = resolve(process.argv[2] || process.env.UNRELEASED_SITE || resolve(here, '../music-player-web'))
const probe = resolve(siteRoot, 'src/renderer/src/lib/terminal/types.ts')
if (!existsSync(probe)) {
  console.error(`${siteRoot} doesn't look like the site repo (no src/renderer/src/lib/terminal/types.ts). Pass its path: npm run sync -- <path>`)
  process.exit(1)
}

const result = await build({
  entryPoints: [resolve(here, 'src/main.ts')],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  define: { __VERSION__: '"sync"' },
  plugins: [sitePlugin(siteRoot, here)],
  metafile: true,
  logLevel: 'error',
})

const files = Object.keys(result.metafile.inputs)
  .map((f) => resolve(process.cwd(), f))
  .filter((abs) => !relative(siteRoot, abs).startsWith('..') && !relative(siteRoot, abs).includes(':'))
  .map((abs) => relative(siteRoot, abs).replaceAll('\\', '/'))
  .sort()

if (files.length === 0) {
  console.error('the build read no files from the site - nothing to copy')
  process.exit(1)
}

const dest = resolve(here, 'site')
rmSync(dest, { recursive: true, force: true })
for (const file of files) {
  const to = resolve(dest, file)
  mkdirSync(dirname(to), { recursive: true })
  cpSync(resolve(siteRoot, file), to)
}

const git = (...args) => {
  try { return execFileSync('git', ['-C', siteRoot, ...args], { encoding: 'utf8' }) } catch { return '' }
}
// Porcelain lines are "XY path"; the leading space of " M" matters, so no trim here.
const dirty = git('status', '--porcelain', '--', ...files).split('\n').filter(Boolean).map((l) => l.slice(3))
writeFileSync(
  resolve(dest, 'SYNCED_FROM.json'),
  JSON.stringify({ commit: git('rev-parse', 'HEAD').trim() || null, branch: git('rev-parse', '--abbrev-ref', 'HEAD').trim() || null, uncommittedFiles: dirty, files }, null, 2) + '\n',
)

console.log(`copied ${files.length} files from ${siteRoot}${dirty.length ? ` (uncommitted there: ${dirty.join(', ')})` : ''}`)
for (const f of files) console.log(`  ${f}`)
