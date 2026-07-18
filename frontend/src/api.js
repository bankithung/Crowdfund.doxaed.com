// Fetch wrapper: JSON envelopes, CSRF echo, typed ApiError with field errors.

export class ApiError extends Error {
  constructor(message, { code = 'error', status = 0, fields = null } = {}) {
    super(message)
    this.code = code
    this.status = status
    this.fields = fields
  }
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

let csrfPromise = null
async function ensureCsrf() {
  if (getCookie('cf_csrf')) return
  csrfPromise = csrfPromise || fetch('/api/auth/csrf/', { credentials: 'same-origin' })
  await csrfPromise
  csrfPromise = null
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const options = { method, credentials: 'same-origin', headers: {} }
  if (method !== 'GET') {
    await ensureCsrf()
    options.headers['X-CSRFToken'] = getCookie('cf_csrf') || ''
  }
  if (form) {
    options.body = form // FormData: browser sets the multipart boundary
  } else if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }

  let response
  try {
    response = await fetch(path, options)
  } catch {
    throw new ApiError('Network error — check your connection and try again.',
      { code: 'network' })
  }

  let payload = null
  try {
    payload = await response.json()
  } catch { /* non-JSON (proxy error pages) */ }

  if (!response.ok || !payload || payload.ok === false) {
    const details = payload?.error || {}
    throw new ApiError(
      details.message || `Something went wrong (HTTP ${response.status}).`,
      { code: details.code || `http_${response.status}`, status: response.status, fields: details.fields || null },
    )
  }
  return payload.data
}

export const AuthApi = {
  me: () => api('/api/auth/me/'),
  signup: (data) => api('/api/auth/signup/', { method: 'POST', body: data }),
  login: (data) => api('/api/auth/login/', { method: 'POST', body: data }),
  logout: () => api('/api/auth/logout/', { method: 'POST', body: {} }),
  changePassword: (data) => api('/api/auth/password/', { method: 'POST', body: data }),
}

export const CampaignApi = {
  dashboard: () => api('/api/dashboard/'),
  list: () => api('/api/campaigns/'),
  create: (form) => api('/api/campaigns/', { method: 'POST', form }),
  get: (id) => api(`/api/campaigns/${id}/`),
  update: (id, form) => api(`/api/campaigns/${id}/`, { method: 'POST', form }),
  remove: (id) => api(`/api/campaigns/${id}/`, { method: 'DELETE' }),
  donations: (id, params) => api(`/api/campaigns/${id}/donations/?` + new URLSearchParams(params)),
  analytics: (id) => api(`/api/campaigns/${id}/analytics/`),
  review: (donationId, action, note = '') =>
    api(`/api/donations/${donationId}/review/`, { method: 'POST', body: { action, note } }),
  editDonation: (donationId, fields) =>
    api(`/api/donations/${donationId}/edit/`, { method: 'POST', body: fields }),
  addDonation: (campaignId, fields) =>
    api(`/api/campaigns/${campaignId}/donations/`, { method: 'POST', body: fields }),
  addImage: (id, form) => api(`/api/campaigns/${id}/images/`, { method: 'POST', form }),
  removeImage: (id, imageId) =>
    api(`/api/campaigns/${id}/images/${imageId}/`, { method: 'DELETE' }),
  addFundUse: (id, form) => api(`/api/campaigns/${id}/fund-uses/`, { method: 'POST', form }),
  updateFundUse: (id, itemId, form) =>
    api(`/api/campaigns/${id}/fund-uses/${itemId}/`, { method: 'POST', form }),
  removeFundUse: (id, itemId) =>
    api(`/api/campaigns/${id}/fund-uses/${itemId}/`, { method: 'DELETE' }),
  removeFundUseImage: (id, itemId, imageId) =>
    api(`/api/campaigns/${id}/fund-uses/${itemId}/images/${imageId}/`, { method: 'DELETE' }),
  exportUrl: (id) => `/api/campaigns/${id}/export/`,
}

export const PublicApi = {
  index: () => api('/api/public/campaigns/'),
  campaign: (slug, { silent = false } = {}) =>
    api(`/api/public/campaigns/${slug}/${silent ? '?silent=1' : ''}`),
  donors: (slug, params) => api(`/api/public/campaigns/${slug}/donors/?` + new URLSearchParams(params)),
  donate: (slug, form) => api(`/api/public/campaigns/${slug}/donate/`, { method: 'POST', form }),
  parseScreenshot: (form) => api('/api/public/parse-screenshot/', { method: 'POST', form }),
  status: (ref) => api(`/api/public/donations/${encodeURIComponent(ref)}/`),
  lookup: (q) => api(`/api/public/donations/lookup/?q=${encodeURIComponent(q)}`),
  receiptUrl: (publicId) => `/api/public/donations/${encodeURIComponent(publicId)}/receipt.pdf`,
}
