// Fully custom dropdown (no native <select>): keyboard navigation, type-ahead,
// click-outside close, ARIA listbox semantics.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon.jsx'

export function Select({ value, onChange, options, placeholder = 'Select…',
                         ariaLabel, className = '', disabled = false }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const rootRef = useRef(null)
  const listRef = useRef(null)
  const typed = useRef({ text: '', at: 0 })
  const listboxId = useId()

  const selectedIndex = useMemo(
    () => options.findIndex((o) => o.value === value),
    [options, value],
  )
  const selected = options[selectedIndex]

  useEffect(() => {
    if (!open) return
    const close = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  useEffect(() => {
    if (open) {
      setActive(selectedIndex >= 0 ? selectedIndex : 0)
    }
  }, [open, selectedIndex])

  useEffect(() => {
    if (open && active >= 0 && listRef.current) {
      const node = listRef.current.children[active]
      node?.scrollIntoView({ block: 'nearest' })
    }
  }, [open, active])

  const commit = (index) => {
    const option = options[index]
    if (option && !option.disabled) {
      onChange(option.value)
      setOpen(false)
    }
  }

  const onKeyDown = (event) => {
    if (disabled) return
    const { key } = event
    if (!open && (key === 'Enter' || key === ' ' || key === 'ArrowDown' || key === 'ArrowUp')) {
      event.preventDefault()
      setOpen(true)
      return
    }
    if (!open) return
    if (key === 'Escape') { event.preventDefault(); setOpen(false) }
    else if (key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.min(i + 1, options.length - 1)) }
    else if (key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (key === 'Home') { event.preventDefault(); setActive(0) }
    else if (key === 'End') { event.preventDefault(); setActive(options.length - 1) }
    else if (key === 'Enter' || key === ' ') { event.preventDefault(); commit(active) }
    else if (key === 'Tab') { setOpen(false) }
    else if (key.length === 1 && /\S/.test(key)) {
      const now = Date.now()
      typed.current.text = (now - typed.current.at < 700 ? typed.current.text : '') + key.toLowerCase()
      typed.current.at = now
      const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text))
      if (hit >= 0) setActive(hit)
    }
  }

  return (
    <div className={`select ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''} ${className}`} ref={rootRef}>
      <button
        type="button"
        className="select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
      >
        <span className={`select-value ${selected ? '' : 'is-placeholder'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <Icon name="chevron-down" size={15} className="select-chev" />
      </button>
      {open && (
        <ul className="select-menu" role="listbox" id={listboxId} ref={listRef}
            aria-activedescendant={active >= 0 ? `${listboxId}-${active}` : undefined}>
          {options.map((option, index) => (
            <li
              key={String(option.value)}
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={option.value === value}
              className={[
                'select-option',
                index === active ? 'is-active' : '',
                option.value === value ? 'is-selected' : '',
                option.disabled ? 'is-disabled' : '',
              ].join(' ')}
              onPointerMove={() => setActive(index)}
              onClick={() => commit(index)}
            >
              <span>{option.label}</span>
              {option.value === value && <Icon name="check" size={14} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
