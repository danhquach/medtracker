import type { User } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../data/profile', () => ({ updateProfile: vi.fn() }))

import { isGuest, needsPasswordFinish } from './auth'

const user = (extra: Partial<User> = {}) =>
  ({ id: 'u1', is_anonymous: false, email_confirmed_at: '2026-10-19T00:00:00Z', ...extra }) as User

describe('needsPasswordFinish', () => {
  it('confirmed email, not guest, password_set false → true', () => {
    expect(needsPasswordFinish(user(), { password_set: false })).toBe(true)
  })
  it('password_set true → false', () => {
    expect(needsPasswordFinish(user(), { password_set: true })).toBe(false)
  })
  it('anonymous → false', () => {
    expect(needsPasswordFinish(user({ is_anonymous: true }), { password_set: false })).toBe(false)
  })
  it('unconfirmed email → false', () => {
    expect(needsPasswordFinish(user({ email_confirmed_at: undefined }), { password_set: false })).toBe(false)
  })
  it('signUp metadata flag → false', () => {
    expect(needsPasswordFinish(user({ user_metadata: { password_set: true } }), { password_set: false })).toBe(false)
  })
  it('no profile yet → false', () => {
    expect(needsPasswordFinish(user(), null)).toBe(false)
  })
})

describe('isGuest', () => {
  it('reflects is_anonymous', () => {
    expect(isGuest(user({ is_anonymous: true }))).toBe(true)
    expect(isGuest(user())).toBe(false)
    expect(isGuest(null)).toBe(false)
  })
})
