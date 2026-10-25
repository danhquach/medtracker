import { listMeds, listSchedules } from '../../data/meds'
import type { Profile } from '../../lib/types'
import { canShareFile, shareFile } from '../../native/shareFile'
import { Button } from '../../components/Button'
import { Row, RowGroup } from '../../components/layout'
import { BOM, csvBlob, toCsv } from './exportCsv'
import { msg } from './msg'
import Saved, { type SaveSetting, type SettingKey } from './Saved'

const PLAN_FILE = 'medtracker-plan.csv'

export default function MedicationsSection({
  profile,
  saved,
  save,
  onError,
}: {
  profile: Profile | null
  saved: SettingKey | null
  save: SaveSetting
  onError: (error: string | null) => void
}) {
  async function exportPlan() {
    onError(null)
    try {
      const [meds, schedules] = await Promise.all([listMeds(), listSchedules()])
      const csv = toCsv(meds, schedules)
      if (canShareFile()) return await shareFile(PLAN_FILE, BOM + csv)
      const url = URL.createObjectURL(csvBlob(csv))
      const a = document.createElement('a')
      a.href = url
      a.download = PLAN_FILE
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoking in the same task can cancel the download in Safari and Firefox.
      setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (e) {
      onError(msg(e, 'Could not export'))
    }
  }

  return (
    <section className="settings-group" aria-labelledby="st-meds">
      <h3 id="st-meds">Medications</h3>
      <RowGroup>
        {profile && (
          <Row
            htmlFor="st-suggest"
            name={
              <>
                Medication name suggestions <Saved show={saved === 'suggestions_enabled'} />
              </>
            }
            desc="Suggests names from public drug databases as you type a new med."
          >
            <input
              id="st-suggest"
              type="checkbox"
              role="switch"
              aria-describedby="st-suggest-desc"
              checked={profile.suggestions_enabled}
              onChange={(e) => void save({ suggestions_enabled: e.target.checked })}
            />
          </Row>
        )}
        <Row desc="Download your meds and schedules as a spreadsheet file." wide>
          <Button onClick={() => void exportPlan()}>
            Export med plan (CSV)
          </Button>
        </Row>
      </RowGroup>
    </section>
  )
}
