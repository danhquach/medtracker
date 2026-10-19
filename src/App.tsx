import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import './theme.css'

const Page = ({ title }: { title: string }) => (
  <main>
    <h2>{title}</h2>
  </main>
)

export default function App() {
  return (
    <>
      <header className="app-header">
        <h1>MedTracker</h1>
        <NavLink to="/settings" aria-label="Settings">
          ⚙
        </NavLink>
      </header>
      <Routes>
        <Route path="/" element={<Navigate to="/today" replace />} />
        <Route path="/today" element={<Page title="Today" />} />
        <Route path="/meds" element={<Page title="Meds" />} />
        <Route path="/history" element={<Page title="History" />} />
        <Route path="/settings" element={<Page title="Settings" />} />
      </Routes>
      <nav className="tab-bar">
        <NavLink to="/today">Today</NavLink>
        <NavLink to="/meds">Meds</NavLink>
        <NavLink to="/history">History</NavLink>
      </nav>
    </>
  )
}
