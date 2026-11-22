/** Turns the /api/health response into a short status line. */
function describe(health, error) {
  if (error) return { tone: 'down', text: 'API offline' }
  if (!health) return { tone: '', text: 'Connecting…' }
  if (health.database !== 'connected') return { tone: 'down', text: 'Database disconnected' }
  const index = health.vectorIndex
  if (index === 'missing') return { tone: 'warn', text: 'Vector index missing' }
  if (!index.queryable) return { tone: 'warn', text: `Vector index ${index.status.toLowerCase()}` }
  return { tone: 'ok', text: `Ready · ${health.llmProvider}` }
}

export default function Header({ health, error }) {
  const { tone, text } = describe(health, error)

  return (
    <header className="header">
      <div className="brand">
        <img src="/favicon.svg" alt="" />
        DocuMind
        <small>Ask your documents. Get cited answers.</small>
      </div>
      <span className="status" role="status" title={error?.message}>
        {health?.readOnly && <span className="badge badge-demo">Demo</span>}
        <span className={`status-dot ${tone}`} />
        {text}
      </span>
    </header>
  )
}
