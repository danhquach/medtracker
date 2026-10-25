import { useRef, useState, type ReactNode } from 'react'
import { Button } from '../../components/Button'
import { TextField } from '../../components/Field'
import { numberFromPaste } from '../dinLookup/candidates'
import { PRODUCT_DATA } from '../dinLookup/dataVersion'
import { lookupProduct } from '../dinLookup/lookup'
import type { Product } from '../dinLookup/types'
import { useProductLists } from '../dinLookup/useProductLists'
import { canScanLabel, scanLabel } from '../../native/labelScan'

const digitsOnly = (text: string) => text.replace(/\D/g, '').slice(0, 8)
// "80012345" → "8001 2345", easier to compare with the label.
const spaced = (n: string) => `${n.slice(0, 4)} ${n.slice(4)}`

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
  const [message, setMessage] = useState<ReactNode>('')
  const [choices, setChoices] = useState<Product[]>([])
  // Numbers read from a label photo, waiting for the user to confirm one.
  const [scanned, setScanned] = useState<string[] | null>(null)
  const [scanning, setScanning] = useState(false)
  // The number now in the field, so a lookup that finishes after it changed is dropped.
  const latest = useRef(value)
  // Whether the number in the field came from the camera, for a product picked from several.
  const viaScan = useRef(false)

  // The one lookup path; a label scan (MT-105) calls it too.
  async function runLookup(digits: string, viaScan: boolean) {
    const result = lookupProduct(digits, await ensure(), PRODUCT_DATA.lists)
    if (latest.current !== digits) return
    if (result.status === 'match') {
      if (result.products.length === 1) onMatch(result.products[0], viaScan)
      else {
        setChoices(result.products)
        setMessage(`${result.products.length} products have this number. Pick the one on your label.`)
      }
    } else if (result.status === 'none') setMessage(`No product found for ${digits}. Check the number or add by name.`)
    else if (result.status === 'unavailable') setMessage("Product data hasn't downloaded yet. Connect once to enable lookup.")
    else setMessage("NPN lookup isn't available yet. Add by name for now.")
  }

  function set(digits: string, scan = false) {
    latest.current = digits
    viaScan.current = scan
    setMessage('')
    setChoices([])
    setScanned(null)
    onChange(digits)
    if (digits.length === 8) void runLookup(digits, scan)
  }

  async function scan() {
    setScanning(true)
    const numbers = await scanLabel()
    setScanning(false)
    if (numbers === 'cancelled') return
    setChoices([])
    if (numbers === 'no-camera') {
      setScanned(null)
      setMessage("Couldn't open the camera. Type the number instead.")
      return
    }
    setScanned(numbers)
    if (numbers.length === 0) setMessage("Couldn't find an 8-digit DIN/NPN in the photo.")
    else if (numbers.length === 1)
      setMessage(
        <>
          Read: <span className="label-number">{spaced(numbers[0])}</span>.{' '}
          <span className="scan-question">Does this match the label?</span>
        </>,
      )
    else setMessage('Which number is on the label next to DIN/NPN?')
  }

  return (
    <>
      <div className="din-npn">
        <div className="din-npn-input">
          <TextField
            label="DIN or NPN (on the label)"
            value={value}
            inputMode="numeric"
            autoComplete="off"
            // No maxLength: it would cut a paste before the number is picked out of it.
            onChange={(e) => set(digitsOnly(e.target.value))}
            // A paste holding an 8-digit number replaces the field with it; any other paste lands
            // where the caret is, and typing's digits-only rule applies.
            onPaste={(e) => {
              const digits = numberFromPaste(e.clipboardData.getData('text'))
              if (!digits) return
              e.preventDefault()
              set(digits)
            }}
            onFocus={() => void ensure()}
          />
          {canScanLabel() && (
            <Button busy={scanning} onClick={() => void scan()}>
              📷 Scan
            </Button>
          )}
        </div>
        {scanned && (
          <div className="row" role="group" aria-label="Number from the photo">
            {scanned.length === 1 && (
              <Button variant="primary" onClick={() => set(scanned[0], true)}>
                Use
              </Button>
            )}
            {scanned.length > 1 &&
              scanned.map((n) => (
                <Button key={n} onClick={() => set(n, true)}>
                  {spaced(n)}
                </Button>
              ))}
            <Button busy={scanning} onClick={() => void scan()}>
              Retake
            </Button>
          </div>
        )}
        {choices.length > 0 && (
          <div className="row" role="group" aria-label="Matching products">
            {choices.map((p) => (
              <Button
                key={p.kind}
                onClick={() => {
                  setChoices([])
                  setMessage('')
                  onMatch(p, viaScan.current)
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
