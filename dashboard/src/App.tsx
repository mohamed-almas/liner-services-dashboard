import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import GlobalOverview from './pages/GlobalOverview'
import PortTrend from './pages/PortTrend'
import PortSnapshot from './pages/PortSnapshot'
import PortConnectivity from './pages/PortConnectivity'
import Country from './pages/Country'
import CoastalRegion from './pages/CoastalRegion'
import TradeRoute from './pages/TradeRoute'
import Liners from './pages/Liners'
import Service from './pages/Service'
import ServiceEvolution from './pages/ServiceEvolution'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/global" replace />} />
          <Route path="/global" element={<GlobalOverview />} />
          <Route path="/port-trend" element={<PortTrend />} />
          <Route path="/port-snapshot" element={<PortSnapshot />} />
          <Route path="/port-connectivity" element={<PortConnectivity />} />
          <Route path="/country" element={<Country />} />
          <Route path="/coastal-region" element={<CoastalRegion />} />
          <Route path="/trade-route" element={<TradeRoute />} />
          <Route path="/liners" element={<Liners />} />
          <Route path="/service" element={<Service />} />
          <Route path="/service-evolution" element={<ServiceEvolution />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
