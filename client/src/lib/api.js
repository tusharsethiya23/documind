/** Client for the DocuMind Express API. */

const BASE = import.meta.env?.VITE_API_URL ?? '/api'

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function request(path, options = {}) {
  let res
  try {
    res = await fetch(`${BASE}${path}`, options)
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is the API running (npm run dev in server/)?')
  }
  if (res.status === 204) return null
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`)
  return body
}

/** Health returns 503 with a useful body when the database is down, so read it either way. */
export async function getHealth() {
  let res
  try {
    res = await fetch(`${BASE}/health`)
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is the API running (npm run dev in server/)?')
  }
  const body = await res.json().catch(() => null)
  if (!body) throw new ApiError(res.status, `Health check failed (${res.status})`)
  return body
}

export const listDocuments = () => request('/documents').then((b) => b.documents)

export const getDocument = (id) => request(`/documents/${id}`).then((b) => b.document)

export const deleteDocument = (id) => request(`/documents/${id}`, { method: 'DELETE' })

export const documentFileUrl = (id) => `${BASE}/documents/${id}/file`

/**
 * Upload a PDF. Uses XHR (not fetch) because fetch can't report upload progress.
 * @returns {Promise<{document: object, skipped: boolean}>}
 */
export function uploadDocument(file, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/documents`)
    xhr.responseType = 'json'
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total)
    xhr.onload = () => {
      const body = xhr.response ?? {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(body)
      else reject(new ApiError(xhr.status, body.error ?? `Upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new ApiError(0, 'Upload failed: cannot reach the server.'))
    const form = new FormData()
    form.append('file', file)
    xhr.send(form)
  })
}

/** Parse one Server-Sent Events message ("event: x\ndata: {...}"). */
export function parseSseMessage(raw) {
  let event = 'message'
  const data = []
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (!data.length) return null
  return { event, data: JSON.parse(data.join('\n')) }
}

/**
 * Ask a question and stream the answer.
 * EventSource only supports GET, so we POST with fetch and parse the stream ourselves.
 *
 * @param {{question: string, documentIds?: string[]}} body
 * @param {{onSources?, onToken?, onDone?, onError?, signal?: AbortSignal}} handlers
 */
export async function askStream(body, { onSources, onToken, onDone, onError, signal } = {}) {
  let res
  try {
    res = await fetch(`${BASE}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') return
    return onError?.('Cannot reach the server. Is the API running?')
  }
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    return onError?.(b.error ?? `Request failed (${res.status})`)
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let finished = false
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value.replace(/\r\n/g, '\n')
      let boundary
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const message = parseSseMessage(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        if (!message) continue
        const { event, data } = message
        if (event === 'sources') onSources?.(data.sources, data.groups ?? null)
        else if (event === 'token') onToken?.(data.text)
        else if (event === 'done') {
          finished = true
          onDone?.(data)
        } else if (event === 'error') {
          finished = true
          onError?.(data.message)
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') return
    throw err
  }
  if (!finished && !signal?.aborted) onError?.('The connection closed before the answer finished.')
}
