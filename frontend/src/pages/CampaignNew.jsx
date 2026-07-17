import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CampaignApi } from '../api.js'
import { Check, Field, ImageInput, Spinner } from '../components/bits.jsx'
import { Icon } from '../components/Icon.jsx'
import { StoryEditor } from '../components/StoryEditor.jsx'
import { Select } from '../components/Select.jsx'
import { AppShell } from '../components/Shells.jsx'
import { useToast } from '../ctx/ToastContext.jsx'
import { inr } from '../format.js'

const CATEGORIES = [
  { value: 'education', label: 'Education' },
  { value: 'medical', label: 'Medical' },
  { value: 'community', label: 'Community' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'creative', label: 'Creative' },
  { value: 'nonprofit', label: 'Non-profit' },
  { value: 'personal', label: 'Personal' },
  { value: 'other', label: 'Other' },
]

const STEPS = ['Details', 'Payments', 'Review']

export default function CampaignNew() {
  const navigate = useNavigate()
  const toast = useToast()
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState('')
  const [errors, setErrors] = useState({})
  const [form, setForm] = useState({
    title: '', tagline: '', description: '', category: 'other',
    goal_amount: '', end_date: '', upi_id: '', payee_name: '',
    show_amounts: true,
  })
  const [qrFile, setQrFile] = useState(null)
  const [coverFile, setCoverFile] = useState(null)

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }))
  const setInput = (key) => (event) => set(key)(event.target.value)

  const stepErrors = useMemo(() => {
    const problems = {}
    if (step >= 0) {
      if (form.title.trim().length < 4 || form.title.trim().length > 90)
        problems.title = 'Title must be 4–90 characters.'
      if (form.tagline.trim().length > 160)
        problems.tagline = 'Keep the tagline under 160 characters.'
      if (form.description.trim().length < 20)
        problems.description = 'Tell your story in at least 20 characters.'
      const goal = Number(form.goal_amount)
      if (!goal || goal < 100 || goal > 1e9)
        problems.goal_amount = 'Goal must be between ₹100 and ₹100 crore.'
      if (form.end_date && form.end_date < new Date().toISOString().slice(0, 10))
        problems.end_date = "End date can't be in the past."
    }
    return problems
  }, [form, step])

  const paymentErrors = useMemo(() => {
    const problems = {}
    if (!qrFile) problems.qr_code = 'Upload your payment QR code — supporters scan this to pay you.'
    if (form.upi_id && !/^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9]{1,31}$/.test(form.upi_id.trim()))
      problems.upi_id = "That doesn't look like a valid UPI ID (e.g. name@bank)."
    return problems
  }, [qrFile, form.upi_id])

  const next = () => {
    if (step === 0) {
      setErrors(stepErrors)
      if (Object.keys(stepErrors).length) return
    }
    if (step === 1) {
      setErrors(paymentErrors)
      if (Object.keys(paymentErrors).length) return
    }
    setErrors({})
    setStep((s) => Math.min(s + 1, 2))
    window.scrollTo({ top: 0 })
  }

  const publish = async () => {
    setBusy(true)
    setServerError('')
    const body = new FormData()
    for (const [key, value] of Object.entries(form)) body.append(key, value)
    body.set('show_amounts', form.show_amounts ? 'true' : 'false')
    body.append('qr_code', qrFile)
    if (coverFile) body.append('cover_image', coverFile)
    try {
      const data = await CampaignApi.create(body)
      toast.success('Your fundraiser is live!')
      navigate(`/dashboard/campaigns/${data.campaign.id}?created=1`)
    } catch (err) {
      setServerError(err.message)
      if (err.fields) {
        setErrors(err.fields)
        const detailKeys = ['title', 'tagline', 'description', 'goal_amount', 'end_date', 'category']
        setStep(detailKeys.some((k) => err.fields[k]) ? 0 : 1)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell>
      <div className="wizard">
        <div className="page-head">
          <div>
            <h1 className="page-title">New fundraiser</h1>
            <p className="page-sub">Three quick steps and you're live.</p>
          </div>
        </div>

        <ol className="stepper" aria-label="Progress">
          {STEPS.map((name, index) => (
            <li key={name}
                className={index === step ? 'is-current' : index < step ? 'is-done' : ''}>
              <span className="stepper-dot">
                {index < step ? <Icon name="check" size={12} strokeWidth={2.4} /> : index + 1}
              </span>
              {name}
            </li>
          ))}
        </ol>

        {serverError && <div className="alert alert-danger" role="alert"><Icon name="alert" size={15} />{serverError}</div>}

        {step === 0 && (
          <div className="card form-card">
            <Field label="Fundraiser title" required error={errors.title}>
              <input className="input" value={form.title} onChange={setInput('title')}
                     maxLength={90} placeholder="e.g. Books for a village school library" />
            </Field>
            <Field label="Tagline" error={errors.tagline}
                   hint="One line shown under the title and in link previews.">
              <input className="input" value={form.tagline} onChange={setInput('tagline')}
                     maxLength={160} placeholder="A short line that sums up your cause" />
            </Field>
            <div className="form-row">
              <Field label="Category" required error={errors.category}>
                <Select value={form.category} onChange={set('category')}
                        options={CATEGORIES} ariaLabel="Category" />
              </Field>
              <Field label="Goal amount (₹)" required error={errors.goal_amount}>
                <input className="input" inputMode="numeric" value={form.goal_amount}
                       onChange={setInput('goal_amount')} placeholder="e.g. 50000" />
              </Field>
              <Field label="End date" error={errors.end_date} hint="Optional — leave empty to keep it open.">
                <input className="input" type="date" value={form.end_date}
                       min={new Date().toISOString().slice(0, 10)}
                       onChange={setInput('end_date')} />
              </Field>
            </div>
            <Field label="Your story" required error={errors.description}
                   hint={`${form.description.length}/8000 · format with the toolbar`}>
              <StoryEditor value={form.description} onChange={set('description')}
                           rows={9} error={errors.description}
                           placeholder="Why are you raising funds? What will the money be used for? Be specific — clear stories raise more." />
            </Field>
            <ImageInput label="Cover image (optional)" value={coverFile} onChange={setCoverFile}
                        error={errors.cover_image} crop cropAspect={2.2}
                        cropTitle="Crop your cover image"
                        hint="A wide photo makes your page and shared links stand out." />
            <div className="form-nav">
              <span />
              <button className="btn btn-primary" onClick={next}>
                Continue <Icon name="arrow-right" size={15} />
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="card form-card">
            <div className="callout">
              <Icon name="shield" size={16} />
              <p>Supporters pay <strong>directly into your account</strong> by scanning this QR —
                 CrowdFund never touches the money. Export the QR from your UPI app
                 (GPay / PhonePe / Paytm → your profile → QR code).</p>
            </div>
            <ImageInput label="Payment QR code" square value={qrFile} onChange={setQrFile}
                        error={errors.qr_code} crop cropAspect={1}
                        cropTitle="Crop your payment QR"
                        hint="Crop so only the QR fills the frame." />
            <div className="form-row">
              <Field label="UPI ID (optional)" error={errors.upi_id}
                     hint="Adds a one-tap “Pay with UPI app” button for mobile supporters.">
                <input className="input" value={form.upi_id} onChange={setInput('upi_id')}
                       placeholder="yourname@bank" autoCapitalize="none" />
              </Field>
              <Field label="Payee name" error={errors.payee_name}
                     hint="Shown in the supporter's UPI app while paying.">
                <input className="input" value={form.payee_name} onChange={setInput('payee_name')}
                       maxLength={80} placeholder="Name on the account" />
              </Field>
            </div>
            <div className="form-nav">
              <button className="btn btn-ghost" onClick={() => setStep(0)}>
                <Icon name="arrow-left" size={15} /> Back
              </button>
              <button className="btn btn-primary" onClick={next}>
                Continue <Icon name="arrow-right" size={15} />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="card form-card">
            <h2 className="block-title">Review &amp; publish</h2>
            <dl className="review-grid">
              <div><dt>Title</dt><dd>{form.title}</dd></div>
              <div><dt>Category</dt><dd>{CATEGORIES.find((c) => c.value === form.category)?.label}</dd></div>
              <div><dt>Goal</dt><dd>{inr(Number(form.goal_amount || 0))}</dd></div>
              <div><dt>End date</dt><dd>{form.end_date || 'Open-ended'}</dd></div>
              <div><dt>UPI ID</dt><dd>{form.upi_id || '— (QR only)'}</dd></div>
              <div><dt>QR code</dt><dd>{qrFile?.name}</dd></div>
            </dl>
            <Check checked={form.show_amounts} onChange={set('show_amounts')}>
              Show individual contribution amounts on the public supporter wall
            </Check>
            <div className="callout callout-money">
              <Icon name="info" size={16} />
              <p>After publishing you'll get a shareable link. Payments supporters make are
                 <strong> claims</strong> until you confirm them from your dashboard — only
                 confirmed contributions appear publicly.</p>
            </div>
            <div className="form-nav">
              <button className="btn btn-ghost" onClick={() => setStep(1)}>
                <Icon name="arrow-left" size={15} /> Back
              </button>
              <button className="btn btn-primary btn-lg" onClick={publish} disabled={busy}>
                {busy ? <Spinner size={15} /> : <>Publish fundraiser <Icon name="sparkle" size={15} /></>}
              </button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
