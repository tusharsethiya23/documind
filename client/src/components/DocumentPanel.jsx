import { useRef, useState } from 'react'
import { FileIcon, TrashIcon, UploadIcon, XIcon } from './Icons.jsx'

function StatusBadge({ doc }) {
  if (doc.status === 'processing') return <span className="badge badge-busy">Indexing…</span>
  if (doc.status === 'failed') {
    return (
      <span className="badge badge-error" title={doc.error ?? undefined}>
        Failed
      </span>
    )
  }
  return null
}

function UploadRow({ upload, onDismiss }) {
  return (
    <li className={`upload ${upload.error ? 'upload-error' : ''}`}>
      <div className="upload-top">
        <span className="doc-name" title={upload.name}>
          {upload.name}
        </span>
        {upload.error && (
          <button className="icon-btn" onClick={() => onDismiss(upload.id)} aria-label={`Dismiss ${upload.name}`}>
            <XIcon />
          </button>
        )}
      </div>
      {upload.error ? (
        <div className="upload-message">{upload.error}</div>
      ) : (
        <div className="progress" role="progressbar" aria-valuenow={Math.round(upload.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="progress-bar" style={{ width: `${Math.max(4, upload.progress * 100)}%` }} />
        </div>
      )}
    </li>
  )
}

function DocumentRow({ doc, selected, onToggle, onRemove }) {
  const [busy, setBusy] = useState(false)
  const ready = doc.status === 'ready'
  const showTitle = doc.title && doc.title !== doc.filename.replace(/\.pdf$/i, '')

  const remove = async () => {
    if (!window.confirm(`Remove "${doc.filename}"? Its passages will no longer be searchable.`)) return
    setBusy(true)
    try {
      await onRemove(doc.id)
    } catch (err) {
      window.alert(err.message)
      setBusy(false)
    }
  }

  return (
    <li className={`doc ${selected ? 'doc-selected' : ''} ${ready ? '' : 'doc-inactive'}`}>
      <label className="doc-main">
        <input
          type="checkbox"
          checked={selected}
          disabled={!ready}
          onChange={() => onToggle(doc.id)}
          aria-label={`Limit questions to ${doc.filename}`}
        />
        <span className="doc-text">
          <span className="doc-name" title={doc.filename}>
            {doc.filename}
          </span>
          {showTitle && (
            <span className="doc-title" title={doc.title}>
              {doc.title}
            </span>
          )}
          <span className="doc-meta">
            {ready && `${doc.numPages} pages · ${doc.numChunks} passages`}
            <StatusBadge doc={doc} />
          </span>
        </span>
      </label>
      {onRemove && (
        <button
          className="icon-btn doc-delete"
          onClick={remove}
          disabled={busy || doc.status === 'processing'}
          aria-label={`Remove ${doc.filename}`}
          title="Remove"
        >
          <TrashIcon />
        </button>
      )}
    </li>
  )
}

export default function DocumentPanel({ docs, selectedIds, onToggle, onClearSelection, readOnly = false }) {
  const { documents, loading, error, uploads, upload, dismissUpload, remove } = docs
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  const onFiles = (fileList) => {
    if (fileList?.length && !readOnly) upload(fileList)
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    onFiles(e.dataTransfer.files)
  }

  const readyCount = documents.filter((d) => d.status === 'ready').length

  return (
    <section
      className={`panel sidebar ${dragging ? 'is-dragging' : ''}`}
      aria-label="Documents"
      onDragOver={(e) => {
        e.preventDefault()
        if (!readOnly) setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <div className="panel-header">
        <span>Documents{documents.length > 0 && ` · ${documents.length}`}</span>
      </div>

      <div className="panel-body">
        {readOnly ? (
          <div className="notice notice-demo">
            <strong>Demo library.</strong> Ask about these papers; uploading is off here. Run it yourself to use your own PDFs.
          </div>
        ) : (
          <>
            <button className="dropzone" onClick={() => inputRef.current?.click()}>
              <UploadIcon />
              <span>
                <strong>Upload PDFs</strong>
                <small>or drop them here</small>
              </span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              hidden
              onChange={(e) => {
                onFiles(e.target.files)
                e.target.value = '' // allow picking the same file again
              }}
            />
          </>
        )}

        {uploads.length > 0 && (
          <ul className="list uploads" aria-label="Uploads">
            {uploads.map((u) => (
              <UploadRow key={u.id} upload={u} onDismiss={dismissUpload} />
            ))}
          </ul>
        )}

        {error && <div className="notice notice-error">{error}</div>}

        {readyCount > 0 && (
          <div className="scope">
            {selectedIds.length === 0 ? (
              'Questions search all documents. Tick some to narrow it down.'
            ) : (
              <>
                Searching {selectedIds.length} of {readyCount}.{' '}
                <button className="link-btn" onClick={onClearSelection}>
                  Search all
                </button>
              </>
            )}
          </div>
        )}

        {loading ? (
          <div className="muted small">Loading…</div>
        ) : documents.length === 0 && !uploads.length ? (
          <div className="empty empty-compact">
            <div>
              <FileIcon />
              <p>No documents yet. Upload papers, reports or policies to start asking questions.</p>
            </div>
          </div>
        ) : (
          <ul className="list" aria-label="Indexed documents">
            {documents.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                selected={selectedIds.includes(doc.id)}
                onToggle={onToggle}
                onRemove={readOnly ? null : remove}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
