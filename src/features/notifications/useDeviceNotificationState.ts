import { useCallback, useEffect, useState } from 'react'
import { getDeviceState, type DeviceState } from '../../push/subscribe'

export type DeviceNotificationState = DeviceState

export function useDeviceNotificationState(): { state: DeviceNotificationState | null; refresh: () => void } {
  const [state, setState] = useState<DeviceNotificationState | null>(null)
  const refresh = useCallback(() => {
    void getDeviceState().then(setState, () => setState('off'))
  }, [])
  useEffect(refresh, [refresh])
  return { state, refresh }
}
