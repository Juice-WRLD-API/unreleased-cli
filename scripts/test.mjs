import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { siteDefine, siteInject, sitePlugin } from '../site-modules.mjs'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
await import('../build.mjs')
const scratch = mkdtempSync(join(tmpdir(), 'unreleased-relay-test-'))
try {
  const outfile = join(scratch, 'relay.test.mjs')
  await build({
    entryPoints: [resolve(here, 'tests/relay.test.ts')], outfile,
    bundle: true, platform: 'node', format: 'esm', target: 'node20',
    define: { __VERSION__: '"test"', ...siteDefine },
    plugins: [sitePlugin(resolve(here, 'site'), here)], inject: siteInject(here),
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
  })
  const result = spawnSync(process.execPath, ['--test', outfile], {
    stdio: 'inherit', env: { ...process.env, UNRELEASED_HOME: scratch, UNRELEASED_TOKEN: 'test-token', UNRELEASED_API: 'http://127.0.0.1:9999/juicewrld', NO_COLOR: '1' },
  })
  process.exitCode = result.status ?? 1
} finally {
  // mkdtempSync returned this exact directory under the OS temp folder.
  if (dirname(scratch) !== resolve(tmpdir()) || !scratch.startsWith(join(tmpdir(), 'unreleased-relay-test-'))) throw new Error('unexpected test directory')
  rmSync(scratch, { recursive: true, force: true })
}
