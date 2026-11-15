import { useCallback, useMemo, useState } from 'react'
import DocumentPanel from './components/DocumentPanel.jsx'
import Header from './components/Header.jsx'
import { BookIcon, ChatIcon } from './components/Icons.jsx'
import { useDocuments } from './hooks/useDocuments.js'

function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="empty">
      <div>
        <Icon />
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
    </div>
  )
}

export default function App() {
  const docs = useDocuments()
  // Documents the next question is limited to (empty = search everything).
  const [selectedIds, setSelectedIds] = useState([])

  const toggleSelected = useCallback(
    (id) => setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])),
    [],
  )

  // Ignore selections for documents that were deleted or are no longer ready.
  const activeSelectedIds = useMemo(() => {
    const ready = new Set(docs.documents.filter((d) => d.status === 'ready').map((d) => d.id))
    return selectedIds.filter((id) => ready.has(id))
  }, [docs.documents, selectedIds])

  return (
    <div className="app">
      <Header />
      <main className="workspace">
        <DocumentPanel
          docs={docs}
          selectedIds={activeSelectedIds}
          onToggle={toggleSelected}
          onClearSelection={() => setSelectedIds([])}
        />

        <section className="panel chat" aria-label="Chat">
          <div className="panel-header">Ask</div>
          <div className="panel-body">
            <EmptyState icon={ChatIcon} title="Ask anything about your documents">
              Every answer cites the page it came from. If the documents don't say, DocuMind says so.
            </EmptyState>
          </div>
        </section>

        <section className="panel viewer" aria-label="PDF viewer">
          <div className="panel-header">Source</div>
          <div className="panel-body">
            <EmptyState icon={BookIcon} title="Cited passages appear here">
              Click a citation in an answer to open the page with the passage highlighted.
            </EmptyState>
          </div>
        </section>
      </main>
    </div>
  )
}
