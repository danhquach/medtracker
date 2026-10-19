// Push endpoint allowlist (SSRF guard) and response classification. Dependency-free.

const EXACT_HOSTS = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
])
const SUFFIX_HOSTS = ['.notify.windows.com', '.push.apple.com']

export function isAllowedPushEndpoint(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false
  const host = u.hostname.toLowerCase()
  return EXACT_HOSTS.has(host) || SUFFIX_HOSTS.some((s) => host.endsWith(s) && host.length > s.length)
}

export function classifyPushStatus(status: number): 'ok' | 'gone' | 'error' {
  if (status >= 200 && status < 300) return 'ok'
  if (status === 404 || status === 410) return 'gone'
  return 'error'
}
