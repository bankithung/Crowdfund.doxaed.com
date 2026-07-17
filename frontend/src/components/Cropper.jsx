// Client-side image cropper: drag to pan, wheel / pinch / slider to zoom,
// fixed aspect frame. Outputs a re-rendered PNG File via canvas — used so
// organizers can crop their payment QR (and covers) before upload.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon.jsx'
import { Modal } from './Modal.jsx'

const Spinner = ({ size = 18 }) => (
  <span className="spinner" style={{ width: size, height: size }} aria-label="Loading" />
)

const frameWidth = () => Math.min(300, Math.max(200, Math.round(window.innerWidth * 0.68)))

export function CropperModal({ file, aspect = 1, title = 'Crop image',
                               hint, onApply, onCancel }) {
  const [img, setImg] = useState(null)        // HTMLImageElement
  const [zoom, setZoom] = useState(1)         // multiplier over cover-fit
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const pointers = useRef(new Map())
  const gesture = useRef(null)
  const frameRef = useRef(null)

  const frame = useMemo(() => {
    const w = frameWidth()
    return { w, h: Math.round(w / aspect) }
  }, [aspect])

  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => setImg(image)
    image.src = url
    setZoom(1)
    setPos({ x: 0, y: 0 })
    return () => URL.revokeObjectURL(url)
  }, [file])

  // scale that makes the image exactly cover the frame at zoom 1
  const coverScale = img
    ? Math.max(frame.w / img.naturalWidth, frame.h / img.naturalHeight)
    : 1
  const scale = coverScale * zoom

  const clampPos = useCallback((p, z) => {
    if (!img) return p
    const s = coverScale * z
    const maxX = Math.max(0, (img.naturalWidth * s - frame.w) / 2)
    const maxY = Math.max(0, (img.naturalHeight * s - frame.h) / 2)
    return {
      x: Math.min(maxX, Math.max(-maxX, p.x)),
      y: Math.min(maxY, Math.max(-maxY, p.y)),
    }
  }, [img, coverScale, frame])

  const setZoomClamped = useCallback((z, focus) => {
    const next = Math.min(5, Math.max(1, z))
    setZoom(next)
    setPos((p) => clampPos(focus || p, next))
  }, [clampPos])

  const onPointerDown = (e) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]
    gesture.current = pts.length === 2
      ? { type: 'pinch', dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), zoom }
      : { type: 'pan', start: { x: e.clientX, y: e.clientY }, pos }
  }

  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    const pts = [...pointers.current.values()]
    if (g?.type === 'pinch' && pts.length === 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      if (g.dist > 0) setZoomClamped(g.zoom * (dist / g.dist))
    } else if (g?.type === 'pan' && pts.length === 1) {
      setPos(clampPos({
        x: g.pos.x + (e.clientX - g.start.x),
        y: g.pos.y + (e.clientY - g.start.y),
      }, zoom))
    }
  }

  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId)
    gesture.current = null
  }

  const onWheel = (e) => {
    e.preventDefault()
    setZoomClamped(zoom * (e.deltaY < 0 ? 1.08 : 0.925))
  }

  const apply = async () => {
    if (!img) return
    setBusy(true)
    try {
      // frame region → source-image pixel rect
      const sw = frame.w / scale
      const sh = frame.h / scale
      const sx = (img.naturalWidth - sw) / 2 - pos.x / scale
      const sy = (img.naturalHeight - sh) / 2 - pos.y / scale
      const outW = Math.min(Math.round(sw), 1600)
      const outH = Math.round(outW / aspect)
      const canvas = document.createElement('canvas')
      canvas.width = outW
      canvas.height = outH
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      const name = (file.name || 'image').replace(/\.[a-z0-9]+$/i, '') + '-cropped.png'
      onApply(new File([blob], name, { type: 'image/png' }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!file} onClose={onCancel} title={title}
           subtitle={hint || 'Drag to position — scroll, pinch or use the slider to zoom.'}>
      <div className="cropper">
        <div
          className="crop-stage"
          ref={frameRef}
          style={{ '--frame-w': `${frame.w}px`, '--frame-h': `${frame.h}px` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          role="application"
          aria-label="Crop area — drag to reposition the image"
        >
          {img ? (
            <>
              <img
                src={img.src}
                alt=""
                draggable={false}
                style={{
                  width: img.naturalWidth * scale,
                  height: img.naturalHeight * scale,
                  transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))`,
                }}
              />
              <div className="crop-frame" aria-hidden="true">
                <span className="crop-corner tl" /><span className="crop-corner tr" />
                <span className="crop-corner bl" /><span className="crop-corner br" />
              </div>
            </>
          ) : <Spinner size={22} />}
        </div>

        <div className="crop-zoom">
          <Icon name="image" size={14} />
          <input
            type="range" className="range" min="1" max="5" step="0.01"
            value={zoom} aria-label="Zoom"
            onChange={(e) => setZoomClamped(Number(e.target.value))}
          />
          <Icon name="search" size={16} />
        </div>

        <div className="form-nav">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={apply} disabled={busy || !img}>
            {busy ? <Spinner size={14} /> : <><Icon name="check" size={15} /> Apply crop</>}
          </button>
        </div>
      </div>
    </Modal>
  )
}
