import { useEffect, useMemo, useState } from 'react'
import type { Medication } from '../../lib/types'
import { searchDpd, searchMine, searchRxTerms, type Suggestion } from './sources'

export type Group = { items: Suggestion[]; state: 'idle' | 'loading' | 'error' | 'done' }

const IDLE: Group = { items: [], state: 'idle' }
const LOADING: Group = { items: [], state: 'loading' }

type Tagged = { q: string; group: Group }
const MIN_CHARS = 3
const DEBOUNCE_MS = 300

export function useSuggestions(
  q: string,
  meds: Medication[],
  remoteEnabled: boolean,
): { mine: Suggestion[]; ca: Group; us: Group } {
  const mine = useMemo(() => searchMine(q, meds), [q, meds])
  const active = remoteEnabled && q.length >= MIN_CHARS
  const [ca, setCa] = useState<Tagged | null>(null)
  const [us, setUs] = useState<Tagged | null>(null)

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    let current = true
    const timer = setTimeout(() => {
      const run = (
        search: (q: string, s: AbortSignal) => Promise<Suggestion[]>,
        set: (t: Tagged) => void,
      ) =>
        search(q, controller.signal).then(
          (items) => current && set({ q, group: { items, state: 'done' } }),
          (err: unknown) => {
            if (!current || (err as { name?: string })?.name === 'AbortError') return
            set({ q, group: { items: [], state: 'error' } })
          },
        )
      void run(searchDpd, setCa)
      void run(searchRxTerms, setUs)
    }, DEBOUNCE_MS)
    return () => {
      current = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [q, active])

  const pick = (t: Tagged | null): Group => (!active ? IDLE : t?.q === q ? t.group : LOADING)
  return { mine, ca: pick(ca), us: pick(us) }
}
