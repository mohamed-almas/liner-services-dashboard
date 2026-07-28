import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'

const NAV = [
  { to: '/global',            icon: '🌍', label: 'Global Overview' },
  { to: '/port-trend',        icon: '📊', label: 'Port Trend' },
  { to: '/port-snapshot',     icon: '📍', label: 'Port Snapshot' },
  { to: '/port-connectivity', icon: '🔄', label: 'Port Connectivity' },
  { to: '/country',           icon: '🏳️', label: 'Country' },
  { to: '/coastal-region',    icon: '🌊', label: 'Coastal Region' },
  { to: '/trade-route',       icon: '🛣️', label: 'Trade Route' },
  { to: '/liners',            icon: '🚢', label: 'Liners' },
  { to: '/service',           icon: '⚓', label: 'Service' },
  { to: '/service-evolution', icon: '📈', label: 'Service Evolution' },
]

export default function Layout() {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex w-full min-h-screen">
      {/* Mobile backdrop */}
      {open && (
        <div className="fixed inset-0 bg-black/60 z-20 lg:hidden" onClick={() => setOpen(false)} />
      )}

      <aside
        className={`fixed lg:static inset-y-0 left-0 z-30 w-56 shrink-0 bg-[#070E1E]
                    border-r border-[#1E3A5F] flex flex-col transition-transform
                    ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        <div className="px-4 py-4 border-b border-[#1E3A5F]">
          <div className="flex items-center gap-2">
            <span className="text-[#00C2CB] text-lg leading-none">✦</span>
            <div>
              <div className="text-white text-xs font-bold leading-tight">AD Ports Group</div>
              <div className="text-[#94A3B8] text-[10px] leading-tight">Liner Services Intelligence</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 py-2 overflow-y-auto">
          {NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2 text-[13px] transition-colors ${
                  isActive
                    ? 'bg-[#0F2040] text-[#00C2CB] border-r-2 border-[#00C2CB] font-medium'
                    : 'text-[#94A3B8] hover:text-white hover:bg-[#0D1B33]'
                }`
              }
            >
              <span className="text-sm w-4 text-center shrink-0">{item.icon}</span>
              <span className="leading-tight">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-3 border-t border-[#1E3A5F] text-[10px] text-[#4A6082] leading-relaxed">
          eeSea via BigQuery
          <br />
          Refreshed weekly
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col bg-[#0A1628]">
        {/* Mobile header */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-[#1E3A5F] shrink-0">
          <button
            onClick={() => setOpen(v => !v)}
            aria-label="Toggle navigation"
            className="text-[#94A3B8] hover:text-white text-lg leading-none"
          >
            ☰
          </button>
          <span className="text-white text-sm font-semibold">Liner Services</span>
        </div>

        <main className="flex-1 min-w-0 overflow-x-hidden p-4 sm:p-5 lg:p-6">
          <div className="mx-auto w-full max-w-[1600px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
