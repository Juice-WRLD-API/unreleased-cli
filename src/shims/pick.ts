import { openAsBlob } from 'node:fs'
import { readdir, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { commandInput, deferCommand, runningShell } from '../siteCommands'
import { fail } from '../command'

// Stands in for the site's lib/terminal/pick.ts: no system file picker or
// download here, so a command that wants a file asks for its path, and one that
// saves a file writes it into the local folder (see lcd).

async function askPath(label: string): Promise<string> {
  const sh = runningShell()
  const typed = (await sh.ask(label)).trim().replace(/^(["'])(.*)\1$/, '$2')
  if (!typed) fail('cancelled')
  return resolve(sh.localDir, typed.replace(/^~(?=$|[\\/])/, homedir()))
}

// Disk-backed blobs keep a whole comp folder from being read into memory.
export async function localFile(path: string, relativePath?: string): Promise<File> {
  const info = await stat(path)
  if (!info.isFile()) fail(`${path}: not a file`)
  const type = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.txt': 'text/plain', '.lrc': 'text/plain' } as Record<string, string>)[extname(path).toLowerCase()] || 'application/octet-stream'
  const blob = await openAsBlob(path, { type })
  const file = new File([blob], basename(path), { type, lastModified: info.mtimeMs })
  if (relativePath) Object.defineProperty(file, 'webkitRelativePath', { value: relativePath })
  return file
}

export async function pickLocalFile(_accept: string): Promise<File> {
  return commandInput(async () => localFile(await askPath('path of the file on this computer: ')))
}

export async function folderFiles(path: string): Promise<File[]> {
  if (!(await stat(path)).isDirectory()) fail(`${path}: not a folder`)
  const files: File[] = []
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = `${prefix}/${entry.name}`
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel)
      else if (entry.isFile()) files.push(await localFile(join(dir, entry.name), rel))
    }
  }
  await walk(path, basename(path))
  if (!files.length) fail(`${path}: no files in that folder`)
  return files
}

export async function pickLocalFolder(): Promise<File[]> {
  return commandInput(async () => folderFiles(await askPath('path of the comp folder on this computer: ')))
}

// Site commands don't await saveBlob; their wrapper waits for these writes.
export function saveBlob(blob: Blob, name: string): void {
  const sh = runningShell()
  const path = resolve(sh.localDir, basename(name))
  deferCommand(async () => {
    await writeFile(path, Buffer.from(await blob.arrayBuffer()))
    sh.print(`saved ${path}`, 'ok')
  })
}
