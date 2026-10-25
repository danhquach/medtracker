import { useCallback, useEffect, useRef, useState } from 'react'
import { getProfile, updateProfile, type ProfilePatch } from '../../data/profile'
import type { Profile } from '../../lib/types'
import { needsPasswordFinish } from '../auth/auth'
import LoadError from '../auth/LoadError'
import SetPasswordForm from '../auth/SetPasswordForm'
import { useSession } from '../auth/useSession'
import { useDeviceNotificationState } from '../notifications/useDeviceNotificationState'
import { Notice } from '../../components/layout'
import AboutSection from './AboutSection'
import AccountSection from './AccountSection'
import DangerZone from './DangerZone'
import MedicationsSection from './MedicationsSection'
import ReminderStatus from './ReminderStatus'
import RemindersSection from './RemindersSection'
import { msg } from './msg'
import type { SettingKey } from './Saved'

export default function Settings() {
  const { user } = useSession()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [nickname, setNickname] = useState('')
  const [saved, setSaved] = useState<SettingKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const device = useDeviceNotificationState()

  const [profileError, setProfileError] = useState<string | null>(null)
  const alive = useRef(true)
  const saveSeq = useRef(0)

  const loadProfile = useCallback(async () => {
    try {
      const p = await getProfile()
      if (!alive.current) return
      setProfile(p)
      setNickname(p.nickname ?? '')
      setProfileError(null)
    } catch (e) {
      console.error('profile load failed', e)
      if (alive.current) setProfileError(msg(e, 'Could not load your profile'))
    }
  }, [])

  useEffect(() => {
    alive.current = true
    queueMicrotask(() => void loadProfile())
    return () => {
      alive.current = false
    }
  }, [loadProfile])

  // Every setting saves on change. Only the most recent save may write state; on failure, show what the server actually holds.
  async function save(patch: ProfilePatch) {
    setError(null)
    setSaved(null)
    const seq = ++saveSeq.current
    try {
      const row = await updateProfile(patch)
      if (seq === saveSeq.current) {
        setProfile(row)
        setSaved(Object.keys(patch)[0] as SettingKey)
      }
    } catch (e) {
      setError(msg(e, 'Could not save'))
      if (seq === saveSeq.current) await loadProfile()
    }
  }

  const section = { profile, saved, save, onError: setError }

  return (
    <main className="stack settings">
      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {profileError && !profile && <LoadError message={profileError} onRetry={() => void loadProfile()} />}
      {needsPasswordFinish(user, profile) && <SetPasswordForm />}

      <ReminderStatus state={device.state} zone={profile?.time_zone ?? null} />
      <RemindersSection {...section} device={device} onNotice={setNotice} />
      <MedicationsSection {...section} />
      <AboutSection />
      <AccountSection {...section} user={user} nickname={nickname} onNicknameChange={setNickname} />
      <DangerZone onError={setError} />
    </main>
  )
}
