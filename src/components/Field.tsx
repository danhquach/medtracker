import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'

type FieldProps = {
  label: ReactNode
  /** Always-visible guidance, e.g. a password rule. */
  hint?: ReactNode
  /** Shown under the control, which is then marked invalid and points at it. */
  error?: string
}

/** Error shown right under the control it belongs to; the control points at it via aria-describedby. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="field-error">
      {message}
    </p>
  )
}

/** One field: the label wraps the control; hint and error sit below it and are announced with it. */
function Field({ label, hint, error, control }: FieldProps & { control: (a11y: object) => ReactNode }) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ')
  return (
    <div className="field">
      <label>
        {label}
        {control({ 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy || undefined })}
      </label>
      {hint && (
        <p id={hintId} className="muted hint">
          {hint}
        </p>
      )}
      <FieldError id={errorId} message={error} />
    </div>
  )
}

type InputFieldProps = FieldProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'aria-invalid' | 'aria-describedby'>

export const TextField = ({ label, hint, error, ...input }: InputFieldProps) => (
  <Field label={label} hint={hint} error={error} control={(a11y) => <input {...input} {...a11y} />} />
)

export const NumberField = (props: InputFieldProps) => <TextField type="number" inputMode="decimal" step="any" {...props} />

export const TimeField = (props: InputFieldProps) => <TextField type="time" {...props} />

export const DateField = (props: InputFieldProps) => <TextField type="date" {...props} />

export const SelectField = ({
  label,
  hint,
  error,
  ...select
}: FieldProps & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'aria-invalid' | 'aria-describedby'>) => (
  <Field label={label} hint={hint} error={error} control={(a11y) => <select {...select} {...a11y} />} />
)
