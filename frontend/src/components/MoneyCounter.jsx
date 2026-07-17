// Big animated rupee amount: Indian digit grouping (₹41,250 / ₹1,00,000),
// counts up from 0 on mount, springs to new values on change.
import { useEffect, useMemo, useState } from 'react'
import Counter from '../reactbits/Counter.jsx'

const groupFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

export function MoneyCounter({ value, fontSize = 40, color = 'var(--money-strong)',
                               background = '#ffffff', className = '' }) {
  const target = Math.max(0, Math.round(Number(value) || 0))
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    const id = setTimeout(() => setDisplay(target), 250)
    return () => clearTimeout(id)
  }, [target])

  // Places derived from the FINAL value so the layout never jumps while the
  // spring runs: "41,250" -> [10000, 1000, ',', 100, 10, 1]
  const places = useMemo(() => {
    const chars = [...groupFmt.format(Math.max(target, 1))]
    const digitCount = chars.filter(c => c !== ',').length
    let remaining = digitCount
    return chars.map(ch => {
      if (ch === ',') return ','
      remaining -= 1
      return 10 ** remaining
    })
  }, [target])

  return (
    <span className={`money-counter ${className}`} style={{ color }}
          role="img" aria-label={`₹${groupFmt.format(target)}`}>
      <span className="money-counter-symbol" aria-hidden="true"
            style={{ fontSize: Math.round(fontSize * 0.62) }}>₹</span>
      <Counter
        value={display}
        places={places}
        fontSize={fontSize}
        padding={Math.round(fontSize * 0.18)}
        gap={Math.max(1, Math.round(fontSize * 0.02))}
        horizontalPadding={0}
        borderRadius={0}
        fontWeight={800}
        textColor="currentColor"
        gradientHeight={Math.round(fontSize * 0.16)}
        gradientFrom={background}
        gradientTo="transparent"
      />
    </span>
  )
}
