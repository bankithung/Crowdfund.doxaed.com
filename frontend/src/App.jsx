import { Component, Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Spinner } from './components/bits.jsx'
import { useAuth } from './ctx/AuthContext.jsx'
import CampaignManage from './pages/CampaignManage.jsx'
import CampaignNew from './pages/CampaignNew.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Login from './pages/Login.jsx'
import NotFound from './pages/NotFound.jsx'
import PublicCampaign from './pages/PublicCampaign.jsx'
import Signup from './pages/Signup.jsx'

// The animated homepage carries WebGL/animation libraries — split it off so
// the app pages stay lean.
const Landing = lazy(() => import('./pages/Landing.jsx'))

/* If anything on a page throws (old GPUs, exotic browsers), show a working
   fallback instead of unmounting to a blank screen. */
class PageBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="splash" style={{ flexDirection: 'column', gap: 14, padding: 20, textAlign: 'center' }}>
        <p style={{ fontSize: 15, fontWeight: 700 }}>CrowdFund</p>
        <p style={{ fontSize: 13, color: '#5f6a7d', maxWidth: 420 }}>
          This page hit a snag on your device. Everything else works — use the
          links below.
        </p>
        <p style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <a className="btn btn-primary" href="/signup">Start a fundraiser</a>
          <a className="btn btn-outline" href="/login">Sign in</a>
        </p>
      </div>
    )
  }
}

function Protected({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) {
    return <div className="splash"><Spinner size={26} /></div>
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={
        <PageBoundary>
          <Suspense fallback={<div className="splash"><Spinner size={26} /></div>}>
            <Landing />
          </Suspense>
        </PageBoundary>
      } />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/c/:slug" element={<PublicCampaign />} />
      <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
      <Route path="/dashboard/campaigns/new" element={<Protected><CampaignNew /></Protected>} />
      <Route path="/dashboard/campaigns/:id" element={<Protected><CampaignManage /></Protected>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
