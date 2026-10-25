// The one button every screen uses (MT-88), so app-wide button behaviour is defined here once.
import type { ButtonHTMLAttributes, Ref } from 'react'

type Base = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-busy'> & {
  ref?: Ref<HTMLButtonElement>
  /** Disables the button and announces it as busy while an action runs. */
  busy?: boolean
}

export type ButtonProps =
  | (Base & { variant?: 'default' | 'primary' | 'quiet' | 'link' | 'danger' | 'fab' })
  // An icon has no visible text, so it must name itself.
  | (Base & { variant: 'icon'; 'aria-label': string })

const CLASS = {
  default: '',
  primary: 'primary',
  quiet: 'quiet',
  link: 'link',
  danger: 'danger',
  icon: 'icon-button',
  fab: 'primary fab',
}

export function Button({ variant = 'default', busy, type = 'button', className, disabled, ...rest }: ButtonProps) {
  const cls = [CLASS[variant], className].filter(Boolean).join(' ') || undefined
  return <button type={type} className={cls} disabled={disabled || busy} aria-busy={busy || undefined} {...rest} />
}
