// Stands in for react inside the site's terminal theme table
// (lib/terminal/themeStore.ts), which also holds a hook the CLI never calls.
export const useSyncExternalStore = (): never => {
  throw new Error('not available outside the browser')
}
