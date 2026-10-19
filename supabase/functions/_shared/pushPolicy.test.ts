import { describe, expect, it } from 'vitest'
import { classifyPushStatus, isAllowedPushEndpoint } from './pushPolicy'

describe('isAllowedPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
    'https://web.push.apple.com/abc',
    'https://api.push.apple.com/3/device/abc',
  ])('allows %s', (u) => expect(isAllowedPushEndpoint(u)).toBe(true))

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://127.0.0.1/x',
    'https://localhost/x',
    'https://169.254.169.254/latest/meta-data',
    'https://evil.example.com/x',
    'https://fcm.googleapis.com.evil.com/x',
    'https://evilnotify.windows.com/x',
    'https://notify.windows.com.evil.com/x',
    'https://user@evil.com/x',
    'https://fcm.googleapis.com@evil.com/x',
    'ftp://fcm.googleapis.com/x',
    'not a url',
    '',
  ])('rejects %s', (u) => expect(isAllowedPushEndpoint(u)).toBe(false))
})

describe('classifyPushStatus', () => {
  it('2xx ok', () => {
    expect(classifyPushStatus(200)).toBe('ok')
    expect(classifyPushStatus(201)).toBe('ok')
    expect(classifyPushStatus(299)).toBe('ok')
  })
  it('404/410 gone', () => {
    expect(classifyPushStatus(404)).toBe('gone')
    expect(classifyPushStatus(410)).toBe('gone')
  })
  it('else error', () => {
    for (const s of [0, 301, 400, 401, 403, 413, 429, 500, 503]) expect(classifyPushStatus(s)).toBe('error')
  })
})
