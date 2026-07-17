// App chrome: authed shell (top bar + mobile menu) and public shell (nav + footer).

import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../ctx/AuthContext.jsx'
import { Icon } from './Icon.jsx'
import { Logo } from './Logo.jsx'

export function AppShell({ children }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => { setMenuOpen(false) }, [location])

  const signOut = async () => {
    await logout()
    navigate('/')
  }

  return (
    <div className="shell">
      <header className="appbar">
        <div className="appbar-inner container">
          <Logo to="/dashboard" />
          <nav className={`appnav ${menuOpen ? 'is-open' : ''}`} aria-label="Main">
            <NavLink to="/dashboard" end className="appnav-link">
              <Icon name="chart" size={15} /> Dashboard
            </NavLink>
            <NavLink to="/dashboard/campaigns/new" className="appnav-link">
              <Icon name="plus" size={15} /> New fundraiser
            </NavLink>
            <div className="appnav-user">
              <span className="appnav-avatar" aria-hidden="true">{initials(user?.name)}</span>
              <div className="appnav-id">
                <span className="appnav-name">{user?.name}</span>
                <span className="appnav-email">{user?.email}</span>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={signOut}>
                <Icon name="logout" size={14} /> Sign out
              </button>
            </div>
          </nav>
          <button className="icon-btn appbar-burger" aria-label="Toggle menu"
                  aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
            <Icon name={menuOpen ? 'x' : 'menu'} size={19} />
          </button>
        </div>
      </header>
      <main className="container page">{children}</main>
    </div>
  )
}

export function PublicShell({ children, minimal = false }) {
  const { user } = useAuth()
  return (
    <div className="shell">
      <header className="appbar appbar-public">
        <div className="appbar-inner container">
          <Logo />
          <div className="pubnav">
            {!minimal && <a href="/#how" className="pubnav-link">How it works</a>}
            {user ? (
              <Link to="/dashboard" className="btn btn-primary btn-sm">
                Dashboard <Icon name="arrow-right" size={14} />
              </Link>
            ) : (
              <>
                <Link to="/login" className="pubnav-link">Sign in</Link>
                <Link to="/signup" className="btn btn-primary btn-sm">Start a fundraiser</Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer className="footer">
        <div className="container footer-inner">
          <Logo />
          <p className="footer-note">
            Contributions go directly to the organizer's account via their payment QR.
            Organizers verify each payment manually before it appears on the supporter wall.
          </p>
          <p className="footer-copy">© {new Date().getFullYear()} CrowdFund · crowdfund.doxaed.com</p>
        </div>
      </footer>
    </div>
  )
}

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?'
}
