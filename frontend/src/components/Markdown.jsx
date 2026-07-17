// Minimal, safe story formatting. Parses a small markup set into React
// elements directly — raw HTML in the text stays literal text, so injected
// markup can never execute. Supported:
//   # Heading   ## Subheading   > quote   - bullet   1. numbered
//   **bold**   *italic*   ==highlight==   [label](https://link)

const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|==[^=\n]+==|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g

function renderInline(text, keyBase) {
  const parts = text.split(INLINE).filter((p) => p !== '')
  return parts.map((part, i) => {
    const key = `${keyBase}-${i}`
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={key}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>
    }
    if (part.startsWith('==') && part.endsWith('==')) {
      return <mark key={key}>{part.slice(2, -2)}</mark>
    }
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/)
    if (link) {
      return (
        <a key={key} href={link[2]} target="_blank" rel="noopener noreferrer">
          {link[1]}
        </a>
      )
    }
    return part
  })
}

function flushList(blocks, list) {
  if (!list.items.length) return
  const Tag = list.ordered ? 'ol' : 'ul'
  blocks.push(
    <Tag key={`l${blocks.length}`}>
      {list.items.map((item, i) => <li key={i}>{renderInline(item, `li${i}`)}</li>)}
    </Tag>
  )
  list.items = []
}

export function MarkdownText({ text, className = '' }) {
  const blocks = []
  const list = { items: [], ordered: false }
  let paragraph = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push(
      <p key={`p${blocks.length}`}>
        {paragraph.map((line, i) => (
          <span key={i}>
            {i > 0 && <br />}
            {renderInline(line, `p${blocks.length}-${i}`)}
          </span>
        ))}
      </p>
    )
    paragraph = []
  }

  for (const raw of String(text || '').split('\n')) {
    const line = raw.trimEnd()
    const trimmed = line.trim()

    const bullet = trimmed.match(/^[-*]\s+(.+)/)
    const numbered = trimmed.match(/^\d{1,3}[.)]\s+(.+)/)
    if (bullet || numbered) {
      flushParagraph()
      const ordered = !!numbered
      if (list.items.length && list.ordered !== ordered) flushList(blocks, list)
      list.ordered = ordered
      list.items.push((bullet || numbered)[1])
      continue
    }
    flushList(blocks, list)

    if (!trimmed) {
      flushParagraph()
      continue
    }
    const h2 = trimmed.match(/^##\s+(.+)/)
    const h1 = trimmed.match(/^#\s+(.+)/)
    const quote = trimmed.match(/^>\s?(.*)/)
    if (h2) {
      flushParagraph()
      blocks.push(<h4 key={`h${blocks.length}`}>{renderInline(h2[1], `h${blocks.length}`)}</h4>)
    } else if (h1) {
      flushParagraph()
      blocks.push(<h3 key={`h${blocks.length}`}>{renderInline(h1[1], `h${blocks.length}`)}</h3>)
    } else if (quote) {
      flushParagraph()
      blocks.push(
        <blockquote key={`q${blocks.length}`}>{renderInline(quote[1], `q${blocks.length}`)}</blockquote>
      )
    } else {
      paragraph.push(line)
    }
  }
  flushList(blocks, list)
  flushParagraph()

  return <div className={`md ${className}`}>{blocks}</div>
}
