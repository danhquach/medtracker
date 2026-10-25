import { useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { TextField } from '../../components/Field'
import { numberFromPaste } from '../dinLookup/candidates'
import { PRODUCT_DATA } from '../dinLookup/dataVersion'
import { lookupProduct } from '../dinLookup/lookup'
import type { Product } from '../dinLookup/types'
import { useProductLists } from '../dinLookup/useProductLists'

const digitsOnly = (text: string) => text.replace(/\D/g, '').slice(0, 8)

/** Add Med's "DIN or NPN" row: 8 digits look up the exact product in the bundled lists. */
export default function DinNpnField({
  value,
  onChange,
  onMatch,
}: {
  value: string
  onChange: (digits: string) => void
  onMatch: (p: Product, viaScan: boolean) => void
}) {
  const { ensure } = useProductLists()
  const [message, setMessage] = useState('')
  const [choices, setChoices] = useState<Product[]>([])
  // The number now in the field, so a lookup that finishes after it changed is dropped.
  const latest = useRef(value)

  // The one lookup path; a label scan (MT-105) calls it too.
  async function runLookup(digits: string, viaScan: boolean) {
    const result = lookupProduct(digits, await ensure(), PRODUCT_DATA.lists)
    if (latest.current !== digits) return
    if (result.status === 'match') {
      if (result.products.length === 1) onMatch(result.products[0], viaScan)
      else setChoices(result.products)
    } else if (result.status === 'none') setMessage(`No product found for ${digits}. Check the number or add by name.`)
    else if (result.status === 'unavailable') setMessage("Product data hasn't downloaded yet. Connect once to enable lookup.")
    else setMessage("NPN lookup isn't available yet. Add by name for now.")
  }

  function set(digits: string) {
    latest.current = digits
    setMessage('')
    setChoices([])
    onChange(digits)
    if (digits.length === 8) void runLookup(digits, false)
  }

  return (
    <>
      <div className="din-npn">
        <TextField
          label="DIN or NPN (on the label)"
          value={value}
          inputMode="numeric"
          autoComplete="off"
          // No maxLength: it would cut a paste before the number is picked out of it.
          onChange={(e) => set(digitsOnly(e.target.value))}
          onPaste={(e) => {
            e.preventDefault()
            set(numberFromPaste(e.clipboardData.getData('text')))
          }}
          onFocus={() => void ensure()}
        />
        {choices.length > 0 && (
          <div className="row" role="group" aria-label="Matching products">
            {choices.map((p) => (
              <Button
                key={p.kind}
                onClick={() => {
                  setChoices([])
                  onMatch(p, false)
                }}
              >
                {p.kind} · {p.name}
              </Button>
            ))}
          </div>
        )}
        {/* Always in the page so screen readers announce the message when it appears. */}
        <p role="status" className="muted hint">
          {message}
        </p>
      </div>
      <p className="divider-text">or search by name</p>
    </>
  )
}
