import Header from './components/Header.jsx'
import { BookIcon, ChatIcon, FileIcon } from './components/Icons.jsx'

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
  return (
    <div className="app">
      <Header />
      <main className="workspace">
        <section className="panel sidebar" aria-label="Documents">
          <div className="panel-header">Documents</div>
          <div className="panel-body">
            <EmptyState icon={FileIcon} title="No documents yet">
              Upload PDFs (papers, reports, policies) to start asking questions.
            </EmptyState>
          </div>
        </section>

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
