import { useEffect, useState } from 'react'
import { getHealth } from '../lib/api.js'

const POLL_MS = 30_000

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

export default function Header() {
  const [health, setHealth] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const h = await getHealth()
        if (!cancelled) {
          setHealth(h)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err)
      }
    }
    check()
    const timer = setInterval(check, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const { tone, text } = describe(health, error)

  return (
    <header className="header">
      <div className="brand">
        <img src="/favicon.svg" alt="" />
        DocuMind
        <small>Ask your documents. Get cited answers.</small>
      </div>
      <span className="status" role="status" title={error?.message}>
        <span className={`status-dot ${tone}`} />
        {text}
      </span>
    </header>
  )
}
