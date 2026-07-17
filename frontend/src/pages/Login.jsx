import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Field, Spinner } from '../components/bits.jsx'
import { Icon } from '../components/Icon.jsx'
import { Logo } from '../components/Logo.jsx'
import { useAuth } from '../ctx/AuthContext.jsx'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(email, password)
      navigate(location.state?.from || '/dashboard', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card card">
        <div className="auth-logo"><Logo /></div>
        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-sub">Sign in to manage your fundraisers</p>
        {error && <div className="alert alert-danger" role="alert"><Icon name="alert" size={15} />{error}</div>}
        <form onSubmit={submit} noValidate>
          <Field label="Email" required>
            <input className="input" type="email" value={email} autoComplete="email"
                   onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
          </Field>
          <Field label="Password" required>
            <input className="input" type="password" value={password} autoComplete="current-password"
                   onChange={(e) => setPassword(e.target.value)} placeholder="Your password" required />
          </Field>
          <button className="btn btn-primary btn-block" disabled={busy || !email || !password}>
            {busy ? <Spinner size={15} /> : <>Sign in <Icon name="arrow-right" size={15} /></>}
          </button>
        </form>
        <p className="auth-switch">
          New here? <Link to="/signup">Create an account</Link>
        </p>
      </div>
    </div>
  )
}
