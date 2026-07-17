// React Bits <Counter /> (motion) — patched: any string in `places` renders
// as a static separator (enables ₹ Indian digit grouping via commas), and
// digits key by index so repeated separators don't collide.
import { useEffect } from 'react'
import { motion, useSpring, useTransform } from 'motion/react'
import './Counter.css'

function Number({ mv, number, height }) {
  const y = useTransform(mv, latest => {
    const placeValue = latest % 10
    const offset = (10 + number - placeValue) % 10
    let memo = offset * height
    if (offset > 5) memo -= 10 * height
    return memo
  })
  return <motion.span className="counter-number" style={{ y }}>{number}</motion.span>
}

function normalizeNearInteger(num) {
  const nearest = Math.round(num)
  const tolerance = 1e-9 * Math.max(1, Math.abs(num))
  return Math.abs(num - nearest) < tolerance ? nearest : num
}

function getValueRoundedToPlace(value, place) {
  return Math.floor(normalizeNearInteger(value / place))
}

function Digit({ place, value, height, digitStyle }) {
  const isStatic = typeof place === 'string'
  const valueRoundedToPlace = isStatic ? 0 : getValueRoundedToPlace(value, place)
  const animatedValue = useSpring(valueRoundedToPlace, { stiffness: 90, damping: 24 })

  useEffect(() => {
    if (!isStatic) animatedValue.set(valueRoundedToPlace)
  }, [animatedValue, valueRoundedToPlace, isStatic])

  if (isStatic) {
    return (
      <span className="counter-digit counter-sep"
            style={{ height, ...digitStyle, width: 'fit-content' }}>
        {place}
      </span>
    )
  }
  return (
    <span className="counter-digit" style={{ height, ...digitStyle }}>
      {Array.from({ length: 10 }, (_, i) => (
        <Number key={i} mv={animatedValue} number={i} height={height} />
      ))}
    </span>
  )
}

export default function Counter({
  value,
  fontSize = 100,
  padding = 0,
  places,
  gap = 8,
  borderRadius = 4,
  horizontalPadding = 8,
  textColor = 'inherit',
  fontWeight = 'inherit',
  containerStyle,
  counterStyle,
  digitStyle,
  gradientHeight = 16,
  gradientFrom = 'black',
  gradientTo = 'transparent',
  topGradientStyle,
  bottomGradientStyle
}) {
  const resolvedPlaces = places ?? [...value.toString()].map((ch, i, a) => {
    if (ch === '.') return '.'
    return 10 ** (a.indexOf('.') === -1
      ? a.length - i - 1
      : i < a.indexOf('.') ? a.indexOf('.') - i - 1 : -(i - a.indexOf('.')))
  })

  const height = fontSize + padding
  const defaultCounterStyle = {
    fontSize,
    gap,
    borderRadius,
    paddingLeft: horizontalPadding,
    paddingRight: horizontalPadding,
    color: textColor,
    fontWeight,
    direction: 'ltr'
  }
  const defaultTopGradientStyle = {
    height: gradientHeight,
    background: `linear-gradient(to bottom, ${gradientFrom}, ${gradientTo})`
  }
  const defaultBottomGradientStyle = {
    height: gradientHeight,
    background: `linear-gradient(to top, ${gradientFrom}, ${gradientTo})`
  }

  return (
    <span className="counter-container" style={containerStyle}>
      <span className="counter-counter" style={{ ...defaultCounterStyle, ...counterStyle }}>
        {resolvedPlaces.map((place, index) => (
          <Digit key={index} place={place} value={value} height={height} digitStyle={digitStyle} />
        ))}
      </span>
      <span className="gradient-container">
        <span className="top-gradient"
              style={topGradientStyle || defaultTopGradientStyle} />
        <span className="bottom-gradient"
              style={bottomGradientStyle || defaultBottomGradientStyle} />
      </span>
    </span>
  )
}
