import { dirname, resolve, sep } from 'node:path'

// Which of the site's own modules the CLI compiles in as they are, and which of
// their imports get a Node version instead. Shared by build.mjs (which builds
// against the copy in site/) and scripts/sync-site.mjs (which builds against a
// checkout of the site, to learn which files that copy has to hold).
//
// The site modules are pulled in through `site:<name>` imports; their paths are
// under src/renderer/src/lib in the site repo, and site/ keeps that layout so
// their relative imports still resolve.

// The site's terminal command modules the CLI runs as they are (through
// src/siteCommands.ts): [file under lib/terminal, the export that holds its
// commands]. Their API modules are the site's own; what they reach for in the
// browser (the store, a file picker, confirm) is answered by src/shims.
export const COMMAND_MODULES = [
  ['catalog', 'CATALOG_COMMANDS'],
  ['news', 'NEWS_COMMANDS'],
  ['versions', 'VERSION_COMMANDS'],
  ['donor', 'DONOR_COMMANDS'],
  ['http', 'HTTP_COMMANDS'],
  ['integrations', 'INTEGRATION_COMMANDS'],
  ['community', 'COMMUNITY_COMMANDS'],
  ['adminExtras', 'ADMIN_EXTRA_COMMANDS'],
  ['account', 'ACCOUNT_COMMANDS'],
  ['editing', 'EDITING_COMMANDS'],
  ['games', 'GAME_COMMANDS'],
  ['more', 'MORE_COMMANDS'],
]

// window.confirm is a synchronous yes/no in the browser; the CLI's shim turns it
// into a question asked before the command runs again with -y.
export const siteDefine = { 'window.confirm': '__termConfirm' }

// Site modules that get a Node version wherever any other site module imports
// them, keyed by path under src/renderer/src (no extension).
const SHIMMED = {
  'lib/apiServers': 'apiServers.ts',
  'lib/appVersion': 'appVersion.ts',
  'lib/apiClient': 'apiClient.ts',
  'store/useStore': 'useStore.ts',
  'lib/terminal/pick': 'pick.ts',
  'lib/terminal/player': 'terminalPlayer.ts',
  'lib/terminal/users': 'terminalUsers.ts',
  'components/adminShared': 'adminShared.ts',
}

export function sitePlugin(siteRoot, here) {
  const srcRoot = resolve(siteRoot, 'src/renderer/src')
  const lib = resolve(siteRoot, 'src/renderer/src/lib')
  const shim = (name) => resolve(here, 'src/shims', name)

  const modules = {
    'site:fileTools': resolve(lib, 'terminalFileTools.ts'),
    'site:format': resolve(lib, 'format.ts'),
    'site:fileTypes': resolve(lib, 'fileTypes.ts'),
    'site:listeningStats': resolve(lib, 'listeningStats.ts'),
    'site:termTypes': resolve(lib, 'terminal/types.ts'),
    'site:wordle': resolve(lib, 'wordle.ts'),
    'site:heardle': resolve(lib, 'heardle.ts'),
    'site:termThemes': resolve(lib, 'terminal/themeStore.ts'),
    'site:lyricSearch': resolve(lib, 'lyricSearch.ts'),
    'site:playlistEdit': resolve(lib, 'terminal/playlistEdit.ts'),
    'site:more': resolve(lib, 'terminal/more.ts'),
  }

  // Imports made from inside the site's modules, keyed by importing file, that
  // resolve to the CLI's Node version instead.
  const replaced = {
    [resolve(lib, 'terminalFileTools.ts')]: { './terminalFiles': resolve(here, 'src/files.ts') },
    [resolve(lib, 'fileTypes.ts')]: { '../store/useStore': shim('useStore.ts') },
    [resolve(lib, 'listeningStats.ts')]: { './juicewrldApi': shim('juicewrldApi.ts') },
    [resolve(lib, 'heardle.ts')]: { './apiClient': shim('apiClient.ts'), './juicewrldApi': shim('juicewrldApi.ts') },
    [resolve(lib, 'terminal/themeStore.ts')]: { react: shim('react.ts') },
    [resolve(lib, 'versionsApi.ts')]: {
      './apiClient': shim('apiClient.ts'),
      './juicewrldApi': shim('juicewrldApi.ts'),
      './userApi': shim('userApi.ts'),
    },
  }

  return {
    name: 'site',
    setup(b) {
      // The command modules, gathered into one list.
      b.onResolve({ filter: /^site:commands$/ }, () => ({ path: 'site:commands', namespace: 'site-commands' }))
      b.onResolve({ filter: /^site:/ }, (args) => {
        const path = modules[args.path]
        return path ? { path } : { errors: [{ text: `unknown site module ${args.path}` }] }
      })
      b.onResolve({ filter: /^(\.|react$)/ }, (args) => {
        const path = replaced[resolve(args.importer)]?.[args.path]
        if (path) return { path }
        if (args.path.startsWith('.') && args.importer && resolve(args.importer).startsWith(srcRoot)) {
          const target = resolve(dirname(args.importer), args.path).slice(srcRoot.length + 1).split(sep).join('/').replace(/\.tsx?$/, '')
          if (SHIMMED[target]) return { path: shim(SHIMMED[target]) }
        }
        return undefined
      })
      b.onLoad({ filter: /.*/, namespace: 'site-commands' }, () => ({
        resolveDir: lib,
        loader: 'ts',
        contents: [
          ...COMMAND_MODULES.map(([file, name]) => `import { ${name} } from './terminal/${file}'`),
          `export const SITE_COMMANDS = [${COMMAND_MODULES.map(([, name]) => `...${name}`).join(', ')}]`,
        ].join('\n'),
      }))
    },
  }
}
