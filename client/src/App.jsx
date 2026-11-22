import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import ChatPanel from './components/ChatPanel.jsx'
import DocumentPanel from './components/DocumentPanel.jsx'
import Header from './components/Header.jsx'
import { useHealth } from './hooks/useHealth.js'

// pdf.js is large; load the viewer in its own chunk so the app opens fast.
const PdfViewer = lazy(() => import('./components/PdfViewer.jsx'))
import { useChat } from './hooks/useChat.js'
import { useDocuments } from './hooks/useDocuments.js'

export default function App() {
  const { health, error: healthError } = useHealth()
  const docs = useDocuments()
  const chat = useChat()
  // Documents the next question is limited to (empty = search everything).
  const [selectedIds, setSelectedIds] = useState([])
  // The passage behind the citation the user last clicked.
  const [activeSource, setActiveSource] = useState(null)

  const toggleSelected = useCallback(
    (id) => setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])),
    [],
  )

  const readyIds = useMemo(
    () => new Set(docs.documents.filter((d) => d.status === 'ready').map((d) => d.id)),
    [docs.documents],
  )
  // Ignore selections for documents that were deleted or are no longer ready.
  const activeSelectedIds = useMemo(() => selectedIds.filter((id) => readyIds.has(id)), [selectedIds, readyIds])

  // Hide the open passage if its document was removed.
  const visibleSource = activeSource && readyIds.has(activeSource.documentId) ? activeSource : null

  return (
    <div className="app">
      <Header health={health} error={healthError} />
      <main className="workspace">
        <DocumentPanel
          docs={docs}
          readOnly={Boolean(health?.readOnly)}
          selectedIds={activeSelectedIds}
          onToggle={toggleSelected}
          onClearSelection={() => setSelectedIds([])}
        />
        <ChatPanel
          chat={chat}
          readyCount={readyIds.size}
          selectedCount={activeSelectedIds.length}
          activeChunkId={visibleSource?.chunkId}
          onAsk={(question, mode) => chat.ask(question, activeSelectedIds, mode)}
          onOpenSource={setActiveSource}
        />
        <Suspense fallback={<section className="panel viewer" aria-label="Source" />}>
          <PdfViewer source={visibleSource} />
        </Suspense>
      </main>
    </div>
  )
}
