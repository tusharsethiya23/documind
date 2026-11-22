import { Fragment } from 'react'
import { citedNumbers, pageLabel, toBlocks } from '../lib/answerFormat.js'

function Inline({ parts, sources, activeChunkId, onOpenSource }) {
  return parts.map((part, i) => {
    if (part.type === 'bold') return <strong key={i}>{part.text}</strong>
    if (part.type === 'text') return <Fragment key={i}>{part.text}</Fragment>

    const source = sources[part.n - 1]
    if (!source) {
      return (
        <sup key={i} className="cite cite-invalid" title="This citation doesn't match any retrieved passage">
          {part.n}
        </sup>
      )
    }
    return (
      <button
        key={i}
        type="button"
        className={`cite ${source.chunkId === activeChunkId ? 'cite-active' : ''}`}
        onClick={() => onOpenSource(source)}
        title={`${source.filename}, ${pageLabel(source)}`}
        aria-label={`Source ${part.n}: ${source.filename}, ${pageLabel(source)}`}
      >
        {part.n}
      </button>
    )
  })
}

function AnswerText({ text, ...rest }) {
  return toBlocks(text).map((block, i) => {
    if (block.type === 'p') {
      return (
        <p key={i}>
          <Inline parts={block.parts} {...rest} />
        </p>
      )
    }
    const List = block.ordered ? 'ol' : 'ul'
    return (
      <List key={i}>
        {block.items.map((parts, j) => (
          <li key={j}>
            <Inline parts={parts} {...rest} />
          </li>
        ))}
      </List>
    )
  })
}

function SourceList({ numbers, sources, activeChunkId, onOpenSource }) {
  const items = numbers.map((n) => ({ n, source: sources[n - 1] })).filter((x) => x.source)
  if (!items.length) return null
  return (
    <div className="sources">
      <div className="sources-label">Sources</div>
      <ul>
        {items.map(({ n, source }) => (
          <li key={n}>
            <button
              type="button"
              className={`source-card ${source.chunkId === activeChunkId ? 'source-active' : ''}`}
              onClick={() => onOpenSource(source)}
            >
              <span className="source-num">{n}</span>
              <span className="source-body">
                <span className="source-where">
                  {source.filename} · {pageLabel(source)}
                  {source.section && <span className="source-section"> · {source.section}</span>}
                </span>
                <span className="source-quote">{source.text}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function Answer({ message, activeChunkId, onOpenSource }) {
  const { status, text, sources, refused, reason, uncited, invalidCitations, error } = message
  const shared = { sources, activeChunkId, onOpenSource }

  if (status === 'searching') {
    return <div className="answer muted typing">Searching your documents…</div>
  }

  if (refused) {
    return (
      <div className="answer answer-refused">
        <p>{text}</p>
        <p className="small muted">
          {reason === 'low_relevance'
            ? 'None of the passages found were relevant enough to answer from, so no answer was generated.'
            : 'The relevant passages did not contain the answer.'}
        </p>
      </div>
    )
  }

  // While streaming, show sources as they get cited; afterwards, use the server's final list.
  const numbers = status === 'done' && message.citations?.length ? message.citations : citedNumbers(text)

  const uncovered = message.groups?.filter((g) => !g.covered) ?? []

  return (
    <div className="answer">
      {uncovered.length > 0 && (
        <p className="small muted coverage">
          No relevant passages in {uncovered.map((g) => g.filename).join(', ')}.
        </p>
      )}
      {text ? <AnswerText text={text} {...shared} /> : status === 'answering' && <p className="muted typing">Writing…</p>}
      {status === 'answering' && text && <span className="caret" aria-hidden />}

      {status === 'stopped' && <p className="small muted">Stopped.</p>}
      {status === 'error' && <div className="notice notice-error">{error}</div>}
      {status === 'done' && uncited && (
        <div className="notice notice-warn">This answer has no citations, so it may not come from your documents.</div>
      )}
      {status === 'done' && invalidCitations?.length > 0 && (
        <div className="notice notice-warn">Some citations ({invalidCitations.join(', ')}) don't match a retrieved passage.</div>
      )}

      <SourceList numbers={numbers} {...shared} />
    </div>
  )
}
