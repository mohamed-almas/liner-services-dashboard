import { NavLink, Outlet } from 'react-router-dom'

const NAV = [
  { to: '/',               icon: '🌍', label: 'Global Overview' },
  { to: '/port-trend',     icon: '📊', label: 'Port Trend' },
  { to: '/port-snapshot',  icon: '📍', label: 'Port Snapshot' },
  { to: '/port-connectivity', icon: '🔄', label: 'Port Connectivity' },
  { to: '/country',        icon: '🏳️', label: 'Country' },
  { to: '/coastal-region', icon: '🌊', label: 'Coastal Region' },
  { to: '/trade-route',    icon: '🛣️', label: 'Trade Route' },
  { to: '/liners',         icon: '🚢', label: 'Liners' },
  { to: '/service',        icon: '⚓', label: 'Service' },
  { to: '/service-evolution', icon: '📈', label: 'Service Evolution' },
]

export default function Layout() {
  return (
    <div className="flex w-full min-h-screen">
      {/* Sidebar */}
      <aside className="w-52 shrink-0 bg-[#070E1E] border-r border-[#1E3A5F] flex flex-col">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-[#1E3A5F]">
          <div className="flex items-center gap-2">
            <span className="text-[#00C2CB] text-xl">✦</span>
            <div>
              <div className="text-white text-xs font-bold leading-tight">AD Ports Group</div>
              <div className="text-[#94A3B8] text-[10px] leading-tight">Liner Services</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-2 overflow-y-auto">
          {NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-[#0F2040] text-[#00C2CB] border-r-2 border-[#00C2CB]'
                    : 'text-[#94A3B8] hover:text-white hover:bg-[#0D1B33]'
                }`
              }
            >
              <span className="text-base">{item.icon}</span>
              <span className="leading-tight">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-3 border-t border-[#1E3A5F] text-[10px] text-[#4A6082]">
          Data: EESEA via BigQuery
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto bg-[#0A1628] p-6">
        <Outlet />
      </main>
    </div>
  )
}
