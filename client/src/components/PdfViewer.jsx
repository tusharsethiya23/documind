import { useEffect, useRef, useState } from 'react'
import { documentFileUrl } from '../lib/api.js'
import { pageLabel } from '../lib/answerFormat.js'
import { loadPdf, scaleRegion } from '../lib/pdf.js'
import { BookIcon } from './Icons.jsx'

/** Renders one page of a PDF to a canvas and draws highlight boxes over it. */
function PdfPage({ pdf, pageNumber, regions, width }) {
  const canvasRef = useRef(null)
  const [size, setSize] = useState(null) // { width, height, scale }
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!pdf || !width) return
    let cancelled = false
    let task
    pdf
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return
        const base = page.getViewport({ scale: 1 })
        const scale = width / base.width
        const viewport = page.getViewport({ scale })
        const ratio = window.devicePixelRatio || 1
        const canvas = canvasRef.current
        canvas.width = Math.floor(viewport.width * ratio)
        canvas.height = Math.floor(viewport.height * ratio)
        task = page.render({
          canvas,
          viewport,
          transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
        })
        return task.promise.then(() => !cancelled && setSize({ width: viewport.width, height: viewport.height, scale }))
      })
      .catch((err) => {
        if (!cancelled && err?.name !== 'RenderingCancelledException') setError(err.message)
      })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [pdf, pageNumber, width])

  // Scroll the first highlight into view once the page is drawn.
  const firstMarkRef = useRef(null)
  useEffect(() => {
    firstMarkRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [size, regions])

  if (error) return <div className="notice notice-error">Could not render page {pageNumber}: {error}</div>

  return (
    <div className="pdf-page" style={size ? { width: size.width, height: size.height } : { width, minHeight: 300 }}>
      <canvas ref={canvasRef} style={size ? { width: size.width, height: size.height } : undefined} />
      {size &&
        regions.map((r, i) => (
          <div key={i} ref={i === 0 ? firstMarkRef : undefined} className="pdf-mark" style={scaleRegion(r, size.scale)} />
        ))}
    </div>
  )
}

export default function PdfViewer({ source }) {
  // Which document is loaded; compared with the source so a stale PDF is never shown.
  const [loaded, setLoaded] = useState({ id: null, pdf: null, error: null })
  const [page, setPage] = useState(1)
  const [width, setWidth] = useState(0)
  const containerRef = useRef(null)

  const documentId = source?.documentId
  const hasSource = Boolean(source)

  // Load the document when the source switches to a different PDF.
  useEffect(() => {
    if (!documentId) return
    let cancelled = false
    loadPdf(documentId)
      .then((pdf) => !cancelled && setLoaded({ id: documentId, pdf, error: null }))
      .catch((err) => !cancelled && setLoaded({ id: documentId, pdf: null, error: err.message }))
    return () => {
      cancelled = true
    }
  }, [documentId])

  // Jump to the cited page whenever a new citation is opened. Adjusting state
  // during render (instead of in an effect) avoids an extra render pass.
  const [shownChunk, setShownChunk] = useState(null)
  if (source && source.chunkId !== shownChunk) {
    setShownChunk(source.chunkId)
    setPage(source.pageStart)
  }

  // Fit the page to the panel width.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.floor(entry.contentRect.width))))
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasSource])

  if (!source) {
    return (
      <section className="panel viewer" aria-label="Source">
        <div className="panel-header">Source</div>
        <div className="panel-body">
          <div className="empty">
            <div>
              <BookIcon />
              <h3>Cited passages appear here</h3>
              <p>Click a citation number in an answer to open the page with the passage highlighted.</p>
            </div>
          </div>
        </div>
      </section>
    )
  }

  const current = loaded.id === documentId
  const pdf = current ? loaded.pdf : null
  const loadError = current ? loaded.error : null
  const numPages = pdf?.numPages ?? 0
  const regions = (source.regions ?? []).filter((r) => r.page === page)
  const onCitedPage = page >= source.pageStart && page <= source.pageEnd

  return (
    <section className="panel viewer" aria-label="Source">
      <div className="panel-header viewer-header">
        <span className="viewer-title" title={source.filename}>
          {source.filename}
        </span>
        <span className="viewer-nav">
          <button className="icon-btn" onClick={() => setPage((p) => p - 1)} disabled={page <= 1} aria-label="Previous page">
            ‹
          </button>
          <span className="small">
            {page}
            {numPages ? ` / ${numPages}` : ''}
          </span>
          <button className="icon-btn" onClick={() => setPage((p) => p + 1)} disabled={!numPages || page >= numPages} aria-label="Next page">
            ›
          </button>
        </span>
      </div>

      <div className="viewer-caption">
        <span>
          Cited: {pageLabel(source)}
          {source.section && ` · ${source.section}`}
        </span>
        {!onCitedPage && (
          <button className="link-btn" onClick={() => setPage(source.pageStart)}>
            Back to passage
          </button>
        )}
        <a className="link-btn" href={`${documentFileUrl(source.documentId)}#page=${page}`} target="_blank" rel="noreferrer">
          Open
        </a>
      </div>

      <div className="panel-body pdf-scroll" ref={containerRef}>
        {loadError ? (
          <div className="notice notice-error">Could not load the PDF: {loadError}</div>
        ) : !pdf ? (
          <div className="muted small">Loading PDF…</div>
        ) : (
          <PdfPage pdf={pdf} pageNumber={page} regions={onCitedPage ? regions : []} width={width} />
        )}
      </div>
    </section>
  )
}
