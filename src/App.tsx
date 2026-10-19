import { useEffect, useState } from 'react'
import { Link, matchPath, Navigate, NavLink, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
import { BackIcon, CalendarIcon, HistoryIcon, PillIcon, SettingsIcon } from './components/icons'
import { Loading } from './components/states'
import { bootSession } from './data/boot'
import Welcome from './features/auth/Welcome'
import { useSession } from './features/auth/useSession'
import History from './features/history/History'
import MedsList from './features/meds/MedsList'
import Settings from './features/settings/Settings'
import Today from './features/today/Today'
import { dayParam, dayTitle } from './features/today/dayRange'
import { useGoBack } from './lib/useGoBack'
import './theme.css'

function useBoot(userId: string | undefined): boolean {
  const [readyFor, setReadyFor] = useState<string | null>(null)
  useEffect(() => {
    if (!userId) return
    let alive = true
    void bootSession().finally(() => alive && setReadyFor(userId))
    return () => {
      alive = false
    }
  }, [userId])
  return !!userId && readyFor === userId
}

// First match wins. `back` marks a sub-screen: the header shows a back arrow to that parent.
const SCREENS: { path: string; title: string; back?: string }[] = [
  { path: '/today', title: 'Today' },
  { path: '/meds', title: 'Meds' },
  { path: '/meds/new', title: 'Add med', back: '/meds' },
  { path: '/meds/:id/edit', title: 'Edit med', back: '/meds' },
  { path: '/history', title: 'History' },
  { path: '/history/:medId', title: 'Med history', back: '/history' },
  { path: '/settings', title: 'Settings', back: '/today' },
]

function AppHeader() {
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const screen = SCREENS.find((s) => matchPath(s.path, pathname))
  const day = screen?.path === '/today' ? dayParam(params.get('date')) : null
  const goBack = useGoBack(screen?.back ?? '/today')
  return (
    <header className="app-header">
      {screen?.back && (
        <button type="button" className="icon-button" aria-label="Back" onClick={goBack}>
          <BackIcon />
        </button>
      )}
      <h1>{day ? dayTitle(day) : (screen?.title ?? 'MedTracker')}</h1>
      {screen?.path !== '/settings' && (
        <Link to="/settings" className="icon-button" aria-label="Settings">
          <SettingsIcon />
        </Link>
      )}
    </header>
  )
}

export default function App() {
  const { loading, user } = useSession()
  const ready = useBoot(user?.id)

  if (loading)
    return (
      <main>
        <Loading />
      </main>
    )
  if (!user) return <Welcome />

  return (
    <>
      <AppHeader />
      {ready ? (
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/today" element={<Today />} />
          <Route path="/meds" element={<MedsList />} />
          <Route path="/meds/new" element={<MedsList />} />
          <Route path="/meds/:id/edit" element={<MedsList />} />
          <Route path="/history" element={<History />} />
          <Route path="/history/:medId" element={<History />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
      ) : (
        <main>
          <Loading />
        </main>
      )}
      <nav className="tab-bar" aria-label="Main">
        <NavLink to="/today">
          <CalendarIcon />
          Today
        </NavLink>
        <NavLink to="/meds">
          <PillIcon />
          Meds
        </NavLink>
        <NavLink to="/history">
          <HistoryIcon />
          History
        </NavLink>
      </nav>
    </>
  )
}
