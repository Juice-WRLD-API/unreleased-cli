import { build } from 'esbuild'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sitePlugin, siteDefine } from './site-modules.mjs'

// Bundles the CLI into one file with no runtime dependencies. Some of the site's
// own modules are compiled in as they are (the file tools behind cat, grep,
// tree, du, locate, head, tail, wc; the listening-stats maths; the terminal's
// name matching and colour schemes; the Wordle and Heardle game logic), so both
// terminals behave the same. Those modules live in site/, a copy of the site's
// files taken by `npm run sync`; see site-modules.mjs for the list and for what
// gets swapped for a Node version (their localStorage is src/shims/localStorage.ts).
const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8'))

const siteRoot = resolve(here, 'site')
if (!existsSync(resolve(siteRoot, 'src'))) {
  console.error('site/ is empty - run: npm run sync   (it copies the site files the CLI uses from a checkout of the site)')
  process.exit(1)
}

await build({
  entryPoints: [resolve(here, 'src/main.ts')],
  outfile: resolve(here, 'dist/unreleased.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  define: { __VERSION__: JSON.stringify(pkg.version), ...siteDefine },
  plugins: [sitePlugin(siteRoot, here)],
  logLevel: 'info',
})
