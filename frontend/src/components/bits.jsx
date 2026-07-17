// Small shared pieces: fields, progress, badges, copy field, empty states,
// skeletons, image upload with preview.

import { useRef, useState } from 'react'
import { inr } from '../format.js'
import { CropperModal } from './Cropper.jsx'
import { Icon } from './Icon.jsx'
import { useToast } from '../ctx/ToastContext.jsx'

export function Field({ label, error, hint, children, required = false }) {
  return (
    <label className={`field ${error ? 'has-error' : ''}`}>
      <span className="field-label">
        {label}{required && <em className="req" aria-hidden="true"> *</em>}
      </span>
      {children}
      {error ? <span className="field-error" role="alert">{error}</span>
             : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

export function Check({ checked, onChange, children }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="check-box" aria-hidden="true"><Icon name="check" size={12} strokeWidth={2.4} /></span>
      <span className="check-label">{children}</span>
    </label>
  )
}

export function ProgressBar({ value, slim = false }) {
  const pct = Math.max(0, Math.min(Number(value) || 0, 100))
  return (
    <div className={`progress ${slim ? 'progress-slim' : ''}`} role="progressbar"
         aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  )
}

const STATUS_META = {
  pending: { label: 'Pending', icon: 'clock', cls: 'badge-warn' },
  confirmed: { label: 'Confirmed', icon: 'check-circle', cls: 'badge-money' },
  rejected: { label: 'Rejected', icon: 'x', cls: 'badge-danger' },
  active: { label: 'Active', icon: 'zap', cls: 'badge-money' },
  paused: { label: 'Paused', icon: 'pause', cls: 'badge-warn' },
  ended: { label: 'Ended', icon: 'check', cls: 'badge-muted' },
}

export function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status, icon: 'info', cls: 'badge-muted' }
  return (
    <span className={`badge ${meta.cls}`}>
      <Icon name={meta.icon} size={12} strokeWidth={2} />
      {meta.label}
    </span>
  )
}

export function CopyField({ value, label = 'Copy' }) {
  const toast = useToast()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success('Copied to clipboard')
    } catch {
      const area = document.createElement('textarea')
      area.value = value
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
      toast.success('Copied to clipboard')
    }
  }
  return (
    <div className="copy-field">
      <span className="copy-value" title={value}>{value}</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
        <Icon name="copy" size={14} /> {label}
      </button>
    </div>
  )
}

export function EmptyState({ icon = 'inbox', title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={26} /></div>
      <p className="empty-title">{title}</p>
      {children && <p className="empty-sub">{children}</p>}
      {action}
    </div>
  )
}

export function Spinner({ size = 18 }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="Loading" />
}

export function SkeletonRows({ rows = 3, height = 52 }) {
  return (
    <div className="skeleton-stack" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  )
}

export function AmountChips({ onPick, current }) {
  return (
    <div className="chips" role="group" aria-label="Quick amounts">
      {[100, 250, 500, 1000, 2500].map((amount) => (
        <button key={amount} type="button"
                className={`chip ${Number(current) === amount ? 'is-on' : ''}`}
                onClick={() => onPick(String(amount))}>
          {inr(amount)}
        </button>
      ))}
    </div>
  )
}

export function ImageInput({ value, onChange, label, hint, error, square = false,
                             inputId, crop = false, cropAspect = 1, cropTitle }) {
  const inputRef = useRef(null)
  const [drag, setDrag] = useState(false)
  const [preview, setPreview] = useState(null)
  const [pending, setPending] = useState(null)   // file waiting in the cropper
  const [original, setOriginal] = useState(null) // kept so the user can re-crop

  const accept = (file) => {
    onChange(file)
    const reader = new FileReader()
    reader.onload = () => setPreview(reader.result)
    reader.readAsDataURL(file)
  }

  const setFile = (file) => {
    if (!file) return
    if (crop) {
      setOriginal(file)
      setPending(file)
    } else {
      accept(file)
    }
  }

  const clear = (event) => {
    event.stopPropagation()
    onChange(null)
    setPreview(null)
    setOriginal(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const recrop = (event) => {
    event.stopPropagation()
    if (original) setPending(original)
  }

  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      {label && <span className="field-label">{label}</span>}
      <div
        className={`dropzone ${drag ? 'is-drag' : ''} ${square ? 'dz-square' : ''} ${value ? 'has-file' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); setFile(e.dataTransfer.files?.[0]) }}
        role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
        aria-label={label || 'Upload image'}
      >
        <input ref={inputRef} id={inputId} type="file" accept="image/png,image/jpeg,image/webp"
               hidden onChange={(e) => setFile(e.target.files?.[0])} />
        {preview ? (
          <>
            <img src={preview} alt="Selected upload preview" className="dz-preview" />
            <div className="dz-actions">
              <span className="dz-name">{value?.name}</span>
              <span className="dz-btns">
                {crop && original && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={recrop}>
                    <Icon name="edit" size={13} /> Adjust crop
                  </button>
                )}
                <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>
                  <Icon name="trash" size={13} /> Remove
                </button>
              </span>
            </div>
          </>
        ) : (
          <div className="dz-empty">
            <span className="dz-icon"><Icon name="upload" size={20} /></span>
            <span className="dz-cta">Click to upload <span className="dz-or">or drag &amp; drop</span></span>
            <span className="dz-note">PNG/JPEG/WEBP · 6 MB{crop ? ' · crop next' : ''}</span>
          </div>
        )}
      </div>
      {error ? <span className="field-error" role="alert">{error}</span>
             : hint ? <span className="field-hint">{hint}</span> : null}
      {crop && (
        <CropperModal
          file={pending}
          aspect={cropAspect}
          title={cropTitle || 'Crop image'}
          onApply={(cropped) => { setPending(null); accept(cropped) }}
          onCancel={() => {
            setPending(null)
            if (!preview && inputRef.current) inputRef.current.value = ''
          }}
        />
      )}
    </div>
  )
}
