import { useToast } from '../ctx/ToastContext.jsx'
import { Icon } from './Icon.jsx'

export function ShareRow({ url, title }) {
  const toast = useToast()
  const text = `Support "${title}" — every contribution counts!`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copied — share it anywhere')
    } catch {
      toast.info(url)
    }
  }

  const native = async () => {
    try {
      await navigator.share({ title, text, url })
    } catch { /* user dismissed */ }
  }

  return (
    <div className="share-row" role="group" aria-label="Share this fundraiser">
      <button className="btn btn-outline btn-sm" onClick={copy}>
        <Icon name="copy" size={14} /> Copy link
      </button>
      <a className="btn btn-outline btn-sm share-wa" target="_blank" rel="noreferrer"
         href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`}>
        <Icon name="whatsapp" size={15} /> WhatsApp
      </a>
      <a className="btn btn-outline btn-sm" target="_blank" rel="noreferrer"
         href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`}>
        <Icon name="x-social" size={13} /> Post
      </a>
      {typeof navigator.share === 'function' && (
        <button className="btn btn-outline btn-sm" onClick={native}>
          <Icon name="share" size={14} /> More
        </button>
      )}
    </div>
  )
}
