/*  The one way the drawer's steps ask Kamra something as the desk types:
    wait DEBOUNCE_MS after the inputs (`deps`) last changed, ask, and hand
    the answer on only if the inputs are still the same by then. */

import { useEffect, useRef, type DependencyList } from "react"

/** How long the drawer waits after typing before it asks Kamra. */
export const DEBOUNCE_MS = 250

export function useKamra<T>(
  /** the question for the current inputs, or null when there's nothing to ask */
  ask: (() => Promise<T>) | null,
  deps: DependencyList,
  onAnswer: (value: T) => void,
  onError: (e: unknown) => void,
  /** 0 asks at once (an answer that doesn't follow typing) */
  delay = DEBOUNCE_MS,
) {
  // the callbacks change every render; the inputs that matter are `deps`
  const latest = useRef({ ask, onAnswer, onError })
  latest.current = { ask, onAnswer, onError }

  useEffect(() => {
    const question = latest.current.ask
    if (!question) return
    let live = true
    const run = () =>
      question().then(
        (v) => live && latest.current.onAnswer(v),
        (e: unknown) => live && latest.current.onError(e),
      )
    const timer = delay > 0 ? setTimeout(run, delay) : undefined
    if (delay <= 0) void run()
    return () => {
      live = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
