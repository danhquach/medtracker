import type { User } from '@supabase/supabase-js'
import { useSearchParams } from 'react-router-dom'
import type { Profile } from '../../lib/types'
import { useGoBack } from '../../lib/useGoBack'
import { unsyncedWarning } from '../../components/syncCopy'
import { Button } from '../../components/Button'
import { TextField } from '../../components/Field'
import { Row, RowGroup } from '../../components/layout'
import { useConfirm } from '../../components/useConfirm'
import { isGuest, signOut, unsyncedBeforeSignOut } from '../auth/auth'
import CredentialsForm from '../auth/CredentialsForm'
import { msg } from './msg'
import Saved, { type SaveSetting, type SettingKey } from './Saved'

export default function AccountSection({
  user,
  profile,
  nickname,
  onNicknameChange,
  saved,
  save,
  onError,
}: {
  user: User | null
  profile: Profile | null
  /** Owned by Settings: a fresh profile load resets it, a save does not. */
  nickname: string
  onNicknameChange: (nickname: string) => void
  saved: SettingKey | null
  save: SaveSetting
  onError: (error: string | null) => void
}) {
  // A URL param, not state, so the phone's Back button closes the form instead of leaving Settings.
  const [params, setParams] = useSearchParams()
  const account = params.get('account')
  const guestView = account === 'signin' || account === 'create' ? account : 'menu'
  const closeGuestForm = useGoBack('/settings')
  const setGuestView = (v: 'menu' | 'signin' | 'create') => (v === 'menu' ? closeGuestForm() : setParams({ account: v }))
  const [confirm, confirmDialog] = useConfirm()

  async function doSignOut() {
    onError(null)
    try {
      const unsynced = await unsyncedBeforeSignOut()
      if (unsynced > 0 && !(await confirm({ title: 'Sign out?', message: unsyncedWarning(unsynced), confirmLabel: 'Sign out', danger: true })))
        return
      await signOut()
    } catch (e) {
      onError(msg(e, 'Could not sign out'))
    }
  }

  function saveNickname() {
    const next = nickname.trim() || null
    if (profile && next !== (profile.nickname ?? null)) void save({ nickname: next })
  }

  const guest = isGuest(user)

  return (
    <section className="settings-group" aria-labelledby="st-account">
      <h3 id="st-account">Account</h3>
      <RowGroup>
        <Row name={guest ? 'Guest' : (user?.email ?? '')} desc={guest ? undefined : 'Signed in'}>
          {!guest && (
            <Button onClick={() => void doSignOut()}>
              Sign out
            </Button>
          )}
        </Row>
        {guest &&
          (guestView === 'menu' ? (
            <Row wide desc="Your data is only on this device. Create a profile to secure it and use it on other devices.">
              <div className="row">
                <Button variant="primary" onClick={() => setGuestView('create')}>
                  Create profile
                </Button>
                <Button onClick={() => setGuestView('signin')}>
                  Sign in
                </Button>
              </div>
            </Row>
          ) : (
            <Row wide>
              <CredentialsForm
                mode={guestView === 'create' ? 'upgrade' : 'signin'}
                guest={guestView === 'signin'}
                onCancel={() => setGuestView('menu')}
              />
            </Row>
          ))}
        {profile && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              saveNickname()
            }}
          >
            <Row wide>
              <TextField
                label={
                  <>
                    Nickname <Saved show={saved === 'nickname'} />
                  </>
                }
                value={nickname}
                maxLength={40}
                onChange={(e) => onNicknameChange(e.target.value)}
                onBlur={saveNickname}
              />
            </Row>
          </form>
        )}
      </RowGroup>
      {confirmDialog}
    </section>
  )
}
