import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Answer from './Answer.jsx'
import { ChatIcon } from './Icons.jsx'

const EXAMPLES = [
  'Summarize the main findings.',
  'What methodology or data was used?',
  'What limitations do the authors mention?',
]

const COMPARE_EXAMPLES = [
  'How do their methods differ?',
  'What datasets does each one use?',
  'What hardware was each trained on?',
]

export default function ChatPanel({ chat, readyCount, selectedCount, activeChunkId, onAsk, onOpenSource }) {
  const { messages, busy, stop, clear } = chat
  const [draft, setDraft] = useState('')
  const [wantCompare, setWantCompare] = useState(false)
  const canCompare = selectedCount >= 2 && selectedCount <= 4
  const comparing = wantCompare && canCompare
  const scrollRef = useRef(null)
  const stickToBottom = useRef(true)
  const inputRef = useRef(null)

  const canAsk = readyCount > 0 && !busy

  // Follow the streaming answer, unless the user scrolled up to read.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  useEffect(() => {
    if (!busy) inputRef.current?.focus()
  }, [busy])

  const submit = (text = draft) => {
    const question = text.trim()
    if (!question || !canAsk) return
    stickToBottom.current = true
    onAsk(question, comparing ? 'compare' : 'ask')
    setDraft('')
  }

  const scope = comparing
    ? `Comparing ${selectedCount} documents side by side`
    : selectedCount
      ? `Searching ${selectedCount} selected document${selectedCount > 1 ? 's' : ''}`
      : 'Searching all documents'
  const compareHint =
    selectedCount > 4 ? 'Compare up to 4 documents' : selectedCount < 2 ? 'Tick 2–4 documents to compare them' : undefined
  const examples = comparing ? COMPARE_EXAMPLES : EXAMPLES

  return (
    <section className="panel chat" aria-label="Chat">
      <div className="panel-header">
        <span>Ask</span>
        {messages.length > 0 && (
          <button className="link-btn small" onClick={clear}>
            New chat
          </button>
        )}
      </div>

      <div
        className="panel-body messages"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="empty">
            <div>
              <ChatIcon />
              <h3>Ask anything about your documents</h3>
              <p>Every answer cites the page it came from. If the documents don't say, DocuMind says so.</p>
              {readyCount > 0 && (
                <div className="examples">
                  {examples.map((q) => (
                    <button key={q} className="chip" onClick={() => submit(q)} disabled={!canAsk}>
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="question">
                {m.mode === 'compare' && <span className="question-tag">Compare · {m.documentIds.length} documents</span>}
                {m.text}
              </div>
            ) : (
              <Answer key={m.id} message={m} activeChunkId={activeChunkId} onOpenSource={onOpenSource} />
            ),
          )
        )}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={readyCount ? 'Ask a question…' : 'Upload a document to start asking questions'}
          disabled={!readyCount}
          rows={2}
          maxLength={2000}
          aria-label="Your question"
        />
        <div className="composer-bar">
          {readyCount > 0 && (
            <div className="mode-switch" role="radiogroup" aria-label="Question mode">
              <button
                type="button"
                role="radio"
                aria-checked={!comparing}
                className={!comparing ? 'on' : ''}
                onClick={() => setWantCompare(false)}
              >
                Ask
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={comparing}
                className={comparing ? 'on' : ''}
                onClick={() => setWantCompare(true)}
                disabled={!canCompare}
                title={compareHint}
              >
                Compare
              </button>
            </div>
          )}
          <span className="small muted composer-scope">{readyCount ? scope : ''}</span>
          {busy ? (
            <button type="button" className="btn btn-secondary" onClick={stop}>
              Stop
            </button>
          ) : (
            <button type="submit" className="btn" disabled={!canAsk || !draft.trim()}>
              Ask
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
