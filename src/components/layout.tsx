// Shared layout pieces (MT-90): every screen builds its cards, rows, chips and notices from these, so their look is defined once.
import type { ElementType, HTMLAttributes, ReactNode } from 'react'

type BoxProps = HTMLAttributes<HTMLElement> & { as?: ElementType }

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ')

/** A raised box for one item in a list, e.g. a dose on Today or a med on Meds. */
export function Card({ as: Tag = 'li', className, ...rest }: BoxProps) {
  return <Tag className={cx('card', className)} {...rest} />
}

/** Rows grouped in one rounded box, divided by lines, like a phone's settings screen. */
export function RowGroup({ as: Tag = 'div', className, ...rest }: BoxProps) {
  return <Tag className={cx('row-group', className)} {...rest} />
}

/** One row: name and plain-language description on the left, the control on the right (or below, when wide). */
export function Row({
  as: Tag = 'div',
  htmlFor,
  name,
  desc,
  wide,
  children,
}: {
  as?: ElementType
  /** The control's id: the name becomes its label and the description is `${htmlFor}-desc`. */
  htmlFor?: string
  name?: ReactNode
  desc?: ReactNode
  wide?: boolean
  children?: ReactNode
}) {
  return (
    <Tag className={cx('list-row', wide && 'wide')}>
      {(name || desc) && (
        <div className="list-row-text">
          {name &&
            (htmlFor ? (
              <label className="list-row-name" htmlFor={htmlFor}>
                {name}
              </label>
            ) : (
              <p className="list-row-name">{name}</p>
            ))}
          {desc && (
            <p id={htmlFor ? `${htmlFor}-desc` : undefined} className="list-row-desc">
              {desc}
            </p>
          )}
        </div>
      )}
      {children}
    </Tag>
  )
}

/** A small rounded label, e.g. "Paused" or "12 tablets left". */
export function Chip({ tone, inline, children }: { tone?: 'low'; inline?: boolean; children: ReactNode }) {
  return <span className={cx('chip', tone === 'low' && 'chip-low', inline && 'chip-inline')}>{children}</span>
}

/**
 * A message about the whole screen or form: info is announced politely, an error interrupts.
 * Render it even while empty when the next message must be announced (it collapses when empty).
 */
export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error'; children?: ReactNode }) {
  return tone === 'error' ? (
    <p role="alert" className="notice notice-error">
      {children}
    </p>
  ) : (
    <p role="status" className="notice">
      {children}
    </p>
  )
}
