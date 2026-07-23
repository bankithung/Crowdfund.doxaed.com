import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthApi } from '../api.js'
import { Field, Spinner } from '../components/bits.jsx'
import { Icon } from '../components/Icon.jsx'
import { Logo } from '../components/Logo.jsx'
import { useToast } from '../ctx/ToastContext.jsx'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const uid = params.get('uid') || ''
  const token = params.get('token') || ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const badLink = !uid || !token

  const submit = async (event) => {
    event.preventDefault()
    setErrors({})
    setError('')
    if (password !== confirm) {
      setErrors({ confirm: 'Passwords do not match.' })
      return
    }
    setBusy(true)
    try {
      await AuthApi.confirmPasswordReset({ uid, token, new_password: password })
      toast.success('Password updated — you can sign in now')
      navigate('/login', { replace: true })
    } catch (err) {
      setErrors(err.fields || {})
      if (!err.fields) setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card card">
        <div className="auth-logo"><Logo /></div>
        <h1 className="auth-title">Choose a new password</h1>
        <p className="auth-sub">Set a new password for your organizer account.</p>

        {badLink ? (
          <>
            <div className="alert alert-danger" role="alert">
              <Icon name="alert" size={15} />
              This reset link is incomplete. Please request a new one.
            </div>
            <Link className="btn btn-primary btn-block" to="/forgot-password">
              Request a new link
            </Link>
          </>
        ) : (
          <>
            {error && (
              <div className="alert alert-danger" role="alert">
                <Icon name="alert" size={15} />{error}
                {' '}<Link to="/forgot-password">Request a new link</Link>
              </div>
            )}
            <form onSubmit={submit} noValidate>
              <Field label="New password" required error={errors.new_password}>
                <input className="input" type="password" value={password}
                       autoComplete="new-password" minLength={8}
                       onChange={(e) => setPassword(e.target.value)}
                       placeholder="At least 8 characters" required />
              </Field>
              <Field label="Confirm new password" required error={errors.confirm}>
                <input className="input" type="password" value={confirm}
                       autoComplete="new-password"
                       onChange={(e) => setConfirm(e.target.value)}
                       placeholder="Re-enter the password" required />
              </Field>
              <button className="btn btn-primary btn-block"
                      disabled={busy || !password || !confirm}>
                {busy ? <Spinner size={15} /> : <>Set new password <Icon name="check" size={15} /></>}
              </button>
            </form>
            <p className="auth-switch">
              <Link to="/login">Back to sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
