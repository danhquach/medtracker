import type { User } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { sessionUser, supabase } from '../../lib/supabase'

export function useSession(): { loading: boolean; user: User | null } {
  const [state, setState] = useState<{ loading: boolean; user: User | null }>({ loading: true, user: null })
  useEffect(() => {
    let alive = true
    void sessionUser().then((user) => {
      if (alive) setState({ loading: false, user })
    })
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // The initial state comes from sessionUser(), which also covers an expired session offline.
      if (event === 'INITIAL_SESSION') return
      setState({ loading: false, user: session?.user ?? null })
    })
    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [])
  return state
}
