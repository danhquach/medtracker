// Android app slow presses (MT-96): the WebView treats a press held past the long-press delay as a long
// press and sends no click on release, so the button or link does nothing. Each touch press tells the
// app shell whether it started on a control, so the shell can swallow the long press there (no link
// tooltip) while plain text keeps it for selection. One capture listener then clicks the control when
// the press ends on it and no click followed, so new buttons get it too. The web/PWA build keeps the
// browser's own long-press behaviour.
import { Capacitor } from '@capacitor/core'

declare global {
  interface Window {
    /** Added by the app shell (MainActivity); missing on APKs built before MT-96. */
    MedTrackerPress?: { start(onControl: boolean): void }
  }
}

const CONTROL = 'button, a[href]'
/** A normal tap's click lands right after pointerup; wait this long before treating the press as slow. */
export const CLICK_WAIT_MS = 100

/** Returns a stop function. Disabled buttons ignore click(), so they stay inert. */
export function startSlowPress(): () => void {
  if (!Capacitor.isNativePlatform()) return () => {}
  let pressed: Element | null = null
  let clicked = false
  const onDown = (e: PointerEvent) => {
    pressed = e.pointerType === 'touch' && e.target instanceof Element ? e.target.closest(CONTROL) : null
    clicked = false
    window.MedTrackerPress?.start(pressed !== null)
  }
  const onCancel = () => {
    pressed = null
  }
  const onClick = () => {
    clicked = true
  }
  const onUp = (e: PointerEvent) => {
    const control = pressed
    pressed = null
    if (!control || e.pointerType !== 'touch') return
    // Released somewhere else: the finger slid off the control, so it's not a press of it.
    if (!control.contains(document.elementFromPoint(e.clientX, e.clientY))) return
    setTimeout(() => {
      if (!clicked && control.isConnected) (control as HTMLElement).click()
    }, CLICK_WAIT_MS)
  }
  document.addEventListener('pointerdown', onDown, true)
  document.addEventListener('pointercancel', onCancel, true)
  document.addEventListener('pointerup', onUp, true)
  document.addEventListener('click', onClick, true)
  return () => {
    document.removeEventListener('pointerdown', onDown, true)
    document.removeEventListener('pointercancel', onCancel, true)
    document.removeEventListener('pointerup', onUp, true)
    document.removeEventListener('click', onClick, true)
  }
}
