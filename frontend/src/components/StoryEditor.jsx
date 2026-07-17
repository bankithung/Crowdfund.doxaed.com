// Real-time story editor: what you format is what you see (bold looks bold
// while typing — no visible markup, no preview mode). Under the hood the
// content is serialized to the same safe markup the public renderer uses,
// so storage and XSS guarantees are unchanged.
import { useEffect, useRef } from 'react'
import { Icon } from './Icon.jsx'

/* ---------------- markup -> editor HTML (input is OUR markup only) */

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function inlineHtml(text) {
  let out = escapeHtml(text)
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  out = out.replace(/==([^=\n]+)==/g, '<mark>$1</mark>')
  out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  return out
}

export function markupToHtml(text) {
  const lines = String(text || '').split('\n')
  const html = []
  let list = null
  const closeList = () => {
    if (list) { html.push(`</${list}>`); list = null }
  }
  for (const raw of lines) {
    const line = raw.trim()
    const bullet = line.match(/^[-*]\s+(.+)/)
    const numbered = line.match(/^\d{1,3}[.)]\s+(.+)/)
    if (bullet || numbered) {
      const tag = numbered ? 'ol' : 'ul'
      if (list !== tag) { closeList(); html.push(`<${tag}>`); list = tag }
      html.push(`<li>${inlineHtml((bullet || numbered)[1])}</li>`)
      continue
    }
    closeList()
    const h2 = line.match(/^##\s+(.+)/)
    const h1 = line.match(/^#\s+(.+)/)
    const quote = line.match(/^>\s?(.*)/)
    if (h2) html.push(`<h4>${inlineHtml(h2[1])}</h4>`)
    else if (h1) html.push(`<h3>${inlineHtml(h1[1])}</h3>`)
    else if (quote) html.push(`<blockquote>${inlineHtml(quote[1])}</blockquote>`)
    else if (line) html.push(`<div>${inlineHtml(raw)}</div>`)
    else html.push('<div><br></div>')
  }
  closeList()
  return html.join('')
}

/* ---------------- editor DOM -> markup */

function serializeInline(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const inner = [...node.childNodes].map(serializeInline).join('')
  const tag = node.tagName
  const style = node.getAttribute?.('style') || ''
  if (!inner.trim() && tag !== 'BR') return inner
  if (tag === 'BR') return '\n'
  if (tag === 'B' || tag === 'STRONG') return `**${inner}**`
  if (tag === 'I' || tag === 'EM') return `*${inner}*`
  if (tag === 'MARK' || /background/i.test(style)) return `==${inner}==`
  if (tag === 'A') {
    const href = node.getAttribute('href') || ''
    return /^https?:\/\//.test(href) ? `[${inner}](${href})` : inner
  }
  if (/^font-weight:\s*(bold|[6-9]00)/i.test(style)) return `**${inner}**`
  return inner
}

function serializeBlock(node, out) {
  if (node.nodeType === Node.TEXT_NODE) {
    if (node.textContent.trim()) out.push(node.textContent)
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return
  const tag = node.tagName
  if (tag === 'H1' || tag === 'H2' || tag === 'H3') {
    out.push(`# ${serializeInline(node).trim()}`)
  } else if (tag === 'H4' || tag === 'H5' || tag === 'H6') {
    out.push(`## ${serializeInline(node).trim()}`)
  } else if (tag === 'UL' || tag === 'OL') {
    ;[...node.children].forEach((li, i) => {
      const marker = tag === 'OL' ? `${i + 1}. ` : '- '
      out.push(marker + serializeInline(li).trim())
    })
  } else if (tag === 'BLOCKQUOTE') {
    serializeInline(node).split('\n').forEach((line) => out.push(`> ${line.trim()}`))
  } else if (tag === 'DIV' || tag === 'P') {
    const hasBlockChild = [...node.children].some((c) =>
      /^(DIV|P|UL|OL|H\d|BLOCKQUOTE)$/.test(c.tagName))
    if (hasBlockChild) {
      ;[...node.childNodes].forEach((child) => serializeBlock(child, out))
    } else {
      out.push(serializeInline(node).replace(/\n+$/, ''))
    }
  } else if (tag === 'BR') {
    out.push('')
  } else {
    out.push(serializeInline(node))
  }
}

export function htmlToMarkup(root) {
  const out = []
  ;[...root.childNodes].forEach((node) => serializeBlock(node, out))
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/* ------------------------------------------------------ component */

const ACTIONS = [
  { key: 'bold', icon: 'format-bold', title: 'Bold', cmd: 'bold' },
  { key: 'italic', icon: 'format-italic', title: 'Italic', cmd: 'italic' },
  { key: 'highlight', icon: 'highlight', title: 'Highlight', cmd: 'hiliteColor', arg: '#e6f6f0' },
  { key: 'h', icon: 'heading', title: 'Heading', block: 'H3' },
  { key: 'ul', icon: 'list-bulleted', title: 'Bullet list', cmd: 'insertUnorderedList' },
  { key: 'ol', icon: 'list-numbered', title: 'Numbered list', cmd: 'insertOrderedList' },
  { key: 'quote', icon: 'format-quote', title: 'Quote', block: 'BLOCKQUOTE' },
  { key: 'link', icon: 'link', title: 'Link', link: true },
]

export function StoryEditor({ value, onChange, rows = 9, maxLength = 8000,
                              placeholder, error }) {
  const editorRef = useRef(null)
  const lastEmitted = useRef(null)

  // hydrate (and re-hydrate only for external changes, not our own emits)
  useEffect(() => {
    if (value !== lastEmitted.current && editorRef.current) {
      editorRef.current.innerHTML = markupToHtml(value)
      lastEmitted.current = value
    }
  }, [value])

  const emit = () => {
    const editor = editorRef.current
    if (!editor) return
    const markup = htmlToMarkup(editor).slice(0, maxLength)
    lastEmitted.current = markup
    onChange(markup)
  }

  const run = (action) => {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    const selection = window.getSelection()
    const hasSelection = selection && !selection.isCollapsed &&
      editor.contains(selection.anchorNode)

    if (action.block) {
      const current = document.queryCommandValue('formatBlock')
      const target = current?.toUpperCase() === action.block ? 'DIV' : action.block
      document.execCommand('formatBlock', false, target)
    } else if (action.link) {
      if (!hasSelection) return   // link needs selected text
      const url = window.prompt('Link URL (https://…)')
      if (url && /^https?:\/\//.test(url)) document.execCommand('createLink', false, url)
    } else {
      // inline formats only ever apply to a real selection — a bare click
      // must never toggle a sticky formatting state
      if (!hasSelection) return
      document.execCommand('styleWithCSS', false, false)
      document.execCommand(action.cmd, false, action.arg || null)
    }
    emit()
  }

  return (
    <div className={`story-editor ${error ? 'has-error' : ''}`}>
      <div className="story-toolbar" role="toolbar" aria-label="Formatting">
        {ACTIONS.map((action) => (
          <button key={action.key} type="button" className="story-tool"
                  title={action.title} aria-label={action.title}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => run(action)}>
            <Icon name={action.icon} size={16} />
          </button>
        ))}
      </div>
      <div
        ref={editorRef}
        className="story-area md"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Story"
        data-placeholder={placeholder || 'Tell your story…'}
        style={{ minHeight: rows * 22 }}
        onInput={emit}
        onBlur={emit}
      />
    </div>
  )
}
