import type { User } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export function useSession(): { loading: boolean; user: User | null } {
  const [state, setState] = useState<{ loading: boolean; user: User | null }>({ loading: true, user: null })
  useEffect(() => {
    let alive = true
    void supabase.auth.getSession().then(({ data }) => {
      if (alive) setState({ loading: false, user: data.session?.user ?? null })
    })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ loading: false, user: session?.user ?? null })
    })
    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [])
  return state
}
