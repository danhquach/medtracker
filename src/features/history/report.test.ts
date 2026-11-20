import { describe, expect, it } from 'vitest'
import type { DoseEvent, DoseStatus, Medication } from '../../lib/types'
import { monthReport, reportText, takenPct } from './report'

const TZ = 'America/Toronto'
const med = (id: string, name: string, paused = false) => ({ id, name, paused }) as Medication
const dose = (medication_id: string, scheduled_for: string, status: DoseStatus) =>
  ({ id: `${medication_id}-${scheduled_for}`, medication_id, scheduled_for, status }) as DoseEvent
const meds = [med('a', 'Aspirin'), med('p', 'Paused med', true)]

describe('monthReport', () => {
  it('counts a past month by med and in total, past pending as Missed', () => {
    const r = monthReport(
      [
        dose('a', '2026-09-01T13:00:00Z', 'taken'),
        dose('a', '2026-09-02T13:00:00Z', 'skipped'),
        dose('a', '2026-09-03T13:00:00Z', 'pending'),
        dose('p', '2026-09-04T13:00:00Z', 'taken'),
      ],
      meds,
      '2026-09',
      TZ,
      '2026-10-19',
    )!
    expect(r.through).toBeNull()
    expect(r.total).toEqual({ scheduled: 4, taken: 2, skipped: 1, missed: 1, pending: 0 })
    expect(r.perMed.map((m) => [m.med.name, m.counts.scheduled, m.counts.missed])).toEqual([
      ['Aspirin', 3, 1],
      ['Paused med', 1, 0],
    ])
    expect(takenPct(r.total)).toBe(50)
  })

  it('places doses by local day at both month edges', () => {
    const r = monthReport(
      [
        dose('a', '2026-09-01T03:00:00Z', 'taken'), // Aug 31, 23:00 Toronto
        dose('a', '2026-10-01T02:00:00Z', 'taken'), // Sep 30, 22:00 Toronto
      ],
      meds,
      '2026-09',
      TZ,
      '2026-10-19',
    )!
    expect(r.total.scheduled).toBe(1)
  })

  it('runs the current month through today; today’s pending stays out of Taken %', () => {
    const r = monthReport(
      [
        dose('a', '2026-10-18T13:00:00Z', 'taken'),
        dose('a', '2026-10-19T13:00:00Z', 'pending'),
        dose('a', '2026-10-20T13:00:00Z', 'pending'), // tomorrow
      ],
      meds,
      '2026-10',
      TZ,
      '2026-10-19',
    )!
    expect(r.through).toBe('2026-10-19')
    expect(r.total).toEqual({ scheduled: 2, taken: 1, skipped: 0, missed: 0, pending: 1 })
    expect(takenPct(r.total)).toBe(100)
  })

  it('leaves out meds with no doses that month and doses of unknown (deleted) meds', () => {
    const r = monthReport(
      [dose('a', '2026-09-01T13:00:00Z', 'taken'), dose('gone', '2026-09-01T13:00:00Z', 'missed')],
      meds,
      '2026-09',
      TZ,
      '2026-10-19',
    )!
    expect(r.perMed.map((m) => m.med.name)).toEqual(['Aspirin'])
    expect(r.total.scheduled).toBe(1)
  })

  it('is null for a month with no dose records', () => {
    expect(monthReport([dose('a', '2026-10-01T13:00:00Z', 'taken')], meds, '2026-09', TZ, '2026-10-19')).toBeNull()
  })

  it('has no Taken % when nothing is due yet', () => {
    expect(takenPct({ scheduled: 1, taken: 0, skipped: 0, missed: 0, pending: 1 })).toBeNull()
  })
})

describe('reportText', () => {
  it('reads as plain lines for the share sheet', () => {
    const r = monthReport(
      [
        dose('a', '2026-10-18T13:00:00Z', 'taken'),
        dose('a', '2026-10-17T13:00:00Z', 'missed'),
        dose('a', '2026-10-19T13:00:00Z', 'pending'),
        dose('p', '2026-10-02T13:00:00Z', 'skipped'),
      ],
      meds,
      '2026-10',
      TZ,
      '2026-10-19',
    )!
    expect(reportText(r)).toBe(
      [
        'MedTracker dose report: October 2026',
        'Month to date, through Mon, Oct 19',
        '',
        'All meds: 4 scheduled, 1 taken, 1 skipped, 1 missed, 1 pending, 33% taken',
        'Aspirin: 3 scheduled, 1 taken, 0 skipped, 1 missed, 1 pending, 50% taken',
        'Paused med (paused): 1 scheduled, 0 taken, 1 skipped, 0 missed, 0% taken',
        '',
      ].join('\n'),
    )
  })
})
