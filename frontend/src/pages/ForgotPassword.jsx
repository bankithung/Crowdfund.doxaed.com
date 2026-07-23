import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthApi } from '../api.js'
import { Field, Spinner } from '../components/bits.jsx'
import { Icon } from '../components/Icon.jsx'
import { Logo } from '../components/Logo.jsx'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await AuthApi.requestPasswordReset(email.trim())
      setSent(true)
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
        {sent ? (
          <>
            <span className="auth-done-icon"><Icon name="send" size={26} /></span>
            <h1 className="auth-title">Check your email</h1>
            <p className="auth-sub">
              If an account exists for <strong>{email}</strong>, we've sent a link to
              reset your password. It expires in 3 days.
            </p>
            <Link className="btn btn-primary btn-block" to="/login">
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <h1 className="auth-title">Reset your password</h1>
            <p className="auth-sub">
              Enter your account email and we'll send you a reset link.
            </p>
            {error && (
              <div className="alert alert-danger" role="alert">
                <Icon name="alert" size={15} />{error}
              </div>
            )}
            <form onSubmit={submit} noValidate>
              <Field label="Email" required>
                <input className="input" type="email" value={email} autoComplete="email"
                       onChange={(e) => setEmail(e.target.value)}
                       placeholder="you@example.com" required />
              </Field>
              <button className="btn btn-primary btn-block" disabled={busy || !email.trim()}>
                {busy ? <Spinner size={15} /> : <>Send reset link <Icon name="send" size={15} /></>}
              </button>
            </form>
            <p className="auth-switch">
              Remembered it? <Link to="/login">Back to sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
