// Cover slideshow for campaign pages: crossfade auto-advance, swipe on
// touch, arrows + dots. Zero dependencies, honors reduced-motion.
import { useCallback, useEffect, useRef, useState } from 'react'

const AUTO_MS = 3000

export function CoverCarousel({ images = [] }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const touch = useRef(null)
  const count = images.length

  const go = useCallback((next) => {
    setIndex(((next % count) + count) % count)
  }, [count])

  useEffect(() => {
    if (count < 2 || paused) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(() => setIndex((i) => (i + 1) % count), AUTO_MS)
    return () => clearInterval(id)
  }, [count, paused])

  if (count === 0) return null
  if (count === 1) {
    return (
      <div className="pc-cover" aria-hidden="true">
        <img src={images[0]} alt="" />
      </div>
    )
  }

  const onPointerDown = (e) => { touch.current = e.clientX }
  const onPointerUp = (e) => {
    if (touch.current == null) return
    const delta = e.clientX - touch.current
    touch.current = null
    if (Math.abs(delta) > 40) go(index + (delta < 0 ? 1 : -1))
  }

  return (
    <section
      className="pc-cover pc-carousel"
      aria-roledescription="carousel"
      aria-label="Fundraiser photos"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      {images.map((url, i) => (
        <img
          key={url}
          src={url}
          alt=""
          draggable={false}
          className={`pc-slide ${i === index ? 'is-active' : ''}`}
          aria-hidden={i !== index}
          loading={i === 0 ? 'eager' : 'lazy'}
        />
      ))}

      <div className="pc-carousel-dots" role="tablist" aria-label="Choose photo">
        {images.map((url, i) => (
          <button key={url} role="tab" aria-selected={i === index}
                  aria-label={`Photo ${i + 1} of ${count}`}
                  className={`pc-dot ${i === index ? 'is-active' : ''}`}
                  onClick={() => go(i)} />
        ))}
      </div>
    </section>
  )
}
