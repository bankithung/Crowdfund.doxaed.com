const inrFull = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0,
})
const inrPaise = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2,
})

export function inr(value) {
  const n = Number(value) || 0
  return Number.isInteger(n) ? inrFull.format(n) : inrPaise.format(n)
}

export function inrCompact(value) {
  const n = Number(value) || 0
  if (n >= 1e7) return `₹${trim(n / 1e7)}Cr`
  if (n >= 1e5) return `₹${trim(n / 1e5)}L`
  if (n >= 1e3) return `₹${trim(n / 1e3)}k`
  return inrFull.format(n)
}
const trim = (n) => (Math.round(n * 10) / 10).toString().replace(/\.0$/, '')

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
})
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  hour12: true, timeZone: 'Asia/Kolkata',
})

export const shortDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : '—')
export const dateTime = (iso) => (iso ? dateTimeFmt.format(new Date(iso)) : '—')

export function timeAgo(iso) {
  if (!iso) return '—'
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return shortDate(iso)
}

/* Deep link for the "pay with UPI app" button.

   UPI apps risk-screen app-constructed intent links far more aggressively
   than scanned QR payloads (prefilled amounts/notes commonly fail with
   "limit exceeded"). So: prefer the EXACT payload decoded from the
   organizer's uploaded QR — tapping then equals scanning. The constructed
   fallback stays minimal (pa/pn/cu only, no amount, no note). */
export function upiLink({ qrPayload, upiId, payeeName }) {
  if (qrPayload && /^upi:\/\//i.test(qrPayload.trim())) return qrPayload.trim()
  if (!upiId) return null
  const params = new URLSearchParams({ pa: upiId, pn: payeeName || 'Organizer', cu: 'INR' })
  return `upi://pay?${params.toString()}`
}

export const isMobile = () =>
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

export const publicUrl = (slug) => `${window.location.origin}/c/${slug}`
