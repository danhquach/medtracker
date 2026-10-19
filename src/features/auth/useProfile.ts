import { useCallback, useEffect, useState } from 'react'
import { getProfile } from '../../data/profile'
import type { Profile } from '../../lib/types'

export function useProfileState(): { profile: Profile | null; error: string | null; retry: () => void } {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    getProfile().then(
      (p) => {
        if (!alive) return
        setProfile(p)
        setError(null)
      },
      (e: unknown) => {
        console.error('profile load failed', e)
        if (alive) setError(e instanceof Error ? e.message : 'Could not load your profile')
      },
    )
    return () => {
      alive = false
    }
  }, [attempt])
  const retry = useCallback(() => {
    setError(null)
    setAttempt((n) => n + 1)
  }, [])
  return { profile, error, retry }
}

export function useProfile(): Profile | null {
  return useProfileState().profile
}
