import { useCallback, useRef, useState } from 'react'
import { askStream } from '../lib/api.js'

let nextId = 1

/**
 * Chat state. Each question adds a user message and an assistant message whose
 * status moves: searching -> answering -> done | error | stopped.
 */
export function useChat() {
  const [messages, setMessages] = useState([])
  const controllerRef = useRef(null)

  const patch = (id, update) =>
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...(typeof update === 'function' ? update(m) : update) } : m)))

  /** @param {'ask'|'compare'} mode  compare = per-document answer + comparison (2-4 documentIds) */
  const ask = useCallback(async (question, documentIds = [], mode = 'ask') => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    const questionId = nextId++
    const answerId = nextId++
    setMessages((list) => [
      ...list,
      { id: questionId, role: 'user', text: question, documentIds, mode },
      { id: answerId, role: 'assistant', status: 'searching', text: '', sources: [], citations: [], mode, groups: null },
    ])

    await askStream(
      { question, documentIds, mode },
      {
        signal: controller.signal,
        onSources: (sources, groups) => patch(answerId, { sources, groups, status: 'answering' }),
        onToken: (text) => patch(answerId, (m) => ({ text: m.text + text })),
        onDone: (done) => patch(answerId, { ...done, status: 'done' }),
        onError: (error) => patch(answerId, { status: 'error', error }),
      },
    )
    if (controllerRef.current === controller) controllerRef.current = null
  }, [])

  const stop = useCallback(() => {
    if (!controllerRef.current) return
    controllerRef.current.abort()
    controllerRef.current = null
    setMessages((list) =>
      list.map((m) => (m.status === 'searching' || m.status === 'answering' ? { ...m, status: 'stopped' } : m)),
    )
  }, [])

  const clear = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setMessages([])
  }, [])

  const busy = messages.some((m) => m.status === 'searching' || m.status === 'answering')
  return { messages, ask, stop, clear, busy }
}
