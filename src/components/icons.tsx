// Outline icons (24px grid, currentColor). Decorative: always paired with a text label or aria-label.
const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)

export const CalendarIcon = () => <Icon d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM16 3v4M8 3v4M4 11h16" />
export const PillIcon = () => <Icon d="M4.5 12.5l8-8a4.95 4.95 0 0 1 7 7l-8 8a4.95 4.95 0 0 1-7-7M8.5 8.5l7 7" />
export const HistoryIcon = () => <Icon d="M12 8v4l2 2M3.05 11a9 9 0 1 1 .5 4M3 20v-5h5" />
export const SettingsIcon = () => (
  <Icon d="M10.33 4.32c.43-1.76 2.92-1.76 3.35 0a1.72 1.72 0 0 0 2.57 1.06c1.54-.94 3.3.82 2.37 2.37a1.72 1.72 0 0 0 1.06 2.57c1.76.43 1.76 2.93 0 3.35a1.72 1.72 0 0 0-1.06 2.57c.94 1.54-.83 3.3-2.37 2.37a1.72 1.72 0 0 0-2.57 1.06c-.43 1.76-2.93 1.76-3.35 0a1.72 1.72 0 0 0-2.57-1.06c-1.54.94-3.3-.83-2.37-2.37a1.72 1.72 0 0 0-1.06-2.57c-1.76-.43-1.76-2.93 0-3.35a1.72 1.72 0 0 0 1.06-2.57c-.94-1.54.83-3.3 2.37-2.37 1 .61 2.3.07 2.57-1.06M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0" />
)
export const BackIcon = () => <Icon d="M5 12h14M5 12l6 6M5 12l6-6" />
