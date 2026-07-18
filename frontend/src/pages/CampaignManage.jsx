import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { CampaignApi, PublicApi } from '../api.js'
import { Check, CopyField, EmptyState, Field, ImageInput, ProgressBar,
         SkeletonRows, Spinner, StatusBadge } from '../components/bits.jsx'
import { CropperModal } from '../components/Cropper.jsx'
import { MarkdownText } from '../components/Markdown.jsx'
import { StoryEditor } from '../components/StoryEditor.jsx'
import { DonationsChart } from '../components/DonationsChart.jsx'
import { Icon } from '../components/Icon.jsx'
import { Modal } from '../components/Modal.jsx'
import { Select } from '../components/Select.jsx'
import { ShareRow } from '../components/ShareRow.jsx'
import { AppShell } from '../components/Shells.jsx'
import { useToast } from '../ctx/ToastContext.jsx'
import { dateTime, inr, publicUrl, shortDate, timeAgo } from '../format.js'

const TABS = [
  { key: 'overview', label: 'Overview', icon: 'chart' },
  { key: 'verify', label: 'Verify', icon: 'badge-check' },
  { key: 'donations', label: 'Contributions', icon: 'users' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
]

export default function CampaignManage() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const toast = useToast()
  const tab = params.get('tab') || 'overview'

  const [campaign, setCampaign] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [error, setError] = useState('')
  const [proofOf, setProofOf] = useState(null)      // donation whose proof is open
  const [rejecting, setRejecting] = useState(null)  // donation being rejected
  const [editing, setEditing] = useState(null)      // donation being edited
  const [adding, setAdding] = useState(false)       // manual-contribution modal
  const [listVersion, setListVersion] = useState(0) // bump → verify/table reload

  const load = useCallback(() => {
    CampaignApi.analytics(id)
      .then((data) => { setCampaign(data.campaign); setAnalytics(data.analytics) })
      .catch((err) => setError(err.status === 404 ? 'Fundraiser not found.' : err.message))
  }, [id])

  useEffect(() => { load() }, [load])

  const setTab = (key) => {
    const nextParams = new URLSearchParams(params)
    nextParams.set('tab', key)
    nextParams.delete('created')
    setParams(nextParams, { replace: true })
  }

  const onStatsChange = (stats) => {
    setCampaign((c) => (c ? { ...c, stats } : c))
    load()
  }

  if (error) {
    return (
      <AppShell>
        <EmptyState icon="alert" title={error}
          action={<Link className="btn btn-primary" to="/dashboard">Back to dashboard</Link>} />
      </AppShell>
    )
  }

  return (
    <AppShell>
      {!campaign ? <SkeletonRows rows={3} height={120} /> : (
        <>
          {params.get('created') && (
            <div className="alert alert-money">
              <Icon name="sparkle" size={15} />
              Your fundraiser is live! Share the link below to start receiving support.
            </div>
          )}
          <header className="card manage-hero">
            <div className="manage-hero-top">
              <div className="manage-title-block">
                <div className="manage-meta">
                  <StatusBadge status={campaign.status} />
                  <span className="meta-chip">{campaign.category_label}</span>
                  <span className="meta-chip">
                    <Icon name="clock" size={11} /> created {timeAgo(campaign.created_at)}
                  </span>
                </div>
                <h1 className="page-title">{campaign.title}</h1>
                {campaign.tagline && <p className="page-sub">{campaign.tagline}</p>}
              </div>
              <div className="manage-actions">
                <a className="btn btn-outline" href={`/c/${campaign.slug}`} target="_blank" rel="noreferrer">
                  <Icon name="external" size={14} /> View public page
                </a>
              </div>
            </div>
            <div className="manage-share">
              <div className="manage-share-link">
                <span className="mini-label">Share link</span>
                <CopyField value={publicUrl(campaign.slug)} />
              </div>
              <div className="manage-share-social">
                <span className="mini-label">Share on</span>
                <ShareRow url={publicUrl(campaign.slug)} title={campaign.title} />
              </div>
            </div>
          </header>

          <div className="tabs" role="tablist" aria-label="Campaign sections">
            {TABS.map((item) => (
              <button key={item.key} role="tab" aria-selected={tab === item.key}
                      className={`tab ${tab === item.key ? 'is-active' : ''}`}
                      onClick={() => setTab(item.key)}>
                <Icon name={item.icon} size={15} /> {item.label}
                {item.key === 'verify' && campaign.stats.pending > 0 && (
                  <span className="tab-badge">{campaign.stats.pending}</span>
                )}
              </button>
            ))}
          </div>

          {tab === 'overview' && <Overview campaign={campaign} analytics={analytics} />}
          {tab === 'verify' && (
            <VerifyQueue campaignId={campaign.id} onStatsChange={onStatsChange}
                         openProof={setProofOf} openReject={setRejecting}
                         openEdit={setEditing} refresh={listVersion} />
          )}
          {tab === 'donations' && (
            <DonationsTable campaignId={campaign.id} onStatsChange={onStatsChange}
                            openProof={setProofOf} openReject={setRejecting}
                            openEdit={setEditing} refresh={listVersion}
                            openAdd={() => setAdding(true)} />
          )}
          {tab === 'settings' && (
            <SettingsTab campaign={campaign}
                         onSaved={(c, opts) => {
                           setCampaign(c)
                           if (!opts?.silent) toast.success('Saved')
                         }} />
          )}

          <ProofModal donation={proofOf} onClose={() => setProofOf(null)} />
          <RejectModal donation={rejecting} onClose={() => setRejecting(null)}
                       onDone={(stats) => {
                         setRejecting(null)
                         onStatsChange(stats)
                         setListVersion((v) => v + 1)
                       }} />
          <EditModal donation={editing} onClose={() => setEditing(null)}
                     onDone={(stats) => {
                       setEditing(null)
                       onStatsChange(stats)
                       setListVersion((v) => v + 1)
                     }} />
          <AddModal campaignId={campaign.id} campaignSlug={campaign.slug}
                    open={adding} onClose={() => setAdding(false)}
                    onDone={(stats) => {
                      setAdding(false)
                      onStatsChange(stats)
                      setListVersion((v) => v + 1)
                    }} />
        </>
      )}
    </AppShell>
  )
}

/* ------------------------------------------------------------- overview */

function Overview({ campaign, analytics }) {
  if (!analytics) return <SkeletonRows rows={2} height={140} />
  return (
    <>
      <div className="overview-grid">
        <div className="card overview-hero">
          <span className="mini-label">Raised so far</span>
          <div className="overview-raised">
            <span className="overview-amount">{inr(analytics.raised)}</span>
            <span className="overview-goal">of {inr(analytics.goal)} goal</span>
          </div>
          <ProgressBar value={analytics.progress} />
          <div className="overview-foot">
            <span><strong>{analytics.progress}%</strong> funded</span>
            <span><strong>{analytics.donors}</strong> supporter{analytics.donors === 1 ? '' : 's'}</span>
            {analytics.days_left != null && analytics.days_left >= 0 && (
              <span><strong>{analytics.days_left}</strong> day{analytics.days_left === 1 ? '' : 's'} left</span>
            )}
          </div>
        </div>
        <div className="stat-row">
          <StatMini label="Verified supporters" value={analytics.donors} icon="users" />
          <StatMini label="Pending claims" value={analytics.pending} icon="clock" warn={analytics.pending > 0} />
          <StatMini label="Average contribution" value={inr(analytics.average)} icon="wallet" />
          <StatMini label="Top contribution" value={inr(analytics.top)} icon="sparkle" />
          <StatMini label="Page views" value={analytics.views} icon="eye"
                    foot={`${analytics.conversion}% become supporters`} />
        </div>
      </div>

      <div className="card chart-card">
        <div className="section-head">
          <div>
            <h2 className="block-title">Contribution trend</h2>
            <p className="section-sub">Confirmed contributions per day — last 30 days</p>
          </div>
        </div>
        <DonationsChart series={analytics.series} />
      </div>

      {analytics.recent.length > 0 && (
        <div className="card">
          <h2 className="block-title">Latest claims</h2>
          <ul className="activity">
            {analytics.recent.map((donation) => (
              <li key={donation.id} className="activity-row">
                <span className="activity-who">
                  <strong>{donation.donor_name}</strong>
                  <span className="muted"> · ref {donation.public_id}</span>
                </span>
                <span className="activity-meta">
                  <strong className="money-text">{inr(donation.amount)}</strong>
                  <StatusBadge status={donation.status} />
                  <span className="muted activity-time">{timeAgo(donation.created_at)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

function StatMini({ label, value, icon, foot, warn }) {
  return (
    <div className={`card stat-tile ${warn ? 'stat-warn' : ''}`}>
      <span className="stat-head">
        <span className="stat-icon"><Icon name={icon} size={15} /></span>
        <span className="stat-label">{label}</span>
      </span>
      <span className="stat-value">{value}</span>
      {foot && <span className="stat-foot">{foot}</span>}
    </div>
  )
}

/* --------------------------------------------------------------- verify */

function VerifyQueue({ campaignId, onStatsChange, openProof, openReject, openEdit, refresh }) {
  const toast = useToast()
  const [items, setItems] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(() => {
    CampaignApi.donations(campaignId, { status: 'pending', page_size: 50 })
      .then((data) => setItems(data.donations))
      .catch((err) => toast.error(err.message))
  }, [campaignId, toast, refresh])

  useEffect(() => { load() }, [load])

  const confirm = async (donation) => {
    setBusyId(donation.id)
    try {
      const data = await CampaignApi.review(donation.id, 'confirm')
      toast.success(`Confirmed ${inr(donation.amount)} from ${donation.donor_name}`)
      setItems((list) => list.filter((d) => d.id !== donation.id))
      onStatsChange(data.campaign_stats)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusyId(null)
    }
  }

  if (!items) return <SkeletonRows rows={3} height={100} />
  if (items.length === 0) {
    return <EmptyState icon="badge-check" title="All caught up!">
      New payment claims from supporters will appear here for you to verify
      against your account statement.
    </EmptyState>
  }

  return (
    <div className="verify-list">
      <div className="callout">
        <Icon name="shield" size={16} />
        <p>Match each claim against your UPI app or bank statement before confirming.
           Confirmed names appear on the public supporter wall immediately.</p>
      </div>
      {items.map((donation) => (
        <article className="card verify-card" key={donation.id}>
          <div className="verify-main">
            <div className="verify-id">
              <strong className="verify-name">{donation.donor_name}</strong>
              {donation.is_anonymous && <span className="badge badge-muted">Anonymous publicly</span>}
              <span className="muted">{dateTime(donation.created_at)}</span>
            </div>
            <strong className="verify-amount money-text">{inr(donation.amount)}</strong>
          </div>
          <div className="verify-proofs">
            <span className="proof-chip" title="Reference code">
              <Icon name="link" size={12} /> {donation.public_id}
            </span>
            {donation.transaction_ref && (
              <span className={`proof-chip ${donation.duplicate_ref ? 'proof-dupe' : ''}`}
                    title="UPI transaction ID">
                <Icon name={donation.duplicate_ref ? 'alert' : 'qr'} size={12} />
                {donation.transaction_ref}
                {donation.duplicate_ref && <em>duplicate</em>}
              </span>
            )}
            {donation.payer_id && (
              <span className="proof-chip" title="Donor's UPI ID / phone">
                <Icon name="wallet" size={12} /> {donation.payer_id}
              </span>
            )}
            {donation.has_screenshot && (
              <button className="proof-chip proof-link" onClick={() => openProof(donation)}>
                <Icon name="camera" size={12} /> View screenshot
              </button>
            )}
          </div>
          {donation.duplicate_ref && (
            <p className="verify-dupe">
              <Icon name="alert" size={13} /> This transaction ID also appears on another
              claim of this fundraiser — check your statement before confirming.
            </p>
          )}
          {donation.message && <p className="verify-message">“{donation.message}”</p>}
          <div className="verify-actions">
            <button className="btn btn-money" disabled={busyId === donation.id}
                    onClick={() => confirm(donation)}>
              {busyId === donation.id ? <Spinner size={14} /> : <><Icon name="check" size={15} /> Confirm payment</>}
            </button>
            <button className="btn btn-outline-danger" disabled={busyId === donation.id}
                    onClick={() => openReject(donation)}>
              <Icon name="x" size={15} /> Reject
            </button>
            <button className="btn btn-ghost" disabled={busyId === donation.id}
                    onClick={() => openEdit(donation)}>
              <Icon name="edit" size={14} /> Edit
            </button>
          </div>
        </article>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------ donations */

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'rejected', label: 'Rejected' },
]

function DonationsTable({ campaignId, onStatsChange, openProof, openReject, openEdit, refresh, openAdd }) {
  const toast = useToast()
  const [status, setStatus] = useState('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const search = useMemo(() => query.trim(), [query])

  useEffect(() => {
    const timer = setTimeout(() => {
      CampaignApi.donations(campaignId, { status, q: search, page })
        .then(setData)
        .catch((err) => toast.error(err.message))
    }, search ? 250 : 0)
    return () => clearTimeout(timer)
  }, [campaignId, status, search, page, toast, refresh])

  useEffect(() => { setPage(1) }, [status, search])

  const act = async (donation, action) => {
    setBusyId(donation.id)
    try {
      const result = await CampaignApi.review(donation.id, action)
      setData((d) => ({
        ...d,
        donations: d.donations.map((row) => (row.id === donation.id ? result.donation : row)),
      }))
      onStatsChange(result.campaign_stats)
      toast.success(action === 'confirm' ? 'Payment confirmed' : 'Moved back to pending')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="card table-card">
      <div className="table-tools">
        <div className="table-filters">
          <Select value={status} onChange={setStatus} options={STATUS_OPTIONS}
                  ariaLabel="Filter by status" className="select-sm" />
          <div className="search-box">
            <Icon name="search" size={15} />
            <input className="input input-search" value={query} placeholder="Search name, email, ref…"
                   onChange={(e) => setQuery(e.target.value)} aria-label="Search contributions" />
          </div>
        </div>
        <div className="table-filters">
          <button className="btn btn-primary btn-sm" onClick={openAdd}>
            <Icon name="plus" size={14} /> Add manually
          </button>
          <a className="btn btn-outline btn-sm" href={CampaignApi.exportUrl(campaignId)}>
            <Icon name="download" size={14} /> Export CSV
          </a>
        </div>
      </div>

      {!data ? <SkeletonRows rows={4} height={44} /> : data.donations.length === 0 ? (
        <EmptyState icon="inbox" title="No contributions match" >
          {status !== 'all' || search ? 'Try changing the filters.' :
            'Share your fundraiser link to start receiving support.'}
        </EmptyState>
      ) : (
        <>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Supporter</th><th>Amount</th><th>Proof</th><th>Status</th>
                  <th>Date</th><th className="th-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.donations.map((donation) => (
                  <tr key={donation.id}>
                    <td data-th="Supporter">
                      <span className="cell-name">
                        <strong>{donation.donor_name}</strong>
                        {donation.is_anonymous && <span className="badge badge-muted">anon</span>}
                      </span>
                      <span className="cell-sub">{donation.payer_id || donation.donor_email || `ref ${donation.public_id}`}</span>
                    </td>
                    <td data-th="Amount"><strong className="money-text">{inr(donation.amount)}</strong></td>
                    <td data-th="Proof">
                      <span className="cell-proofs">
                        {donation.transaction_ref && (
                          <span className={`proof-chip ${donation.duplicate_ref ? 'proof-dupe' : ''}`}
                                title={donation.duplicate_ref
                                  ? `${donation.transaction_ref} — this transaction ID appears on more than one claim`
                                  : donation.transaction_ref}>
                            <Icon name={donation.duplicate_ref ? 'alert' : 'qr'} size={11} />
                            {truncate(donation.transaction_ref, 14)}
                            {donation.duplicate_ref && <em>duplicate</em>}
                          </span>
                        )}
                        {donation.has_screenshot && (
                          <button className="proof-chip proof-link" onClick={() => openProof(donation)}>
                            <Icon name="camera" size={11} /> Screenshot
                          </button>
                        )}
                        {!donation.transaction_ref && !donation.has_screenshot && <span className="muted">—</span>}
                      </span>
                    </td>
                    <td data-th="Status">
                      <StatusBadge status={donation.status} />
                      {donation.status === 'rejected' && donation.review_note && (
                        <span className="cell-sub" title={donation.review_note}>
                          {truncate(donation.review_note, 26)}
                        </span>
                      )}
                    </td>
                    <td data-th="Date"><span className="muted">{dateTime(donation.created_at)}</span></td>
                    <td data-th="Actions" className="td-actions">
                      {donation.status === 'pending' ? (
                        <>
                          <button className="btn btn-money btn-sm" disabled={busyId === donation.id}
                                  onClick={() => act(donation, 'confirm')}>
                            <Icon name="check" size={13} /> Confirm
                          </button>
                          <button className="btn btn-outline-danger btn-sm" disabled={busyId === donation.id}
                                  onClick={() => openReject(donation)}>
                            Reject
                          </button>
                        </>
                      ) : (
                        <button className="btn btn-ghost btn-sm" disabled={busyId === donation.id}
                                onClick={() => act(donation, 'pending')}>
                          <Icon name="refresh" size={13} /> Re-review
                        </button>
                      )}
                      <button className="btn btn-ghost btn-sm" disabled={busyId === donation.id}
                              onClick={() => openEdit(donation)} title="Edit claim details"
                              aria-label={`Edit claim from ${donation.donor_name}`}>
                        <Icon name="edit" size={13} />
                      </button>
                      {donation.status === 'confirmed' && (
                        <a className="btn btn-ghost btn-sm" target="_blank" rel="noreferrer"
                           href={PublicApi.receiptUrl(donation.public_id)}
                           title="Download receipt"
                           aria-label={`Download receipt for ${donation.donor_name}`}>
                          <Icon name="download" size={13} />
                        </a>
                      )}
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
              <span className="muted">Page {data.meta.page} of {data.meta.pages} · {data.meta.total} total</span>
              <button className="btn btn-ghost btn-sm" disabled={page >= data.meta.pages}
                      onClick={() => setPage((p) => p + 1)}>
                Next <Icon name="arrow-right" size={14} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const truncate = (text, n) => (text.length > n ? text.slice(0, n - 1) + '…' : text)

/* -------------------------------------------------------------- settings */

/* --------------------------------------------- how the money is used */

/* Headed photo groups shown on the public page under the story — receipts
   of the work itself: buying, transporting, distributing. */
function FundUsageCard({ campaign, onSaved }) {
  const toast = useToast()
  const [heading, setHeading] = useState('')
  const [photos, setPhotos] = useState([])
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const pickRef = useRef(null)

  const items = campaign.fund_uses || []
  const full = items.length >= 8

  const pickPhotos = (fileList) => {
    const files = [...(fileList || [])].filter((f) => f.type.startsWith('image/'))
    if (pickRef.current) pickRef.current.value = ''
    if (!files.length) return
    setPhotos((prev) => [...prev, ...files].slice(0, 6))
  }

  const add = async (event) => {
    event.preventDefault()
    setBusy(true)
    setErrors({})
    const body = new FormData()
    body.append('heading', heading)
    for (const photo of photos) body.append('images', photo)
    try {
      const data = await CampaignApi.addFundUse(campaign.id, body)
      onSaved(data.campaign, { silent: true })
      toast.success('Added — it’s on the public page')
      setHeading('')
      setPhotos([])
    } catch (err) {
      setErrors(err.fields || {})
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="section-head">
        <div>
          <h2 className="block-title">Where your support goes</h2>
          <p className="section-sub">
            Headed photo groups shown under your story — e.g. “Purchasing
            cabbage from farmers” with pictures of the purchase.
          </p>
        </div>
      </div>

      {items.map((item) => (
        <FundUseRow key={item.id} item={item} campaign={campaign} onSaved={onSaved} />
      ))}

      {full ? (
        <p className="muted">Up to 8 headings — remove one to add another.</p>
      ) : (
        <form onSubmit={add} noValidate className="fund-use-form">
          <Field label="New heading" required error={errors.heading}>
            <input className="input" value={heading} maxLength={120}
                   onChange={(e) => setHeading(e.target.value)}
                   placeholder="e.g. Purchasing cabbage from farmers" />
          </Field>
          <div className="field">
            <span className="field-label">Photos (up to 6)</span>
            <div className="fund-use-picks">
              {photos.map((file, index) => (
                <span className="fund-use-pick" key={index}>
                  <img src={URL.createObjectURL(file)} alt="" />
                  <button type="button" className="fund-use-pick-x"
                          aria-label="Remove this photo"
                          onClick={() => setPhotos((p) => p.filter((_, i) => i !== index))}>
                    <Icon name="x" size={11} />
                  </button>
                </span>
              ))}
              {photos.length < 6 && (
                <button type="button" className="fund-use-pick-add"
                        onClick={() => pickRef.current?.click()}>
                  <Icon name="plus" size={16} />
                  <span>Add photos</span>
                </button>
              )}
            </div>
            {errors.image && <span className="field-error">{errors.image}</span>}
            <input ref={pickRef} type="file" accept="image/*" multiple hidden
                   onChange={(e) => pickPhotos(e.target.files)} />
          </div>
          <div className="form-nav">
            <span />
            <button type="submit" className="btn btn-primary"
                    disabled={busy || !heading.trim() || photos.length === 0}>
              {busy ? <Spinner size={14} /> : <><Icon name="plus" size={14} /> Add heading</>}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function FundUseRow({ item, campaign, onSaved }) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [heading, setHeading] = useState(item.heading)
  const [busy, setBusy] = useState(false)
  const addRef = useRef(null)

  const run = async (action, okMsg) => {
    setBusy(true)
    try {
      const data = await action()
      onSaved(data.campaign, { silent: true })
      if (okMsg) toast.success(okMsg)
      return true
    } catch (err) {
      toast.error(err.fields?.heading || err.fields?.image || err.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const saveHeading = async () => {
    const body = new FormData()
    body.append('heading', heading)
    if (await run(() => CampaignApi.updateFundUse(campaign.id, item.id, body),
                  'Heading updated')) {
      setEditing(false)
    }
  }

  const addPhotos = async (fileList) => {
    const files = [...(fileList || [])].filter((f) => f.type.startsWith('image/'))
    if (addRef.current) addRef.current.value = ''
    if (!files.length) return
    const body = new FormData()
    for (const file of files) body.append('images', file)
    run(() => CampaignApi.updateFundUse(campaign.id, item.id, body),
        `Photo${files.length === 1 ? '' : 's'} added`)
  }

  return (
    <div className="fund-use-group">
      <div className="fund-use-head">
        {editing ? (
          <>
            <input className="input" value={heading} maxLength={120} autoFocus
                   onChange={(e) => setHeading(e.target.value)} />
            <button className="btn btn-primary btn-sm" disabled={busy || !heading.trim()}
                    onClick={saveHeading}>
              {busy ? <Spinner size={13} /> : 'Save'}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busy}
                    onClick={() => { setEditing(false); setHeading(item.heading) }}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <strong>{item.heading}</strong>
            <button className="icon-btn" onClick={() => setEditing(true)}
                    aria-label={`Edit heading “${item.heading}”`}>
              <Icon name="edit" size={14} />
            </button>
            <button className="icon-btn" disabled={busy}
                    onClick={() => run(() => CampaignApi.removeFundUse(campaign.id, item.id),
                                       'Heading removed')}
                    aria-label={`Remove “${item.heading}” and its photos`}>
              {busy ? <Spinner size={13} /> : <Icon name="trash" size={14} />}
            </button>
          </>
        )}
      </div>
      <div className="fund-use-thumbs">
        {(item.images || []).map((img) => (
          <span className="fund-use-pick" key={img.id}>
            <img src={img.url} alt="" />
            <button type="button" className="fund-use-pick-x" disabled={busy}
                    aria-label="Remove this photo"
                    onClick={() => run(
                      () => CampaignApi.removeFundUseImage(campaign.id, item.id, img.id),
                      'Photo removed')}>
              <Icon name="x" size={11} />
            </button>
          </span>
        ))}
        {(item.images || []).length < 6 && (
          <button type="button" className="fund-use-pick-add" disabled={busy}
                  onClick={() => addRef.current?.click()}>
            <Icon name="plus" size={16} />
            <span>Add</span>
          </button>
        )}
        <input ref={addRef} type="file" accept="image/*" multiple hidden
               onChange={(e) => addPhotos(e.target.files)} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------ impact settings */

const IMPACT_MODES = [
  { value: 'auto', label: 'Automatically from verified funds' },
  { value: 'manual', label: 'Updated manually' },
]
const IMPACT_BASES = [
  { value: 'eligible', label: 'Eligible funds after expenses' },
  { value: 'all', label: 'All verified funds' },
  { value: 'percent', label: 'Percentage of verified funds' },
]
const IMPACT_VIEWS = [
  { value: 'funds', label: 'Funds' },
  { value: 'impact', label: 'Impact' },
]

/* "₹1,68,075 raised" can also read "12,450 kg secured" — organizers
   configure what a rupee translates to in the real world. */
function ImpactSettingsCard({ campaign, onSaved }) {
  const toast = useToast()
  const s = campaign.impact_settings
  const [form, setForm] = useState(() => ({
    impact_enabled: s.impact_enabled,
    impact_item: s.impact_item, impact_unit: s.impact_unit,
    impact_action: s.impact_action,
    impact_target: s.impact_target ? String(s.impact_target) : '',
    impact_mode: s.impact_mode,
    impact_conv_rupees: s.impact_conv_rupees ? String(s.impact_conv_rupees) : '',
    impact_conv_units: s.impact_conv_units ? String(s.impact_conv_units) : '1',
    impact_funds_basis: s.impact_funds_basis,
    impact_expenses: s.impact_expenses ? String(s.impact_expenses) : '',
    impact_funds_percent: String(s.impact_funds_percent || 100),
    impact_manual_value: s.impact_manual_value ? String(s.impact_manual_value) : '',
    impact_default_view: s.impact_default_view,
    impact_completed_enabled: s.impact_completed_enabled,
    impact_completed_action: s.impact_completed_action,
    impact_completed_qty: s.impact_completed_qty ? String(s.impact_completed_qty) : '',
  }))
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }))
  const input = (key, extra = {}, onChange = null) => (
    <input className="input" value={form[key]} {...extra}
           onChange={(e) => (onChange || set(key))(e.target.value)} />
  )

  /* Target and conversion are two views of the same equation against the
     ₹ goal — whichever the organizer edits drives the other. */
  const goal = campaign.stats.goal
  const round2 = (value) => Math.round(value * 100) / 100
  const setTarget = (raw) => setForm((f) => {
    const next = { ...f, impact_target: raw }
    const target = parseFloat(raw)
    const units = parseFloat(f.impact_conv_units) || 1
    if (goal > 0 && target > 0) {
      next.impact_conv_rupees = String(round2((goal * units) / target))
    }
    return next
  })
  const setConversion = (key) => (raw) => setForm((f) => {
    const next = { ...f, [key]: raw }
    const rupees = parseFloat(next.impact_conv_rupees)
    const units = parseFloat(next.impact_conv_units) || 1
    if (goal > 0 && rupees > 0) {
      next.impact_target = String(round2((goal / rupees) * units))
    }
    return next
  })

  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    setErrors({})
    const body = new FormData()
    for (const [key, value] of Object.entries(form)) {
      if (typeof value === 'boolean') body.append(key, value ? 'true' : 'false')
      else body.append(key, value)
    }
    try {
      const data = await CampaignApi.update(campaign.id, body)
      onSaved(data.campaign)
      toast.success('Impact tracking saved')
    } catch (err) {
      setErrors(err.fields || {})
      // always toast — a field error may sit in a section that's collapsed
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  const unit = form.impact_unit || 'units'
  return (
    <div className="card">
      <div className="section-head">
        <div>
          <h2 className="block-title">Impact tracking</h2>
          <p className="section-sub">
            Show supporters what the money becomes — e.g. “12,450 kg of cabbage secured”.
          </p>
        </div>
      </div>
      <form onSubmit={save} noValidate>
        <Check checked={form.impact_enabled} onChange={set('impact_enabled')}>
          Enable impact tracking
        </Check>

        {form.impact_enabled && (
          <div className="impact-fields">
            <div className="form-row">
              <Field label="Impact item" required error={errors.impact_item}
                     hint="What the funds provide.">
                {input('impact_item', { maxLength: 40, placeholder: 'e.g. Cabbage' })}
              </Field>
              <Field label="Unit" required error={errors.impact_unit}>
                {input('impact_unit', { maxLength: 20, placeholder: 'e.g. kg' })}
              </Field>
            </div>
            <div className="form-row">
              <Field label="Action word" required error={errors.impact_action}
                     hint="Reads as “12,450 kg secured”.">
                {input('impact_action', { maxLength: 30, placeholder: 'e.g. secured' })}
              </Field>
              <Field label={`Impact target (${unit})`} required error={errors.impact_target}
                     hint={`Linked to your ${inr(goal)} goal — typing here sets the conversion.`}>
                {input('impact_target', { inputMode: 'decimal', placeholder: 'e.g. 75000' },
                       setTarget)}
              </Field>
            </div>

            <Field label="How should impact be calculated?" error={errors.impact_mode}>
              <Select value={form.impact_mode} onChange={set('impact_mode')}
                      options={IMPACT_MODES} ariaLabel="Impact calculation mode" />
            </Field>

            {form.impact_mode === 'auto' ? (
              <>
                <div className="field">
                  <span className="field-label">Conversion</span>
                  <div className="impact-conv">
                    <span>₹</span>
                    {input('impact_conv_rupees', { inputMode: 'decimal', placeholder: '13' },
                           setConversion('impact_conv_rupees'))}
                    <span>provides</span>
                    {input('impact_conv_units', { inputMode: 'decimal', placeholder: '1' },
                           setConversion('impact_conv_units'))}
                    <span>{unit}</span>
                  </div>
                  {errors.impact_conv_rupees || errors.impact_conv_units ? (
                    <span className="field-error">
                      {errors.impact_conv_rupees || errors.impact_conv_units}
                    </span>
                  ) : (
                    <span className="field-hint">
                      Typing here sets the impact target instead.
                    </span>
                  )}
                </div>
                <Field label="Which funds count?" error={errors.impact_funds_basis}>
                  <Select value={form.impact_funds_basis} onChange={set('impact_funds_basis')}
                          options={IMPACT_BASES} ariaLabel="Which funds count" />
                </Field>
                {form.impact_funds_basis === 'eligible' && (
                  <Field label="Expenses so far (₹)" error={errors.impact_expenses}
                         hint="Deducted from verified funds before converting.">
                    {input('impact_expenses', { inputMode: 'decimal', placeholder: 'e.g. 5000' })}
                  </Field>
                )}
                {form.impact_funds_basis === 'percent' && (
                  <Field label="Percentage of verified funds (%)"
                         error={errors.impact_funds_percent}>
                    {input('impact_funds_percent', { inputMode: 'numeric', placeholder: 'e.g. 80' })}
                  </Field>
                )}
              </>
            ) : (
              <Field label={`Current impact value (${unit})`}
                     error={errors.impact_manual_value}
                     hint="Update this yourself as the work progresses.">
                {input('impact_manual_value', { inputMode: 'decimal', placeholder: 'e.g. 12450' })}
              </Field>
            )}

            <Field label="Default progress view" error={errors.impact_default_view}
                   hint="What the public page shows first.">
              <Select value={form.impact_default_view} onChange={set('impact_default_view')}
                      options={IMPACT_VIEWS} ariaLabel="Default progress view" />
            </Field>

            <Check checked={form.impact_completed_enabled}
                   onChange={set('impact_completed_enabled')}>
              Add a completed-impact figure (e.g. “8,200 kg delivered”)
            </Check>
            {form.impact_completed_enabled && (
              <div className="form-row">
                <Field label="Completed action word" error={errors.impact_completed_action}>
                  {input('impact_completed_action', { maxLength: 30, placeholder: 'e.g. delivered' })}
                </Field>
                <Field label={`Current completed quantity (${unit})`}
                       error={errors.impact_completed_qty}>
                  {input('impact_completed_qty', { inputMode: 'decimal', placeholder: 'e.g. 8200' })}
                </Field>
              </div>
            )}
          </div>
        )}

        <div className="form-nav">
          <span />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <Spinner size={14} /> : 'Save impact settings'}
          </button>
        </div>
      </form>
    </div>
  )
}

function SettingsTab({ campaign, onSaved }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return <SettingsEdit campaign={campaign}
                         onCancel={() => setEditing(false)}
                         onSaved={(c) => { onSaved(c); setEditing(false) }}
                         onRefresh={onSaved} />
  }
  return <SettingsSummary campaign={campaign} onEdit={() => setEditing(true)}
                          onSaved={onSaved} />
}

/* Read-only preview shown first; editing is an explicit step. */
function SettingsSummary({ campaign, onEdit, onSaved }) {
  const toast = useToast()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)

  const setStatus = async (status) => {
    setStatusBusy(true)
    const body = new FormData()
    body.append('status', status)
    try {
      const data = await CampaignApi.update(campaign.id, body)
      onSaved(data.campaign)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setStatusBusy(false)
    }
  }

  return (
    <div className="settings-grid">
      <div className="card">
        <div className="section-head">
          <div>
            <h2 className="block-title">Fundraiser details</h2>
            <p className="section-sub">What supporters see on your public page</p>
          </div>
          <button className="btn btn-outline btn-sm" onClick={onEdit}>
            <Icon name="edit" size={13} /> Edit details
          </button>
        </div>
        <dl className="summary-list">
          <SummaryRow label="Title">{campaign.title}</SummaryRow>
          <SummaryRow label="Tagline">{campaign.tagline || <span className="muted">—</span>}</SummaryRow>
          <SummaryRow label="Category">{campaign.category_label}</SummaryRow>
          <SummaryRow label="Goal">{inr(campaign.stats.goal)}</SummaryRow>
          <SummaryRow label="End date">
            {campaign.end_date ? shortDate(campaign.end_date) : 'Open-ended'}
          </SummaryRow>
          <SummaryRow label="Wall amounts">
            <span className={`badge ${campaign.show_amounts ? 'badge-money' : 'badge-muted'}`}>
              <Icon name={campaign.show_amounts ? 'eye' : 'lock'} size={11} />
              {campaign.show_amounts ? 'Shown publicly' : 'Hidden'}
            </span>
          </SummaryRow>
        </dl>
        <div className="summary-story">
          <span className="mini-label">Story</span>
          <MarkdownText text={campaign.description} />
        </div>
        {campaign.cover_url && (
          <div className="summary-cover">
            <span className="mini-label">Cover image</span>
            <img src={campaign.cover_url} alt="Fundraiser cover" />
          </div>
        )}
      </div>

      <div className="card">
        <div className="section-head">
          <div>
            <h2 className="block-title">Payment settings</h2>
            <p className="section-sub">How supporters pay you — directly to your account</p>
          </div>
          <button className="btn btn-outline btn-sm" onClick={onEdit}>
            <Icon name="edit" size={13} /> Edit payments
          </button>
        </div>
        <div className="qr-current">
          <img src={campaign.qr_url} alt="Current payment QR code" className="qr-thumb" />
          <dl className="summary-list summary-list-tight">
            <SummaryRow label="UPI ID">
              {campaign.upi_id || <span className="muted">— (QR only)</span>}
            </SummaryRow>
            <SummaryRow label="Payee name">{campaign.payee_name}</SummaryRow>
            <SummaryRow label="QR status">
              <span className="badge badge-money">
                <Icon name="badge-check" size={11} /> Live on public page
              </span>
            </SummaryRow>
            <SummaryRow label="One-tap UPI link">
              {campaign.qr_payload ? (
                <span className="badge badge-money">
                  <Icon name="zap" size={11} /> Active — uses your QR's exact payload
                </span>
              ) : (
                <span className="badge badge-muted" title="We couldn't read a UPI code from the uploaded image; the mobile pay button will use your UPI ID instead.">
                  <Icon name="info" size={11} /> Using UPI ID fallback
                </span>
              )}
            </SummaryRow>
          </dl>
        </div>
      </div>

      <GalleryCard campaign={campaign} onSaved={onSaved} />

      <FundUsageCard campaign={campaign} onSaved={onSaved} />

      <ImpactSettingsCard key={`impact-${campaign.id}`} campaign={campaign}
                          onSaved={onSaved} />

      <div className="card">
        <div className="section-head">
          <div>
            <h2 className="block-title">Fundraiser state</h2>
            <p className="section-sub">
              {campaign.status === 'active' && 'Live — supporters can pay and submit claims.'}
              {campaign.status === 'paused' && 'Paused — the page is visible but new claims are off.'}
              {campaign.status === 'ended' && 'Ended — shown as closed on the public page.'}
            </p>
          </div>
          <StatusBadge status={campaign.status} />
        </div>
        <div className="state-row">
          {campaign.status === 'active' ? (
            <button className="btn btn-outline" disabled={statusBusy} onClick={() => setStatus('paused')}>
              <Icon name="pause" size={15} /> Pause claims
            </button>
          ) : campaign.status === 'paused' ? (
            <button className="btn btn-money" disabled={statusBusy} onClick={() => setStatus('active')}>
              <Icon name="play" size={15} /> Resume fundraiser
            </button>
          ) : (
            <button className="btn btn-outline" disabled={statusBusy} onClick={() => setStatus('active')}>
              <Icon name="refresh" size={15} /> Reopen fundraiser
            </button>
          )}
          {campaign.status !== 'ended' && (
            <button className="btn btn-outline" disabled={statusBusy} onClick={() => setStatus('ended')}>
              <Icon name="check-circle" size={15} /> Mark as ended
            </button>
          )}
        </div>
      </div>

      <div className="card danger-zone">
        <div className="section-head">
          <div>
            <h2 className="block-title">Danger zone</h2>
            <p className="section-sub">Deleting removes the fundraiser, its public page and
              all contribution records permanently.</p>
          </div>
        </div>
        <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
          <Icon name="trash" size={15} /> Delete fundraiser
        </button>
      </div>

      <DeleteModal campaign={campaign} open={confirmDelete} onClose={() => setConfirmDelete(false)} />
    </div>
  )
}

/* Photo gallery manager — cover (edited via the form) plus up to 6 extra
   photos that become a slideshow on the public page. Multi-select upload:
   one photo goes through the crop tool, a batch uploads straight through. */
function GalleryCard({ campaign, onSaved }) {
  const toast = useToast()
  const inputRef = useRef(null)
  const [drag, setDrag] = useState(false)
  const [progress, setProgress] = useState(null)  // {done, total}
  const [removing, setRemoving] = useState(null)
  const [cropFile, setCropFile] = useState(null)

  const extras = (campaign.gallery || []).filter((g) => g.id !== 0)
  const remaining = 6 - extras.length
  const full = remaining <= 0

  const uploadOne = async (file) => {
    const body = new FormData()
    body.append('image', file)
    const data = await CampaignApi.addImage(campaign.id, body)
    onSaved(data.campaign, { silent: true })
  }

  const handleFiles = async (fileList) => {
    let files = [...(fileList || [])].filter((f) => f.type.startsWith('image/'))
    if (inputRef.current) inputRef.current.value = ''
    if (!files.length) return
    if (files.length > remaining) {
      files = files.slice(0, remaining)
      toast.info(`Only ${remaining} slot${remaining === 1 ? '' : 's'} left — adding the first ${remaining}.`)
    }
    if (files.length === 1) {
      setCropFile(files[0])
      return
    }
    setProgress({ done: 0, total: files.length })
    let added = 0
    for (const file of files) {
      try {
        await uploadOne(file)
        added += 1
      } catch (err) {
        toast.error(err.fields?.image || err.message)
      }
      setProgress({ done: added, total: files.length })
    }
    setProgress(null)
    if (added) toast.success(`${added} photo${added === 1 ? '' : 's'} added to the slideshow`)
  }

  const applyCrop = async (cropped) => {
    setCropFile(null)
    setProgress({ done: 0, total: 1 })
    try {
      await uploadOne(cropped)
      toast.success('Photo added to the slideshow')
    } catch (err) {
      toast.error(err.fields?.image || err.message)
    } finally {
      setProgress(null)
    }
  }

  const removePhoto = async (imageId) => {
    setRemoving(imageId)
    try {
      const data = await CampaignApi.removeImage(campaign.id, imageId)
      onSaved(data.campaign, { silent: true })
      toast.success('Photo removed')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="card">
      <div className="section-head">
        <div>
          <h2 className="block-title">Photos</h2>
          <p className="section-sub">Up to 6 photos — shown as a slideshow on your page</p>
        </div>
        <span className="meta-chip">{extras.length}/6 photos</span>
      </div>

      {(campaign.cover_url || extras.length > 0) && (
        <div className="gallery-grid">
          {campaign.cover_url && (
            <figure className="gallery-item">
              <img src={campaign.cover_url} alt="Cover" />
              <figcaption className="gallery-tag">Cover</figcaption>
            </figure>
          )}
          {extras.map((g) => (
            <figure className="gallery-item" key={g.id}>
              <img src={g.url} alt="Gallery photo" />
              <button className="gallery-remove" aria-label="Remove photo"
                      disabled={removing === g.id}
                      onClick={() => removePhoto(g.id)}>
                {removing === g.id ? <Spinner size={12} /> : <Icon name="x" size={13} />}
              </button>
            </figure>
          ))}
        </div>
      )}

      {full ? (
        <p className="field-hint">Gallery is full — remove a photo to add another.</p>
      ) : progress ? (
        <p className="ocr-note">
          <Spinner size={13} /> Uploading {Math.min(progress.done + 1, progress.total)} of {progress.total}…
        </p>
      ) : (
        <div
          className={`dropzone ${drag ? 'is-drag' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files) }}
          role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
          aria-label="Add photos"
        >
          <input ref={inputRef} type="file" multiple hidden
                 accept="image/png,image/jpeg,image/webp"
                 onChange={(e) => handleFiles(e.target.files)} />
          <div className="dz-empty">
            <span className="dz-icon"><Icon name="upload" size={20} /></span>
            <span className="dz-cta">
              Add photos <span className="dz-or">— select several at once</span>
            </span>
            <span className="dz-note">Up to {remaining} more · PNG/JPEG/WEBP · 6 MB each</span>
          </div>
        </div>
      )}

      <CropperModal
        file={cropFile}
        aspect={2.2}
        title="Crop this photo"
        onApply={applyCrop}
        onCancel={() => setCropFile(null)}
      />
    </div>
  )
}

function SummaryRow({ label, children }) {
  return (
    <div className="summary-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/* Edit mode — entered explicitly from the preview, exits via Cancel/Save. */
function SettingsEdit({ campaign, onCancel, onSaved, onRefresh }) {
  const toast = useToast()
  const [form, setForm] = useState({
    title: campaign.title,
    tagline: campaign.tagline,
    description: campaign.description,
    category: campaign.category,
    goal_amount: String(campaign.stats.goal),
    end_date: campaign.end_date || '',
    upi_id: campaign.upi_id,
    payee_name: campaign.payee_name,
    show_amounts: campaign.show_amounts,
  })
  const [qrFile, setQrFile] = useState(null)
  const [coverFile, setCoverFile] = useState(null)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }))
  const setInput = (key) => (event) => set(key)(event.target.value)

  const save = async () => {
    setBusy(true)
    setErrors({})
    const body = new FormData()
    for (const [key, value] of Object.entries(form)) body.append(key, value)
    body.set('show_amounts', form.show_amounts ? 'true' : 'false')
    if (qrFile) body.append('qr_code', qrFile)
    if (coverFile) body.append('cover_image', coverFile)
    try {
      const data = await CampaignApi.update(campaign.id, body)
      onSaved(data.campaign)
    } catch (err) {
      setErrors(err.fields || {})
      toast.error(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="settings-grid">
      <div className="card form-card">
        <div className="section-head">
          <div>
            <h2 className="block-title">Edit fundraiser</h2>
            <p className="section-sub">Changes go live on your public page as soon as you save</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>
            <Icon name="x" size={13} /> Cancel
          </button>
        </div>

        <Field label="Title" required error={errors.title}>
          <input className="input" value={form.title} maxLength={90} onChange={setInput('title')} />
        </Field>
        <Field label="Tagline" error={errors.tagline}>
          <input className="input" value={form.tagline} maxLength={160} onChange={setInput('tagline')} />
        </Field>
        <div className="form-row">
          <Field label="Category" error={errors.category}>
            <Select value={form.category} onChange={set('category')} ariaLabel="Category"
                    options={[
                      { value: 'education', label: 'Education' }, { value: 'medical', label: 'Medical' },
                      { value: 'community', label: 'Community' }, { value: 'emergency', label: 'Emergency' },
                      { value: 'creative', label: 'Creative' }, { value: 'nonprofit', label: 'Non-profit' },
                      { value: 'personal', label: 'Personal' }, { value: 'other', label: 'Other' },
                    ]} />
          </Field>
          <Field label="Goal amount (₹)" error={errors.goal_amount}>
            <input className="input" inputMode="numeric" value={form.goal_amount}
                   onChange={setInput('goal_amount')} />
          </Field>
          <Field label="End date" error={errors.end_date} hint="Empty = open-ended.">
            <input className="input" type="date" value={form.end_date} onChange={setInput('end_date')} />
          </Field>
        </div>
        <Field label="Story" required error={errors.description}
               hint={`${form.description.length}/8000 · format with the toolbar`}>
          <StoryEditor value={form.description} onChange={set('description')}
                       rows={8} error={errors.description} />
        </Field>
        <Check checked={form.show_amounts} onChange={set('show_amounts')}>
          Show contribution amounts on the public wall
        </Check>

        <div className="section-head" style={{ marginTop: 10 }}>
          <div>
            <h2 className="block-title">Payments</h2>
            <p className="section-sub">Replace your QR or update UPI details</p>
          </div>
        </div>
        <div className="qr-current">
          <img src={campaign.qr_url} alt="Current payment QR code" className="qr-thumb" />
          <div>
            <p className="field-label">Current QR code</p>
            <p className="field-hint">Upload below to replace — crop next.</p>
          </div>
        </div>
        <ImageInput label="Replace QR code" square value={qrFile} onChange={setQrFile}
                    error={errors.qr_code} crop cropAspect={1}
                    cropTitle="Crop your payment QR" />
        <div className="form-row">
          <Field label="UPI ID" error={errors.upi_id}>
            <input className="input" value={form.upi_id} onChange={setInput('upi_id')}
                   autoCapitalize="none" placeholder="yourname@bank" />
          </Field>
          <Field label="Payee name" error={errors.payee_name}>
            <input className="input" value={form.payee_name} maxLength={80}
                   onChange={setInput('payee_name')} />
          </Field>
        </div>
        <ImageInput label={campaign.cover_url ? 'Replace cover image' : 'Add cover image'}
                    value={coverFile} onChange={setCoverFile} error={errors.cover_image}
                    crop cropAspect={2.2} cropTitle="Crop your cover image" />

        <div className="form-nav">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? <Spinner size={15} /> : <><Icon name="check" size={15} /> Save changes</>}
          </button>
        </div>
      </div>

      <GalleryCard campaign={campaign} onSaved={onRefresh} />
    </div>
  )
}

function DeleteModal({ campaign, open, onClose }) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const doDelete = async () => {
    setBusy(true)
    try {
      await CampaignApi.remove(campaign.id)
      toast.success('Fundraiser deleted')
      window.location.href = '/dashboard'
    } catch (err) {
      toast.error(err.message)
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Delete this fundraiser?">
      <p className="modal-text">This permanently deletes <strong>{campaign.title}</strong>,
        its public page, QR code and all {campaign.stats.donors + campaign.stats.pending}+
        contribution records. This cannot be undone.</p>
      <Field label={<>Type <strong>DELETE</strong> to confirm</>}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)}
               placeholder="DELETE" />
      </Field>
      <div className="form-nav">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-danger" disabled={text !== 'DELETE' || busy} onClick={doDelete}>
          {busy ? <Spinner size={14} /> : <><Icon name="trash" size={14} /> Delete permanently</>}
        </button>
      </div>
    </Modal>
  )
}

/* --------------------------------------------------------------- modals */

function ProofModal({ donation, onClose }) {
  return (
    <Modal open={!!donation} onClose={onClose} wide
           title={donation ? `Payment screenshot — ${donation.donor_name} (${inr(donation.amount)})` : ''}>
      {donation && (
        <div className="proof-view">
          <img src={donation.proof_url} alt={`Payment screenshot from ${donation.donor_name}`} />
          {donation.transaction_ref && (
            <p className="muted">Transaction ID: <strong>{donation.transaction_ref}</strong></p>
          )}
        </div>
      )}
    </Modal>
  )
}

/* Every claim detail, editable in one form — shared by Edit and Add. */
const EMPTY_CLAIM = { donor_name: '', amount: '', message: '', is_anonymous: false,
                      transaction_ref: '', payer_id: '', donor_email: '' }

function ClaimFieldset({ form, set, errors }) {
  const input = (key, extra = {}) => (
    <input className="input" value={form[key]} {...extra}
           onChange={(e) => set(key)(e.target.value)} />
  )
  return (
    <>
      <div className="form-row">
        <Field label="Supporter name" required error={errors.donor_name}>
          {input('donor_name', { maxLength: 60 })}
        </Field>
        <Field label="Amount (₹)" required error={errors.amount}>
          {input('amount', { inputMode: 'decimal' })}
        </Field>
      </div>
      <div className="form-row">
        <Field label="UPI transaction ID" error={errors.transaction_ref}>
          {input('transaction_ref', { maxLength: 64, placeholder: 'optional' })}
        </Field>
        <Field label="Payer UPI ID / phone" error={errors.payer_id}>
          {input('payer_id', { maxLength: 64, placeholder: 'optional' })}
        </Field>
      </div>
      <div className="form-row">
        <Field label="Email" error={errors.donor_email}>
          {input('donor_email', { type: 'email', maxLength: 254, placeholder: 'optional' })}
        </Field>
        <Field label="Message" error={errors.message} hint="Shown on the public wall.">
          {input('message', { maxLength: 280 })}
        </Field>
      </div>
      <Check checked={form.is_anonymous} onChange={set('is_anonymous')}>
        Hide the name on the public wall (show as “Anonymous”)
      </Check>
    </>
  )
}

/* Fix a claim after submission — a mistaken anonymous tick, a name typo,
   a wrong amount. Status and proof screenshot stay read-only. */
function EditModal({ donation, onClose, onDone }) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY_CLAIM)
  const [newShot, setNewShot] = useState(null)   // added/replacement screenshot
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const shotRef = useRef(null)

  useEffect(() => {
    if (donation) {
      setForm({
        donor_name: donation.donor_name,
        amount: String(donation.amount),
        message: donation.message || '',
        is_anonymous: donation.is_anonymous,
        transaction_ref: donation.transaction_ref || '',
        payer_id: donation.payer_id || '',
        donor_email: donation.donor_email || '',
      })
      setNewShot(null)
      setErrors({})
    }
  }, [donation?.id])   // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }))

  const pickShot = (fileList) => {
    const file = [...(fileList || [])].find((f) => f.type.startsWith('image/'))
    if (shotRef.current) shotRef.current.value = ''
    if (file) setNewShot(file)
  }

  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    setErrors({})
    const body = new FormData()
    for (const [key, value] of Object.entries(form)) {
      body.append(key, typeof value === 'boolean' ? (value ? 'true' : 'false') : value)
    }
    if (newShot) body.append('screenshot', newShot)
    try {
      const data = await CampaignApi.editDonation(donation.id, body)
      toast.success('Claim updated')
      onDone(data.campaign_stats)
    } catch (err) {
      setErrors(err.fields || {})
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!donation} onClose={onClose} title="Edit claim"
           subtitle={donation ? `Ref ${donation.public_id}` : ''}>
      {donation && (
        <>
          {/* everything the supporter sent, at a glance — proof included */}
          <div className="claim-summary">
            {newShot ? (
              <span className="claim-proof-thumb">
                <img src={URL.createObjectURL(newShot)} alt="New payment screenshot" />
                <span className="claim-proof-zoom"><Icon name="upload" size={13} /></span>
              </span>
            ) : donation.has_screenshot ? (
              <a className="claim-proof-thumb" href={donation.proof_url}
                 target="_blank" rel="noreferrer"
                 aria-label="Open the payment screenshot full-size">
                <img src={donation.proof_url} alt="Payment screenshot" />
                <span className="claim-proof-zoom"><Icon name="search" size={13} /></span>
              </a>
            ) : (
              <span className="claim-proof-thumb claim-proof-none">
                <Icon name="camera" size={18} />
                <small>No screenshot</small>
              </span>
            )}
            <div className="claim-summary-info">
              <div className="claim-summary-row">
                <StatusBadge status={donation.status} />
                <strong className="money-text">{inr(donation.amount)}</strong>
              </div>
              <span className="muted">
                <Icon name="clock" size={12} /> Submitted {dateTime(donation.created_at)}
              </span>
              {donation.reviewed_at && (
                <span className="muted">
                  <Icon name="badge-check" size={12} /> Reviewed {timeAgo(donation.reviewed_at)}
                </span>
              )}
              {donation.has_screenshot && !newShot && (
                <a className="claim-proof-open" href={donation.proof_url}
                   target="_blank" rel="noreferrer">
                  <Icon name="external" size={12} /> Open screenshot full-size
                </a>
              )}
              <button type="button" className="claim-proof-open"
                      onClick={() => shotRef.current?.click()}>
                <Icon name="camera" size={12} />
                {newShot
                  ? 'New screenshot selected — saves with the claim'
                  : donation.has_screenshot ? 'Replace screenshot' : 'Add screenshot'}
              </button>
              {errors.screenshot && <span className="field-error">{errors.screenshot}</span>}
              <input ref={shotRef} type="file" accept="image/*" hidden
                     onChange={(e) => pickShot(e.target.files)} />
            </div>
          </div>

          <form onSubmit={save} noValidate>
            <ClaimFieldset form={form} set={set} errors={errors} />
            <div className="form-nav">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? <Spinner size={14} /> : 'Save changes'}
              </button>
            </div>
          </form>
        </>
      )}
    </Modal>
  )
}

/* Record a payment that arrived without a claim — cash, a direct transfer,
   a supporter who never submitted proof. Goes on the wall immediately. */
function AddModal({ campaignId, campaignSlug, open, onClose, onDone }) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY_CLAIM)
  const [screenshot, setScreenshot] = useState(null)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState(false)

  useEffect(() => {
    if (open) {
      setForm(EMPTY_CLAIM)
      setScreenshot(null)
      setScanned(false)
      setErrors({})
    }
  }, [open])

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }))

  /* OCR the screenshot and prefill whatever the organizer hasn't typed —
     same extraction the public claim form uses. */
  const onScreenshot = (file) => {
    setScreenshot(file)
    setScanned(false)
    if (!file) return
    setScanning(true)
    const body = new FormData()
    body.append('screenshot', file)
    if (campaignSlug) body.append('slug', campaignSlug)
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

  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    setErrors({})
    const body = new FormData()
    for (const [key, value] of Object.entries(form)) {
      body.append(key, typeof value === 'boolean' ? (value ? 'true' : 'false') : value)
    }
    if (screenshot) body.append('screenshot', screenshot)
    try {
      const data = await CampaignApi.addDonation(campaignId, body)
      toast.success(`Recorded ${inr(data.donation.amount)} from ${data.donation.donor_name}`)
      onDone(data.campaign_stats)
    } catch (err) {
      setErrors(err.fields || {})
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Record a contribution"
           subtitle="For payments you received without a claim — added as verified, straight onto the wall.">
      <form onSubmit={save} noValidate>
        <ImageInput label="Payment screenshot (optional)" value={screenshot}
                    onChange={onScreenshot} error={errors.screenshot}
                    hint="Details fill in automatically from the screenshot." />
        {scanning && (
          <p className="ocr-note"><Spinner size={12} /> Reading screenshot…</p>
        )}
        {scanned && !scanning && (
          <p className="ocr-note ocr-ok">
            <Icon name="check-circle" size={13} /> Details filled — please verify.
          </p>
        )}
        <ClaimFieldset form={form} set={set} errors={errors} />
        <div className="form-nav">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-money" disabled={busy}>
            {busy ? <Spinner size={14} /> : <><Icon name="check" size={14} /> Add to wall</>}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function RejectModal({ donation, onClose, onDone }) {
  const toast = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { setNote('') }, [donation?.id])

  const reject = async () => {
    setBusy(true)
    try {
      const data = await CampaignApi.review(donation.id, 'reject', note)
      toast.success('Claim rejected')
      onDone(data.campaign_stats)
    } catch (err) {
      toast.error(err.message)
      setBusy(false)
    }
  }

  return (
    <Modal open={!!donation} onClose={onClose} title="Reject this claim?">
      {donation && (
        <>
          <p className="modal-text">
            Reject <strong>{inr(donation.amount)}</strong> from <strong>{donation.donor_name}</strong>?
            It won't appear on the public wall. The supporter can see this outcome (and your
            note) when they check their reference code.
          </p>
          <Field label="Reason (optional)" hint="e.g. “No matching credit in my account”.">
            <input className="input" value={note} maxLength={200}
                   onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="form-nav">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-danger" onClick={reject} disabled={busy}>
              {busy ? <Spinner size={14} /> : 'Reject claim'}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
