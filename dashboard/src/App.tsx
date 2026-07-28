import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import GlobalOverview from './pages/GlobalOverview'
import Port from './pages/Port'
import Country from './pages/Country'
import CoastalRegion from './pages/CoastalRegion'
import TradeRoute from './pages/TradeRoute'
import Liners from './pages/Liners'
import Service from './pages/Service'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/global" replace />} />
          <Route path="/global" element={<GlobalOverview />} />
          <Route path="/port" element={<Port />} />
          <Route path="/country" element={<Country />} />
          <Route path="/coastal-region" element={<CoastalRegion />} />
          <Route path="/trade-route" element={<TradeRoute />} />
          <Route path="/liners" element={<Liners />} />
          <Route path="/service" element={<Service />} />

          {/* Redirects from the v1 layout, so existing links keep working */}
          <Route path="/port-map" element={<Navigate to="/global" replace />} />
          <Route path="/route-map" element={<Navigate to="/port" replace />} />
          <Route path="/port-trend" element={<Navigate to="/port" replace />} />
          <Route path="/port-snapshot" element={<Navigate to="/port" replace />} />
          <Route path="/port-connectivity" element={<Navigate to="/port" replace />} />
          <Route path="/service-evolution" element={<Navigate to="/service" replace />} />
          <Route path="*" element={<Navigate to="/global" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
