import { generateDoses } from './doses'
import { forgetOtherUsers } from './offline/sync'
import { detectTimeZone, touchLastSeen } from './profile'

/** Runs once per app load for a signed-in user. Failures must not block the UI. */
export async function bootSession(): Promise<void> {
  const steps = [forgetOtherUsers, touchLastSeen, generateDoses, detectTimeZone]
  for (const step of steps) {
    try {
      await step()
    } catch (e) {
      console.error('boot step failed', e)
    }
  }
}
