import type { ProfilePatch } from '../../data/profile'

export type SettingKey = keyof ProfilePatch

/** Saves a profile change; a section shows "Saved" next to the setting it changed. */
export type SaveSetting = (patch: ProfilePatch) => Promise<void>

export default function Saved({ show }: { show: boolean }) {
  return (
    <span className="saved" role="status">
      {show ? 'Saved' : ''}
    </span>
  )
}
