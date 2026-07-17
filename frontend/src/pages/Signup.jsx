import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Field, Spinner } from '../components/bits.jsx'
import { Icon } from '../components/Icon.jsx'
import { Logo } from '../components/Logo.jsx'
import { useAuth } from '../ctx/AuthContext.jsx'

export default function Signup() {
  const { signup } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [fieldErrors, setFieldErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setFieldErrors({})
    setBusy(true)
    try {
      await signup(form.name, form.email, form.password)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err.fields ? '' : err.message)
      setFieldErrors(err.fields || {})
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card card">
        <div className="auth-logo"><Logo /></div>
        <h1 className="auth-title">Create your account</h1>
        <p className="auth-sub">Free forever. Start your first fundraiser today.</p>
        {error && <div className="alert alert-danger" role="alert"><Icon name="alert" size={15} />{error}</div>}
        <form onSubmit={submit} noValidate>
          <Field label="Your name" required error={fieldErrors.name}>
            <input className="input" value={form.name} autoComplete="name"
                   onChange={set('name')} placeholder="e.g. Asha Rao" required />
          </Field>
          <Field label="Email" required error={fieldErrors.email}>
            <input className="input" type="email" value={form.email} autoComplete="email"
                   onChange={set('email')} placeholder="you@example.com" required />
          </Field>
          <Field label="Password" required error={fieldErrors.password}
                 hint="At least 8 characters — avoid common words and all-numbers.">
            <input className="input" type="password" value={form.password} autoComplete="new-password"
                   onChange={set('password')} placeholder="Create a strong password" required />
          </Field>
          <button className="btn btn-primary btn-block"
                  disabled={busy || !form.name || !form.email || !form.password}>
            {busy ? <Spinner size={15} /> : <>Create account <Icon name="arrow-right" size={15} /></>}
          </button>
        </form>
        <p className="auth-switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
