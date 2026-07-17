// Public fundraiser page: header band, story + verified supporter wall,
// and a three-card payment rail (progress / scan-to-pay / act & share).

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { PublicApi } from '../api.js'
import { AmountChips, Check, CopyField, EmptyState, Field, ImageInput,
         ProgressBar, SkeletonRows, Spinner } from '../components/bits.jsx'
import { CoverCarousel } from '../components/CoverCarousel.jsx'
import { Icon } from '../components/Icon.jsx'
import { MarkdownText } from '../components/Markdown.jsx'
import { Modal } from '../components/Modal.jsx'
import { MoneyCounter } from '../components/MoneyCounter.jsx'
import { Select } from '../components/Select.jsx'
import { ShareRow } from '../components/ShareRow.jsx'
import { PublicShell } from '../components/Shells.jsx'
import { useToast } from '../ctx/ToastContext.jsx'
import { inr, publicUrl, shortDate, timeAgo } from '../format.js'

/* The organizer's UPI ID — explicit field first, else parsed from the QR payload. */
function effectiveUpiId(campaign) {
  if (campaign.upi_id) return campaign.upi_id
  const match = (campaign.qr_payload || '').match(/[?&]pa=([^&]+)/i)
  try {
    return match ? decodeURIComponent(match[1]) : ''
  } catch {
    return ''
  }
}

export default function PublicCampaign() {
  const { slug } = useParams()
  const [params, setParams] = useSearchParams()
  const toast = useToast()
  const [campaign, setCampaign] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [claimOpen, setClaimOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(!!params.get('ref'))

  const load = useCallback(() => {
    PublicApi.campaign(slug)
      .then((data) => setCampaign(data.campaign))
      .catch((err) => { if (err.status === 404) setNotFound(true) })
  }, [slug])

  useEffect(() => { load() }, [load])

  if (notFound) {
    return (
      <PublicShell minimal>
        <div className="container page nf-wrap">
          <EmptyState icon="search" title="Fundraiser not found">
            This link may be incorrect, or the organizer removed the fundraiser.
          </EmptyState>
        </div>
      </PublicShell>
    )
  }

  if (!campaign) {
    return (
      <PublicShell minimal>
        <div className="container page"><SkeletonRows rows={3} height={140} /></div>
      </PublicShell>
    )
  }

  const stats = campaign.stats
  const goalReached = stats.raised >= stats.goal && stats.goal > 0
  const closed = !campaign.is_open
  const upiId = effectiveUpiId(campaign)

  const copyUpi = async () => {
    try {
      await navigator.clipboard.writeText(upiId)
      toast.success('UPI ID copied — paste it in any UPI app')
    } catch {
      toast.info(upiId)
    }
  }

  const scrollToPay = () =>
    document.getElementById('pay')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const scrollToWall = () =>
    document.getElementById('supporters')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const gallery = (campaign.gallery || []).map((g) => g.url)
  const hasCover = gallery.length > 0

  const headerContent = (
    <>
      <div className="pc-meta">
        <span className="badge badge-muted">{campaign.category_label}</span>
        <span className="badge badge-money">
          <Icon name="badge-check" size={12} /> Verified supporter wall
        </span>
        {campaign.status === 'ended' && <span className="badge badge-muted">Ended</span>}
        {campaign.status === 'paused' && <span className="badge badge-warn">Paused</span>}
      </div>
      <h1 className="pc-title">{campaign.title}</h1>
      {campaign.tagline && <p className="pc-tagline">{campaign.tagline}</p>}
      <div className="pc-organizer">
        <span className="pc-avatar" aria-hidden="true">{campaign.organizer.slice(0, 1)}</span>
        <span>
          Organized by <strong>{campaign.organizer}</strong>
          {campaign.organizer_verified && (
            <span className="verified-tick" role="img" title="Verified organizer"
                  aria-label="Verified organizer">
              <Icon name="badge-check" size={15} />
            </span>
          )}
          <span className="muted"> · started {shortDate(campaign.created_at)}</span>
        </span>
      </div>
    </>
  )

  return (
    <PublicShell minimal>
      {hasCover ? (
        /* tall photo hero — title & organizer overlay the image */
        <div className="pc-hero">
          <CoverCarousel images={gallery} />
          <div className="pc-hero-scrim" aria-hidden="true" />
          <div className="container pc-hero-content">{headerContent}</div>
        </div>
      ) : (
        <header className="pc-head">
          <div className="container">{headerContent}</div>
        </header>
      )}

      <div className={`container pc-layout ${hasCover ? 'pc-layout-overlap' : ''}`}>
        <DonorMarquee campaign={campaign} onJump={scrollToWall} />
        <div className="pc-left">
          <main className="pc-main">
            {goalReached && (
              <div className="alert alert-money">
                <Icon name="sparkle" size={15} />
                Goal reached! {inr(stats.raised)} raised — contributions are still welcome.
              </div>
            )}
            {closed && (
              <div className="alert alert-warn">
                <Icon name="info" size={15} />
                {campaign.status === 'ended'
                  ? 'This fundraiser has ended and is no longer accepting contributions.'
                  : campaign.status === 'paused'
                    ? 'The organizer has paused this fundraiser — new contributions are on hold.'
                    : 'This fundraiser has passed its end date and is no longer accepting contributions.'}
              </div>
            )}

            <section className="card pc-story-card">
              <span className="mini-label">The story</span>
              <MarkdownText text={campaign.description} className="pc-story-text" />
            </section>
          </main>

          <SupporterWall campaign={campaign} />
        </div>

        {/* --------------------------------------------- payment rail */}
        <aside className="pc-aside">
          <div className="pc-aside-stack">
            {/* raised-so-far card — first on the page, above the story */}
            <div className="card pc-card pc-stats-card">
              <span className="mini-label">
                <span className="pc-live-dot" aria-hidden="true" /> Raised so far
              </span>
              <div className="pc-amounts">
                <MoneyCounter value={stats.raised} fontSize={42}
                              color="var(--money-strong)" background="#ffffff" />
                <span className="pc-goal">of {inr(stats.goal)} goal</span>
              </div>
              <ProgressBar value={stats.progress} />
              <div className="pc-stats3">
                <div>
                  <strong>{stats.donors}</strong>
                  <span>verified supporter{stats.donors === 1 ? '' : 's'}</span>
                </div>
                <div>
                  <strong>{Math.min(stats.progress, 999)}%</strong>
                  <span>funded</span>
                </div>
                {campaign.days_left != null && campaign.days_left >= 0 ? (
                  <div>
                    <strong>{campaign.days_left}</strong>
                    <span>day{campaign.days_left === 1 ? '' : 's'} left</span>
                  </div>
                ) : (
                  <div>
                    <strong><Icon name="refresh" size={15} /></strong>
                    <span>open-ended</span>
                  </div>
                )}
              </div>

              {!closed && (
                <div className="pc-cta-stack">
                  <button className="btn btn-money btn-block btn-lg" onClick={scrollToPay}>
                    <Icon name="heart" size={16} /> Donate
                  </button>
                  <button className="btn btn-outline btn-block" onClick={() => setClaimOpen(true)}>
                    <Icon name="check-circle" size={15} /> Already paid? Verify your payment
                  </button>
                </div>
              )}
              {stats.donors > 0 && (
                <button className="pc-wall-link" onClick={scrollToWall}>
                  <Icon name="users" size={13} /> View the {stats.donors} verified
                  supporter{stats.donors === 1 ? '' : 's'}
                  <Icon name="chevron-down" size={13} />
                </button>
              )}
            </div>

            {/* scan-to-pay card — the Donate button scrolls here */}
            {!closed && (
              <div className="card pc-card pc-pay-card" id="pay">
                <span className="mini-label"><Icon name="qr" size={12} /> Scan to pay</span>
                  <div className="qr-plate">
                    <span className="qr-corner tl" aria-hidden="true" />
                    <span className="qr-corner tr" aria-hidden="true" />
                    <span className="qr-corner bl" aria-hidden="true" />
                    <span className="qr-corner br" aria-hidden="true" />
                    <img src={campaign.qr_url} alt={`Payment QR code for ${campaign.title}`} />
                  </div>
                  <p className="pc-qr-payee">
                    <Icon name="badge-check" size={13} />
                    Pays <strong>{campaign.payee_name}</strong> directly
                  </p>
                  <div className="pc-pay-actions">
                    <a className="btn btn-outline"
                       href={campaign.qr_url} download={`${campaign.slug}-payment-qr.png`}>
                      <Icon name="download" size={15} /> Download QR
                    </a>
                    {upiId && (
                      <button className="btn btn-money-soft" onClick={copyUpi}>
                        <Icon name="copy" size={15} /> Copy UPI ID
                      </button>
                    )}
                  </div>
                  {upiId && (
                    <p className="pc-upi-line">
                      UPI ID: <strong>{upiId}</strong>
                    </p>
                  )}
                  <div className="pc-sep"><span><Icon name="check-circle" size={12} /> After paying</span></div>
                  <button className="btn btn-primary btn-block btn-lg"
                          onClick={() => setClaimOpen(true)}>
                    I've made a payment
                  </button>
                  <p className="pc-help muted">
                    Share your payment screenshot — verified names join the wall.
                  </p>
              </div>
            )}

            <div className="card pc-card pc-share-card">
              <button className="pc-status-link" onClick={() => setStatusOpen(true)}>
                <Icon name="search" size={13} /> Check your claim status
              </button>
              <div className="pc-share">
                <span className="mini-label">Spread the word</span>
                <ShareRow url={publicUrl(campaign.slug)} title={campaign.title} />
              </div>
            </div>
          </div>
        </aside>
      </div>

      {!closed && (
        <div className="pc-sticky-cta">
          <button className="btn btn-primary btn-lg" onClick={() => setClaimOpen(true)}>
            <Icon name="check-circle" size={16} /> I've made a payment
          </button>
        </div>
      )}

      <ClaimModal campaign={campaign} open={claimOpen}
                  onClose={() => setClaimOpen(false)} onSubmitted={load} />
      <StatusModal open={statusOpen} initialRef={params.get('ref') || ''}
                   onClose={() => {
                     setStatusOpen(false)
                     if (params.get('ref')) {
                       const next = new URLSearchParams(params)
                       next.delete('ref')
                       setParams(next, { replace: true })
                     }
                   }} />
    </PublicShell>
  )
}

/* ------------------------------------------------------ donor marquee */

/* Auto-scrolling ticker of verified supporters at the top of the page.
   Tapping it jumps to the wall table. Hidden until someone's verified. */
function DonorMarquee({ campaign, onJump }) {
  const [donors, setDonors] = useState(null)

  useEffect(() => {
    PublicApi.donors(campaign.slug, { sort: 'recent', page: 1 })
      .then((data) => setDonors(data.donors))
      .catch(() => setDonors([]))
  }, [campaign.slug])

  if (!donors || donors.length === 0) return null
  const items = donors.slice(0, 12)

  return (
    <div className="pc-marquee-row">
      <button className="pc-marquee" onClick={onJump}
              aria-label="View all verified supporters">
        <div className="pc-marquee-track"
             style={{ animationDuration: `${Math.max(items.length, 4) * 3.2}s` }}>
          {[0, 1].map((copy) => (
            <div className="pc-marquee-group" key={copy} aria-hidden={copy === 1}>
              {items.map((donor, index) => (
                <span className="pc-marquee-chip" key={`${copy}-${index}`}>
                  <Icon name="heart" size={11} />
                  <strong>{donor.name}</strong>
                  {donor.amount != null && <em>{inr(donor.amount)}</em>}
                </span>
              ))}
            </div>
          ))}
        </div>
      </button>
    </div>
  )
}

/* ------------------------------------------------------- supporter wall */

const WALL_SORTS = [
  { value: 'recent', label: 'Most recent' },
  { value: 'top', label: 'Top contributions' },
]

function SupporterWall({ campaign }) {
  const [sort, setSort] = useState('recent')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState(null)   // donor row → detail sheet

  useEffect(() => {
    PublicApi.donors(campaign.slug, { sort, page })
      .then(setData)
      .catch(() => setData({ donors: [], meta: { page: 1, pages: 1, total: 0 } }))
  }, [campaign.slug, sort, page])

  useEffect(() => { setPage(1) }, [sort])

  return (
    <section className="pc-wall" id="supporters">
      <div className="section-head pc-wall-head">
        <div>
          <h2 className="block-title">
            Supporter wall
            {data && <span className="wall-count">{data.meta.total}</span>}
          </h2>
          <p className="section-sub">Manually verified by the organizer</p>
        </div>
        {campaign.show_amounts && data && data.meta.total > 1 && (
          <Select value={sort} onChange={setSort} options={WALL_SORTS}
                  ariaLabel="Sort supporters" className="select-sm" />
        )}
      </div>

      {!data ? <SkeletonRows rows={3} height={48} /> : data.donors.length === 0 ? (
        <EmptyState icon="heart" title="Be the first supporter">
          Verified contributions appear here with the supporter's name —
          scan the QR, pay, and submit your payment details.
        </EmptyState>
      ) : (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="table wall-table">
              <thead>
                <tr>
                  <th>Supporter</th>
                  {campaign.show_amounts && <th>Amount</th>}
                  <th className="td-msg">Message</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {data.donors.map((donor, index) => (
                  <tr key={`${donor.date}-${index}`} className="wall-row" tabIndex={0}
                      role="button" aria-label={`View contribution from ${donor.name}`}
                      onClick={() => setSelected(donor)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setSelected(donor)
                        }
                      }}>
                    <td data-th="Supporter">
                      <span className="cell-name">
                        <span className="wall-avatar" aria-hidden="true">
                          {donor.name === 'Anonymous'
                            ? <Icon name="users" size={13} />
                            : donor.name.slice(0, 1).toUpperCase()}
                        </span>
                        <strong>{donor.name}</strong>
                        <span className="badge badge-money wall-verified">
                          <Icon name="badge-check" size={11} /> Verified
                        </span>
                      </span>
                    </td>
                    {campaign.show_amounts && (
                      <td data-th="Amount">
                        <strong className="money-text">{donor.amount != null ? inr(donor.amount) : '—'}</strong>
                      </td>
                    )}
                    <td data-th="Message" className="td-msg">
                      {donor.message
                        ? <span className="wall-message">“{donor.message}”</span>
                        : <span className="muted">—</span>}
                    </td>
                    <td data-th="When" className="td-when">
                      <span className="muted">{timeAgo(donor.date)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.meta.pages > 1 && (
            <div className="pager">
              <button className="btn btn-ghost btn-sm" disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}>
                <Icon name="arrow-left" size={14} /> Prev
              </button>
              <span className="muted">Page {data.meta.page} of {data.meta.pages}</span>
              <button className="btn btn-ghost btn-sm" disabled={page >= data.meta.pages}
                      onClick={() => setPage((p) => p + 1)}>
                Next <Icon name="arrow-right" size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      <SupporterModal donor={selected} showAmount={campaign.show_amounts}
                      onClose={() => setSelected(null)} />
    </section>
  )
}

/* Tap a wall row for the full picture — a bottom drawer on phones, a
   centered dialog on desktop (the Modal handles both). */
function SupporterModal({ donor, showAmount, onClose }) {
  return (
    <Modal open={!!donor} onClose={onClose} title="Contribution details">
      {donor && (
        <div className="wall-detail">
          <div className="wall-detail-head">
            <span className="wall-avatar wall-avatar-lg" aria-hidden="true">
              {donor.name === 'Anonymous'
                ? <Icon name="users" size={17} />
                : donor.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="wall-detail-id">
              <strong className="wall-detail-name">{donor.name}</strong>
              <span className="badge badge-money wall-verified">
                <Icon name="badge-check" size={11} /> Verified by the organizer
              </span>
            </div>
          </div>
          <dl className="wall-detail-rows">
            {showAmount && (
              <div>
                <dt>Amount</dt>
                <dd><strong className="money-text">
                  {donor.amount != null ? inr(donor.amount) : '—'}
                </strong></dd>
              </div>
            )}
            <div>
              <dt>When</dt>
              <dd>{timeAgo(donor.date)} · {shortDate(donor.date)}</dd>
            </div>
            {donor.message && (
              <div>
                <dt>Message</dt>
                <dd className="wall-message">“{donor.message}”</dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </Modal>
  )
}

/* ---------------------------------------------------------- claim modal */

function ClaimModal({ campaign, open, onClose, onSubmitted }) {
  const toast = useToast()
  const [form, setForm] = useState({
    donor_name: '', amount: '', message: '',
    transaction_ref: '', payer_id: '', is_anonymous: false,
  })
  const [screenshot, setScreenshot] = useState(null)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState(false)
  const [done, setDone] = useState(null)   // {public_id}
  const honeypotRef = useRef(null)

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }))
  const setInput = (key) => (event) => set(key)(event.target.value)

  const upiId = effectiveUpiId(campaign)
  const copyUpi = async () => {
    try {
      await navigator.clipboard.writeText(upiId)
      toast.success('UPI ID copied — paste it in any UPI app')
    } catch {
      toast.info(upiId)
    }
  }

  /* On screenshot upload, OCR it server-side and prefill anything the donor
     hasn't typed yet — especially the transaction ID. */
  const onScreenshot = (file) => {
    setScreenshot(file)
    setScanned(false)
    if (!file) return
    setScanning(true)
    const body = new FormData()
    body.append('screenshot', file)
    body.append('slug', campaign.slug)
    PublicApi.parseScreenshot(body)
      .then(({ detected }) => {
        const found = detected.transaction_ref || detected.amount || detected.payer_name
        setForm((f) => ({
          ...f,
          donor_name: f.donor_name || detected.payer_name || '',
          transaction_ref: f.transaction_ref || detected.transaction_ref || '',
          amount: f.amount || detected.amount || '',
          payer_id: f.payer_id || detected.payer_id || '',
        }))
        setScanned(!!found)
      })
      .catch(() => {})
      .finally(() => setScanning(false))
  }

  const submit = async (event) => {
    event.preventDefault()
    setErrors({})
    setBusy(true)
    const body = new FormData()
    for (const [key, value] of Object.entries(form)) body.append(key, value)
    body.set('is_anonymous', form.is_anonymous ? 'true' : 'false')
    if (screenshot) body.append('screenshot', screenshot)
    body.append('website', honeypotRef.current?.value || '')
    try {
      const data = await PublicApi.donate(campaign.slug, body)
      setDone(data.donation)
      onSubmitted()
    } catch (err) {
      setErrors(err.fields || {})
      if (!err.fields) toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    onClose()
    if (done) {
      setDone(null)
      setForm({ donor_name: '', amount: '', message: '',
                transaction_ref: '', payer_id: '', is_anonymous: false })
      setScreenshot(null)
      setScanned(false)
    }
  }

  return (
    <Modal open={open} onClose={close} title={done ? 'Claim submitted' : 'Submit your payment details'}>
      {done ? (
        <div className="claim-done">
          <span className="claim-done-icon"><Icon name="check-circle" size={30} /></span>
          <p className="modal-text">
            Thanks{form.donor_name ? `, ${form.donor_name.split(' ')[0]}` : ''}! Once the
            organizer verifies your payment, your name joins the supporter wall — and your
            receipt becomes available from “Check your claim status”.
          </p>
          <Field label="Your reference code — save it for status &amp; receipt">
            <CopyField value={done.public_id} />
          </Field>
          <div className="form-nav">
            <span />
            <button className="btn btn-primary" onClick={close}>Done</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <section className="modal-section">
            <div className="modal-section-head">
              <span className="msh-num">1</span>
              <div>
                <h4 className="msh-title">Who is contributing?</h4>
              </div>
            </div>
            <div className="form-row">
              <Field label="Your name" required error={errors.donor_name}>
                <input className="input" value={form.donor_name} maxLength={60}
                       onChange={setInput('donor_name')} placeholder="Name on the wall" />
              </Field>
              <Field label="Amount you paid (₹)" required error={errors.amount}>
                <input className="input" inputMode="decimal" value={form.amount}
                       onChange={setInput('amount')} placeholder="e.g. 500" />
              </Field>
            </div>
            <AmountChips current={form.amount} onPick={set('amount')} />
            {upiId && (
              <button type="button" className="btn btn-money-soft btn-block" onClick={copyUpi}>
                <Icon name="copy" size={15} /> Copy UPI ID — pay in your app
              </button>
            )}
          </section>

          <section className="modal-section">
            <div className="modal-section-head">
              <span className="msh-num">2</span>
              <div>
                <h4 className="msh-title">Proof of payment</h4>
                <p className="msh-sub">Upload the screenshot — details fill in automatically.</p>
              </div>
            </div>
            <ImageInput label="Payment screenshot" value={screenshot} onChange={onScreenshot}
                        error={errors.screenshot}
                        hint="Visible only to the organizer." />
            {scanning && (
              <p className="ocr-note"><Spinner size={12} /> Reading screenshot…</p>
            )}
            {scanned && !scanning && (
              <p className="ocr-note ocr-ok">
                <Icon name="check-circle" size={13} /> Details filled — please verify.
              </p>
            )}
            <div className="claim-or"><span>or</span></div>
            <Field label="UPI transaction ID" error={errors.transaction_ref}
                   hint="Needed if you'd like a receipt once the organizer verifies.">
              <input className="input" value={form.transaction_ref} maxLength={64}
                     onChange={setInput('transaction_ref')} placeholder="e.g. 415023456789" />
            </Field>
            <Field label="Your UPI ID or phone number (optional)" error={errors.payer_id}
                   hint="Only the organizer sees this — helps match your payment.">
              <input className="input" value={form.payer_id} maxLength={64}
                     onChange={setInput('payer_id')} placeholder="e.g. name@okaxis or 98XXXXXXXX" />
            </Field>
          </section>

          <section className="modal-section">
            <div className="modal-section-head">
              <span className="msh-num">3</span>
              <div>
                <h4 className="msh-title">Say something (optional)</h4>
              </div>
            </div>
            <Field label="Message of support" error={errors.message} hint="Shown on the wall.">
              <input className="input" value={form.message} maxLength={280}
                     onChange={setInput('message')} placeholder="Wishing you all the best" />
            </Field>
            <Check checked={form.is_anonymous} onChange={set('is_anonymous')}>
              Hide my name on the public wall (show as “Anonymous”)
            </Check>
          </section>

          {/* Honeypot — humans never see or fill this. */}
          <input ref={honeypotRef} type="text" name="website" tabIndex={-1}
                 autoComplete="off" className="hp-field" aria-hidden="true" />
          <div className="form-nav">
            <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
              {busy ? <Spinner size={15} /> : <>Submit for verification <Icon name="send" size={14} /></>}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}

/* --------------------------------------------------------- status modal */

const STATUS_COPY = {
  pending: { icon: 'clock', cls: 'badge-warn', label: 'Pending verification',
             body: 'The organizer hasn\'t reviewed this claim yet. Check back soon.' },
  confirmed: { icon: 'check-circle', cls: 'badge-money', label: 'Confirmed',
               body: 'Verified by the organizer — this contribution is on the supporter wall.' },
  rejected: { icon: 'x', cls: 'badge-danger', label: 'Not verified',
              body: 'The organizer could not match this claim to a payment.' },
}

function StatusModal({ open, initialRef, onClose }) {
  const [ref, setRef] = useState(initialRef)
  const [results, setResults] = useState(null)   // array once searched
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { setRef(initialRef) }, [initialRef])

  const lookup = async (event) => {
    event?.preventDefault()
    if (!ref.trim()) return
    setBusy(true)
    setError('')
    setResults(null)
    try {
      const data = await PublicApi.lookup(ref.trim())
      setResults(data.donations)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Check your claim status"
           subtitle="Find it with whatever you have — nothing else needed.">
      <form onSubmit={lookup} noValidate>
        <Field label="Reference code, UPI transaction ID, or your UPI ID / phone"
               hint="e.g. G7KM24QZ · 415023456789 · name@okaxis · 98XXXXXXXX">
          <div className="status-lookup">
            <input className="input" value={ref} onChange={(e) => setRef(e.target.value)}
                   placeholder="Enter any of these" maxLength={64} />
            <button className="btn btn-primary" disabled={busy || !ref.trim()}>
              {busy ? <Spinner size={14} /> : 'Check'}
            </button>
          </div>
        </Field>
      </form>
      {error && <div className="alert alert-danger"><Icon name="alert" size={15} />{error}</div>}
      {results && results.length === 0 && (
        <div className="alert alert-warn">
          <Icon name="info" size={15} />
          No claim matches that — double-check the code, transaction ID or UPI ID/phone
          you submitted with.
        </div>
      )}
      {(results || []).map((result) => {
        const meta = STATUS_COPY[result.status]
        return (
          <div className="status-result" key={result.public_id}>
            <span className={`badge ${meta.cls}`}>
              <Icon name={meta.icon} size={12} /> {meta.label}
            </span>
            <p className="modal-text">
              <strong>{inr(result.amount)}</strong> from <strong>{result.donor_name}</strong> to
              “{result.campaign_title}” · submitted {timeAgo(result.created_at)}
              {result.reviewed_at && <> · reviewed {timeAgo(result.reviewed_at)}</>}
            </p>
            <p className="muted">{meta.body}</p>
            {result.status === 'confirmed' && (
              <a className="btn btn-money-soft btn-sm" target="_blank" rel="noreferrer"
                 href={PublicApi.receiptUrl(result.public_id)}>
                <Icon name="download" size={14} /> Download receipt
              </a>
            )}
            {result.status === 'rejected' && result.review_note && (
              <div className="callout">
                <Icon name="info" size={14} />
                <p>Organizer's note: “{result.review_note}”</p>
              </div>
            )}
          </div>
        )
      })}
    </Modal>
  )
}
