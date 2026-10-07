import { readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { runningShell } from '../siteCommands'
import { fail } from '../command'

// Stands in for the site's lib/terminal/pick.ts: no system file picker or
// download here, so a command that wants a file asks for its path, and one that
// saves a file writes it into the local folder (see lcd).

export async function pickLocalFile(_accept: string): Promise<File> {
  const sh = runningShell()
  const typed = (await sh.ask('path of the file on this computer: ')).trim().replace(/^(["'])(.*)\1$/, '$2')
  if (!typed) fail('cancelled')
  const path = resolve(sh.localDir, typed.replace(/^~(?=$|[\/])/, process.env.HOME || process.env.USERPROFILE || '~'))
  let bytes: Buffer
  try { bytes = readFileSync(path) } catch { return fail(`${typed}: can't read that file`) }
  return new File([new Uint8Array(bytes)], basename(path))
}

export async function saveBlob(blob: Blob, name: string): Promise<void> {
  const sh = runningShell()
  const path = resolve(sh.localDir, basename(name))
  writeFileSync(path, Buffer.from(await blob.arrayBuffer()))
  sh.print(`saved ${path}`, 'ok')
}
