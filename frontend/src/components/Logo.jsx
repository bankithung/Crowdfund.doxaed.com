import { Link } from 'react-router-dom'

export function LogoMark({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4F46E5" />
          <stop offset="1" stopColor="#059669" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#lg)" />
      <rect x="14" y="34" width="8" height="14" rx="3" fill="#fff" opacity=".72" />
      <rect x="28" y="26" width="8" height="22" rx="3" fill="#fff" opacity=".88" />
      <rect x="42" y="16" width="8" height="32" rx="3" fill="#fff" />
    </svg>
  )
}

export function Logo({ to = '/', light = false }) {
  return (
    <Link to={to} className={`logo ${light ? 'logo-light' : ''}`} aria-label="CrowdFund home">
      <LogoMark />
      <span className="logo-word">Crowd<em>Fund</em></span>
    </Link>
  )
}
