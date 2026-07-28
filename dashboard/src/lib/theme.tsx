import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Mode = 'dark' | 'light'

/**
 * Colours that have to reach JavaScript rather than CSS — Recharts axis ticks,
 * SVG map fills and similar. Everything else themes through CSS custom
 * properties declared in index.css, so most components just use var(--token).
 */
export type Palette = {
  axis: string
  grid: string
  text: string
  muted: string
  tooltipBg: string
  tooltipBorder: string
  ocean: string
  land: string
  landStroke: string
  graticule: string
  pointStroke: string
  accent: string
  neutralBar: string
}

const DARK: Palette = {
  axis: '#94A3B8', grid: '#1E3A5F', text: '#FFFFFF', muted: '#94A3B8',
  tooltipBg: '#0B1830', tooltipBorder: '#2F5480',
  ocean: '#08172E', land: '#16283F', landStroke: '#28486E', graticule: '#123055',
  pointStroke: '#04101F', accent: '#00C2CB', neutralBar: '#1E4E6B',
}

const LIGHT: Palette = {
  axis: '#64748B', grid: '#CBD5E1', text: '#0F172A', muted: '#475569',
  tooltipBg: '#FFFFFF', tooltipBorder: '#94A3B8',
  ocean: '#DCE9F5', land: '#E9EEF3', landStroke: '#A9BDD1', graticule: '#C7D8E6',
  pointStroke: '#FFFFFF', accent: '#0E7C8B', neutralBar: '#7BA5C4',
}

type Ctx = { mode: Mode; palette: Palette; toggle: () => void; setMode: (m: Mode) => void }

const ThemeContext = createContext<Ctx>({
  mode: 'dark', palette: DARK, toggle: () => {}, setMode: () => {},
})

const KEY = 'liner-theme'

function initialMode(): Mode {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // localStorage unavailable (private mode / blocked) — fall through
  }
  try {
    if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light'
  } catch { /* no matchMedia */ }
  return 'dark'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(initialMode)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode)
    try { localStorage.setItem(KEY, mode) } catch { /* ignore */ }
  }, [mode])

  const value: Ctx = {
    mode,
    palette: mode === 'light' ? LIGHT : DARK,
    toggle: () => setMode(m => (m === 'dark' ? 'light' : 'dark')),
    setMode,
  }
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
