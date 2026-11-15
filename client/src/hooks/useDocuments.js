import { useCallback, useEffect, useRef, useState } from 'react'
import { deleteDocument, listDocuments, uploadDocument } from '../lib/api.js'

const POLL_MS = 2000
let nextUploadId = 1

/**
 * Document list + uploads.
 * While any document is "processing", the list is re-fetched every 2s so its
 * status flips to "ready" (or "failed") without a page refresh.
 */
export function useDocuments() {
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // In-flight uploads: { id, name, progress (0..1), error }
  const [uploads, setUploads] = useState([])
  const mounted = useRef(true)

  const refresh = useCallback(
    () =>
      listDocuments()
        .then((docs) => {
          if (!mounted.current) return
          setDocuments(docs)
          setError(null)
        })
        .catch((err) => mounted.current && setError(err.message))
        .finally(() => mounted.current && setLoading(false)),
    [],
  )

  useEffect(() => {
    mounted.current = true
    refresh()
    return () => {
      mounted.current = false
    }
  }, [refresh])

  const anyProcessing = documents.some((d) => d.status === 'processing')
  useEffect(() => {
    if (!anyProcessing) return
    const timer = setTimeout(refresh, POLL_MS)
    return () => clearTimeout(timer)
  }, [anyProcessing, documents, refresh])

  const updateUpload = (id, patch) => setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...patch } : u)))

  /** Upload files one after another (indexing is CPU-heavy on the server). */
  const upload = useCallback(
    async (files) => {
      const queued = [...files].map((file) => ({ id: nextUploadId++, file, name: file.name, progress: 0, error: null }))
      setUploads((list) => [...list, ...queued.map(({ file: _file, ...u }) => u)])

      for (const item of queued) {
        if (!item.name.toLowerCase().endsWith('.pdf')) {
          updateUpload(item.id, { error: 'Not a PDF' })
          continue
        }
        try {
          const { document } = await uploadDocument(item.file, {
            onProgress: (p) => updateUpload(item.id, { progress: p }),
          })
          if (!mounted.current) return
          // Show it in the list right away; polling takes over from here.
          setDocuments((docs) => [document, ...docs.filter((d) => d.id !== document.id)])
          setUploads((list) => list.filter((u) => u.id !== item.id))
        } catch (err) {
          updateUpload(item.id, { error: err.message })
        }
      }
    },
    [],
  )

  const dismissUpload = (id) => setUploads((list) => list.filter((u) => u.id !== id))

  const remove = useCallback(async (id) => {
    await deleteDocument(id)
    setDocuments((docs) => docs.filter((d) => d.id !== id))
  }, [])

  return { documents, loading, error, uploads, upload, dismissUpload, remove, refresh }
}
