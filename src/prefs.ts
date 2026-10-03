import { loadSettings, saveSettings } from './config'

// What `set` and `termtheme` change, kept in ~/.unreleased/settings.json so it
// carries over between sessions - the site keeps the same things in its store.
// Read lazily and cached; every write goes straight to disk.

let cache: Record<string, unknown> | null = null
const all = (): Record<string, unknown> => (cache ??= loadSettings())

export function pref<T extends string | number | boolean>(key: string, fallback: T): T {
  const v = all()[key]
  return typeof v === typeof fallback ? (v as T) : fallback
}

export function setPref(key: string, value: string | number | boolean): void {
  all()[key] = value
  saveSettings(all())
}
