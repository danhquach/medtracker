import { useEffect, useState } from 'react'
import { getProfile } from '../../data/profile'
import type { Profile } from '../../lib/types'

export function useProfile(): Profile | null {
  const [profile, setProfile] = useState<Profile | null>(null)
  useEffect(() => {
    let alive = true
    getProfile().then(
      (p) => alive && setProfile(p),
      (e) => console.error('profile load failed', e),
    )
    return () => {
      alive = false
    }
  }, [])
  return profile
}
