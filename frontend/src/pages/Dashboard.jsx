import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CampaignApi } from '../api.js'
import { EmptyState, ProgressBar, SkeletonRows, StatusBadge } from '../components/bits.jsx'
import { Icon } from '../components/Icon.jsx'
import { AppShell } from '../components/Shells.jsx'
import { useAuth } from '../ctx/AuthContext.jsx'
import { useToast } from '../ctx/ToastContext.jsx'
import { inr, publicUrl, timeAgo } from '../format.js'

export default function Dashboard() {
  const { user } = useAuth()
  const toast = useToast()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    CampaignApi.dashboard().then(setData).catch((err) => setError(err.message))
  }, [])

  const copyLink = async (slug) => {
    await navigator.clipboard.writeText(publicUrl(slug)).catch(() => {})
    toast.success('Public link copied')
  }

  return (
    <AppShell>
      <div className="page-head">
        <div>
          <h1 className="page-title">Hi {user?.name?.split(' ')[0]}</h1>
          <p className="page-sub">Here's how your fundraisers are doing.</p>
        </div>
        <Link to="/dashboard/campaigns/new" className="btn btn-primary">
          <Icon name="plus" size={15} /> New fundraiser
        </Link>
      </div>

      {error && <div className="alert alert-danger"><Icon name="alert" size={15} />{error}</div>}
      {!data && !error && <SkeletonRows rows={3} height={110} />}

      {data && (
        <>
          <div className="stat-grid">
            <StatTile icon="wallet" label="Total raised" value={inr(data.totals.raised)} accent="money" />
            <StatTile icon="users" label="Verified supporters" value={data.totals.donors} />
            <StatTile icon="clock" label="Pending verification" value={data.totals.pending}
                      accent={data.totals.pending > 0 ? 'warn' : undefined} />
            <StatTile icon="zap" label="Active fundraisers"
                      value={`${data.totals.active_campaigns} / ${data.totals.campaigns}`} />
          </div>

          <section className="section-block">
            <div className="section-head">
              <div>
                <h2 className="block-title">Your fundraisers</h2>
                <p className="section-sub">Each one has its own page, QR and verification queue</p>
              </div>
            </div>
            {data.campaigns.length === 0 ? (
              <EmptyState icon="heart" title="No fundraisers yet"
                action={<Link to="/dashboard/campaigns/new" className="btn btn-primary">
                  <Icon name="plus" size={15} /> Start your first fundraiser</Link>}>
                Create one in minutes — all you need is your story and your payment QR code.
              </EmptyState>
            ) : (
              <div className="campaign-grid">
                {data.campaigns.map((campaign) => (
                  <article className="card camp-card" key={campaign.id}>
                    <div className="camp-cover">
                      {campaign.cover_url
                        ? <img src={campaign.cover_url} alt="" loading="lazy" />
                        : <div className="camp-cover-fallback" aria-hidden="true">{campaign.title.slice(0, 1)}</div>}
                      <StatusBadge status={campaign.status} />
                    </div>
                    <div className="camp-body">
                      <h3 className="camp-title">
                        <Link to={`/dashboard/campaigns/${campaign.id}`}>{campaign.title}</Link>
                      </h3>
                      <ProgressBar value={campaign.stats.progress} slim />
                      <p className="camp-nums">
                        <strong>{inr(campaign.stats.raised)}</strong>
                        <span className="muted"> of {inr(campaign.stats.goal)} · {campaign.stats.donors} supporters</span>
                      </p>
                      {campaign.stats.pending > 0 && (
                        <Link to={`/dashboard/campaigns/${campaign.id}?tab=verify`} className="badge badge-warn camp-pending">
                          <Icon name="clock" size={12} /> {campaign.stats.pending} to verify
                        </Link>
                      )}
                      <div className="camp-actions">
                        <Link to={`/dashboard/campaigns/${campaign.id}`} className="btn btn-outline btn-sm">
                          <Icon name="settings" size={14} /> Manage
                        </Link>
                        <button className="btn btn-ghost btn-sm" onClick={() => copyLink(campaign.slug)}>
                          <Icon name="link" size={14} /> Copy link
                        </button>
                        <a href={`/c/${campaign.slug}`} target="_blank" rel="noreferrer"
                           className="btn btn-ghost btn-sm">
                          <Icon name="external" size={14} /> View
                        </a>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {data.recent.length > 0 && (
            <section className="section-block">
              <div className="section-head">
                <div>
                  <h2 className="block-title">Recent activity</h2>
                  <p className="section-sub">Latest claims across all your fundraisers</p>
                </div>
              </div>
              <div className="card">
                <ul className="activity">
                  {data.recent.map((donation) => (
                    <li key={donation.id} className="activity-row">
                      <span className="activity-who">
                        <strong>{donation.donor_name}</strong>
                        {donation.is_anonymous && <span className="muted"> (anonymous publicly)</span>}
                        <span className="muted"> · {donation.campaign_title}</span>
                      </span>
                      <span className="activity-meta">
                        <strong className="money-text">{inr(donation.amount)}</strong>
                        <StatusBadge status={donation.status} />
                        <span className="muted activity-time">{timeAgo(donation.created_at)}</span>
                        <Link className="btn btn-ghost btn-sm"
                              to={`/dashboard/campaigns/${donation.campaign_id}?tab=${donation.status === 'pending' ? 'verify' : 'donations'}`}>
                          Review
                        </Link>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </>
      )}
    </AppShell>
  )
}

function StatTile({ icon, label, value, accent }) {
  return (
    <div className={`card stat-tile ${accent ? `stat-${accent}` : ''}`}>
      <span className="stat-head">
        <span className="stat-icon"><Icon name={icon} size={15} /></span>
        <span className="stat-label">{label}</span>
      </span>
      <span className="stat-value">{value}</span>
    </div>
  )
}
