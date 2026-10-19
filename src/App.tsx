import { useEffect, useState } from 'react'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { bootSession } from './data/boot'
import Welcome from './features/auth/Welcome'
import { useSession } from './features/auth/useSession'
import History from './features/history/History'
import MedsList from './features/meds/MedsList'
import Settings from './features/settings/Settings'
import Today from './features/today/Today'
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

export default function App() {
  const { loading, user } = useSession()
  const ready = useBoot(user?.id)

  if (loading) return <main aria-busy="true" />
  if (!user) return <Welcome />

  return (
    <>
      <header className="app-header">
        <h1>MedTracker</h1>
        <NavLink to="/settings" aria-label="Settings">
          ⚙
        </NavLink>
      </header>
      {ready ? (
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/today" element={<Today />} />
          <Route path="/meds" element={<MedsList />} />
          <Route path="/history" element={<History />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      ) : (
        <main aria-busy="true" />
      )}
      <nav className="tab-bar">
        <NavLink to="/today">Today</NavLink>
        <NavLink to="/meds">Meds</NavLink>
        <NavLink to="/history">History</NavLink>
      </nav>
    </>
  )
}
