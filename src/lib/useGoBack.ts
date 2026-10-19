import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * Back within the app when there is an in-app entry to return to; otherwise (deep link, reload)
 * replace the current entry with `fallback`, so Back never leaves the app or loops on a form.
 */
export function useGoBack(fallback: string): () => void {
  const navigate = useNavigate()
  const location = useLocation()
  return useCallback(() => {
    if (location.key !== 'default') navigate(-1)
    else navigate(fallback, { replace: true })
  }, [navigate, location.key, fallback])
}
