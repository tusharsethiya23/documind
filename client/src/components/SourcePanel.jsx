import { documentFileUrl } from '../lib/api.js'
import { pageLabel } from '../lib/answerFormat.js'
import { BookIcon } from './Icons.jsx'

/** Shows the passage behind a citation. (Step 4b swaps this for an in-app PDF viewer.) */
export default function SourcePanel({ source }) {
  return (
    <section className="panel viewer" aria-label="Source">
      <div className="panel-header">Source</div>
      <div className="panel-body">
        {!source ? (
          <div className="empty">
            <div>
              <BookIcon />
              <h3>Cited passages appear here</h3>
              <p>Click a citation number in an answer to see the passage it came from.</p>
            </div>
          </div>
        ) : (
          <article className="source-detail">
            <h3>{source.filename}</h3>
            <div className="small muted">
              {pageLabel(source)}
              {source.section && ` · ${source.section}`}
            </div>
            <blockquote>{source.text}</blockquote>
            <a className="btn btn-secondary" href={`${documentFileUrl(source.documentId)}#page=${source.pageStart}`} target="_blank" rel="noreferrer">
              Open PDF at {pageLabel(source)}
            </a>
          </article>
        )}
      </div>
    </section>
  )
}
