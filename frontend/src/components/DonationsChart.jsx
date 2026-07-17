// 30-day contributions bar chart. Single series (no legend needed): emerald
// bars with 4px rounded tops anchored to the baseline, recessive grid,
// per-day hover tooltip on full-height hit targets.

import { useEffect, useMemo, useRef, useState } from 'react'
import { inr, inrCompact } from '../format.js'

const H = 190
const PAD = { top: 14, right: 8, bottom: 24, left: 44 }

function niceCeil(value) {
  if (value <= 0) return 100
  const power = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * power) return step * power
  }
  return 10 * power
}

const dayLabel = (iso) => {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export function DonationsChart({ series }) {
  const wrapRef = useRef(null)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState(null)

  useEffect(() => {
    const node = wrapRef.current
    if (!node) return
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width
      if (w) setWidth(Math.max(280, w))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const { bars, ticks, maxY, hasData } = useMemo(() => {
    const max = Math.max(...series.map((d) => d.amount), 0)
    const top = niceCeil(max * 1.1)
    const innerW = width - PAD.left - PAD.right
    const innerH = H - PAD.top - PAD.bottom
    const slot = innerW / series.length
    const barW = Math.max(3, Math.min(slot - 2, 16))
    const bars = series.map((d, i) => {
      const h = top ? (d.amount / top) * innerH : 0
      return {
        ...d,
        x: PAD.left + slot * i + (slot - barW) / 2,
        y: PAD.top + innerH - h,
        w: barW,
        h,
        cx: PAD.left + slot * i + slot / 2,
        slotX: PAD.left + slot * i,
        slotW: slot,
      }
    })
    return {
      bars,
      ticks: [0, top / 2, top],
      maxY: top,
      hasData: max > 0,
    }
  }, [series, width])

  const innerH = H - PAD.top - PAD.bottom
  const yFor = (v) => PAD.top + innerH - (maxY ? (v / maxY) * innerH : 0)
  const xLabelEvery = Math.ceil(series.length / 5)

  // Rounded top corners only, anchored flat to the baseline.
  const barPath = (b) => {
    if (b.h <= 0.5) return null
    const r = Math.min(4, b.w / 2, b.h)
    return `M${b.x},${b.y + b.h} L${b.x},${b.y + r} Q${b.x},${b.y} ${b.x + r},${b.y} ` +
           `L${b.x + b.w - r},${b.y} Q${b.x + b.w},${b.y} ${b.x + b.w},${b.y + r} ` +
           `L${b.x + b.w},${b.y + b.h} Z`
  }

  const hovered = hover !== null ? bars[hover] : null

  return (
    <div className="chart-wrap" ref={wrapRef}>
      {hovered && (
        <div className="chart-tip" style={{
          left: Math.min(Math.max(hovered.cx, 70), width - 70),
          top: Math.max(hovered.y - 8, 6),
        }}>
          <span className="tip-date">{dayLabel(hovered.date)}</span>
          <span className="tip-amount">{inr(hovered.amount)}</span>
          <span className="tip-count">{hovered.count} contribution{hovered.count === 1 ? '' : 's'}</span>
        </div>
      )}
      <svg width={width} height={H} role="img"
           aria-label="Confirmed contributions per day, last 30 days">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={width - PAD.right} y1={yFor(tick)} y2={yFor(tick)}
                  className="chart-grid" />
            <text x={PAD.left - 8} y={yFor(tick) + 3.5} className="chart-ylabel"
                  textAnchor="end">{inrCompact(tick)}</text>
          </g>
        ))}
        {bars.map((b, i) => {
          const path = barPath(b)
          return (
            <g key={b.date}>
              {path && (
                <path d={path}
                      className={`chart-bar ${hover === i ? 'is-hover' : ''}`} />
              )}
              {hover === i && (
                <line x1={b.cx} x2={b.cx} y1={PAD.top} y2={PAD.top + innerH}
                      className="chart-crosshair" />
              )}
              {i % xLabelEvery === 0 && (
                <text x={b.cx} y={H - 7} className="chart-xlabel" textAnchor="middle">
                  {dayLabel(b.date)}
                </text>
              )}
              <rect x={b.slotX} y={PAD.top} width={b.slotW} height={innerH}
                    fill="transparent"
                    onPointerEnter={() => setHover(i)}
                    onPointerLeave={() => setHover(null)} />
            </g>
          )
        })}
        <line x1={PAD.left} x2={width - PAD.right} y1={PAD.top + innerH}
              y2={PAD.top + innerH} className="chart-axis" />
      </svg>
      {!hasData && (
        <div className="chart-empty">No confirmed contributions in the last 30 days yet</div>
      )}
    </div>
  )
}
