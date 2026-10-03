import { resolve } from 'node:path'

// Which of the site's own modules the CLI compiles in as they are, and which of
// their imports get a Node version instead. Shared by build.mjs (which builds
// against the copy in site/) and scripts/sync-site.mjs (which builds against a
// checkout of the site, to learn which files that copy has to hold).
//
// The site modules are pulled in through `site:<name>` imports; their paths are
// under src/renderer/src/lib in the site repo, and site/ keeps that layout so
// their relative imports still resolve.

export function sitePlugin(siteRoot, here) {
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
      b.onResolve({ filter: /^site:/ }, (args) => {
        const path = modules[args.path]
        return path ? { path } : { errors: [{ text: `unknown site module ${args.path}` }] }
      })
      b.onResolve({ filter: /^(\.|react$)/ }, (args) => {
        const path = replaced[resolve(args.importer)]?.[args.path]
        return path ? { path } : undefined
      })
    },
  }
}
