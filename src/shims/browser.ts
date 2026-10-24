import { getActiveSignal, VERSION } from '../api'
export { default as WebSocket } from 'ws'

interface Progress { lengthComputable: boolean; loaded: number; total: number }

// The shared upload clients only use this part of XHR. Fetch handles the body
// and cancellation; progress is reported when each request/chunk completes.
export class XMLHttpRequest {
  status = 0
  responseText = ''
  response: unknown = null
  responseType = ''
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  onloadend: (() => void) | null = null
  upload: { onprogress: ((event: Progress) => void) | null } = { onprogress: null }
  private method = 'GET'
  private url = ''
  private headers = new Headers({ 'User-Agent': `unreleased-cli/${VERSION}` })
  private controller = new AbortController()

  open(method: string, url: string): void { this.method = method; this.url = url }
  setRequestHeader(name: string, value: string): void { this.headers.set(name, value) }
  abort(): void { this.controller.abort() }

  send(body: RequestInit['body'] = null): void {
    const active = getActiveSignal()
    const abort = (): void => this.abort()
    if (active?.aborted) abort()
    else active?.addEventListener('abort', abort, { once: true })
    void (async () => {
      try {
        const res = await fetch(this.url, { method: this.method, headers: this.headers, body, signal: this.controller.signal })
        this.status = res.status
        this.responseText = await res.text()
        this.response = this.responseType === 'json' ? JSON.parse(this.responseText) : this.responseText
        const total = body instanceof Blob ? body.size : typeof body === 'string' ? Buffer.byteLength(body) : 0
        this.upload.onprogress?.({ lengthComputable: total > 0, loaded: total, total })
      } catch {
        if (this.controller.signal.aborted) this.onabort?.()
        else this.onerror?.()
        this.onloadend?.()
        return
      } finally { active?.removeEventListener('abort', abort) }
      this.onload?.()
      this.onloadend?.()
    })()
  }
}

export class FileReader {
  result: string | null = null
  onload: (() => void) | null = null
  onerror: ((error: unknown) => void) | null = null
  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then((bytes) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(bytes).toString('base64')}`
      this.onload?.()
    }, (error: unknown) => this.onerror?.(error))
  }
}
