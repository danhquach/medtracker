import type { Medication, Schedule } from '../../lib/types'
import { scheduleSummary } from '../meds/summary'

const HEADER = ['name', 'strength', 'form', 'schedule', 'units_per_dose', 'stock', 'notes']

/** RFC 4180 quoting, plus a leading ' on cells a spreadsheet would read as a formula (even after leading whitespace). */
function cell(value: string | number | null): string {
  let s = value === null ? '' : String(value)
  if (/^[\t\r]|^\s*[=+\-@]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(meds: Medication[], schedules: Schedule[]): string {
  const rows = meds.map((m) =>
    [
      m.name,
      m.strength,
      m.form,
      scheduleSummary(schedules.filter((s) => s.medication_id === m.id)),
      m.units_per_dose,
      m.stock,
      m.notes,
    ]
      .map(cell)
      .join(','),
  )
  return [HEADER.join(','), ...rows].join('\r\n')
}

/** UTF-8 BOM so Excel reads accented names correctly. */
export const BOM = '\uFEFF'

export function csvBlob(csv: string): Blob {
  return new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' })
}
