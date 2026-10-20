function offsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(utcMs))
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - Math.floor(utcMs / 1000) * 1000
}

function localMidnightUtc(date: string, tz: string): number {
  return localWallTimeUtc(date, '00:00', tz)
}

/**
 * UTC ms of a local wall-clock time ('HH:MM[:SS]') on a local date in tz, exactly as SQL
 * `(date + time) at time zone tz` (see 0013): a time skipped by a spring-forward gap moves forward
 * by the gap; a time repeated by a fall-back fold is the later one. Both are the later candidate.
 */
export function localWallTimeUtc(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi, sec = 0] = time.split(':').map(Number)
  const wall = Date.UTC(y, m - 1, d, h, mi, sec)
  // Candidates from the offsets in force a day either side; a real one maps back to the same wall time.
  const candidates = [wall - 86_400_000, wall + 86_400_000].map((t) => wall - offsetMs(t, tz))
  const real = candidates.filter((c) => wall - offsetMs(c, tz) === c)
  return Math.max(...(real.length ? real : candidates))
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** ISO UTC range [from, to) covering the given local calendar day in tz. */
export function localDayRange(date: string, tz: string): { from: string; to: string } {
  return {
    from: new Date(localMidnightUtc(date, tz)).toISOString(),
    to: new Date(localMidnightUtc(addDays(date, 1), tz)).toISOString(),
  }
}

/** Today's YYYY-MM-DD in tz. */
export function todayIn(tz: string, now: number = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(now),
  )
}

/** The current 'HH:MM' (24h) in tz. */
export function nowTimeIn(tz: string, now: number = Date.now()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(now),
  )
}

/** 7 days centred on `centre`. */
export function weekAround(centre: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(centre, i - 3))
}

export function timeLabel(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

/** The `?date=` a non-today view carries, when it is a real YYYY-MM-DD; otherwise null (today). */
export function dayParam(raw: string | null): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  return addDays(raw, 0) === raw ? raw : null
}

const titleFormat = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

/** Header title for a picked day, e.g. "Tue, Oct 20". */
export function dayTitle(date: string): string {
  return titleFormat.format(new Date(`${date}T12:00:00Z`))
}
