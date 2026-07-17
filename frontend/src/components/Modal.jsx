import { useEffect, useRef } from 'react'
import { Icon } from './Icon.jsx'

export function Modal({ open, onClose, title, subtitle, children, wide = false, closable = true }) {
  const panelRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    document.body.style.overflow = 'hidden'
    const onKey = (event) => {
      if (event.key === 'Escape' && closable) onClose()
    }
    document.addEventListener('keydown', onKey)
    panelRef.current?.querySelector('input, textarea, button:not(.modal-x)')?.focus?.()
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [open, onClose, closable])

  if (!open) return null
  return (
    <div className="modal-overlay" onPointerDown={(e) => {
      if (closable && e.target === e.currentTarget) onClose()
    }}>
      <div className={`modal-panel ${wide ? 'modal-wide' : ''}`} role="dialog"
           aria-modal="true" aria-label={title} ref={panelRef}>
        <div className="modal-head">
          <div className="modal-head-text">
            <h3 className="modal-title">{title}</h3>
            {subtitle && <p className="modal-subtitle">{subtitle}</p>}
          </div>
          {closable && (
            <button className="icon-btn modal-x" onClick={onClose} aria-label="Close dialog">
              <Icon name="x" size={16} />
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
