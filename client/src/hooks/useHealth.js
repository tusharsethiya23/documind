import { useEffect, useState } from 'react'
import { getHealth } from '../lib/api.js'

const POLL_MS = 30_000

/** Polls /api/health. Returns { health, error } (health is null until the first answer). */
export function useHealth() {
  const [state, setState] = useState({ health: null, error: null })

  useEffect(() => {
    let cancelled = false
    const check = () =>
      getHealth()
        .then((health) => !cancelled && setState({ health, error: null }))
        .catch((error) => !cancelled && setState((s) => ({ ...s, error })))
    check()
    const timer = setInterval(check, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return state
}
