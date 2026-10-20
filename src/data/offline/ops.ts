import type { MedInput, ScheduleInput } from '../meds'
import type { ProfilePatch } from '../profile'

/** One user action, queued until the server has it. `at` = when the user acted; `opId` makes replays safe. */
export type Op = { opId: string; at: string } & (
  | { kind: 'doseStatus'; medId: string; scheduledFor: string; status: 'taken' | 'skipped' | 'pending' }
  | { kind: 'prn'; medId: string; doseId: string }
  | { kind: 'saveMed'; create: boolean; med: MedInput & { id: string }; schedules: ScheduleInput[] }
  | { kind: 'deleteMed'; medId: string }
  | { kind: 'setPaused'; medId: string; paused: boolean }
  | { kind: 'addStock'; medId: string; qty: number }
  | { kind: 'updateProfile'; patch: ProfilePatch }
)
