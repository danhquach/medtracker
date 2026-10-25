import type { DoseStatus } from '../../lib/types'
import { LEGEND, STATUS } from './status'

export default function StatusIcon({ status }: { status: DoseStatus }) {
  const { Icon, label } = STATUS[status]
  return (
    <span role="img" aria-label={label} className={`status-icon dose-${status}`}>
      <Icon />
    </span>
  )
}

export function Legend() {
  return (
    <ul className="legend" aria-label="Legend">
      {LEGEND.map((s) => {
        const { Icon, label } = STATUS[s]
        return (
          <li key={s}>
            <span aria-hidden="true" className={`status-icon dose-${s}`}>
              <Icon />
            </span>
            {label}
          </li>
        )
      })}
    </ul>
  )
}
