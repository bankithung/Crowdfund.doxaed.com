import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon.jsx'

export function Modal({ open, onClose, title, subtitle, children, wide = false, closable = true }) {
  const panelRef = useRef(null)

  /* Autofocus + scroll lock run ONLY when the modal opens. Anything else in
     the deps (like an inline onClose recreated by a parent re-render — e.g.
     the live-update poll) would re-run this and yank focus mid-typing. */
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    document.body.style.overflow = 'hidden'
    panelRef.current?.querySelector('input, textarea, button:not(.modal-x)')?.focus?.()
    return () => {
      document.body.style.overflow = ''
      previous?.focus?.()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event) => {
      if (event.key === 'Escape' && closable) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, closable])

  if (!open) return null
  /* Portal to <body>: a modal rendered inside a positioned/z-indexed
     ancestor (e.g. the hero-overlap layout) would otherwise lose the
     stacking fight against fixed elements like the sticky pay bar. */
  return createPortal(
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
    </div>,
    document.body,
  )
}
