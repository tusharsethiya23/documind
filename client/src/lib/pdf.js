/** pdf.js loader with a small per-document cache. */
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { documentFileUrl } from './api.js'

GlobalWorkerOptions.workerSrc = workerUrl

const MAX_CACHED = 4
const cache = new Map() // documentId -> Promise<PDFDocumentProxy>

export function loadPdf(documentId) {
  if (cache.has(documentId)) {
    const hit = cache.get(documentId)
    cache.delete(documentId) // move to most-recent
    cache.set(documentId, hit)
    return hit
  }
  const promise = getDocument({ url: documentFileUrl(documentId) }).promise
  promise.catch(() => cache.delete(documentId))
  cache.set(documentId, promise)
  while (cache.size > MAX_CACHED) {
    const [oldestId, oldest] = cache.entries().next().value
    cache.delete(oldestId)
    oldest.then((pdf) => pdf.destroy()).catch(() => {})
  }
  return promise
}

/** Regions are stored in PDF units (scale 1, top-left origin); scale them to the rendered page. */
export const scaleRegion = (r, scale) => ({
  left: r.x * scale,
  top: r.y * scale,
  width: r.width * scale,
  height: r.height * scale,
})
