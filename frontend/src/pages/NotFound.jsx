import { Link } from 'react-router-dom'
import { EmptyState } from '../components/bits.jsx'
import { PublicShell } from '../components/Shells.jsx'

export default function NotFound() {
  return (
    <PublicShell minimal>
      <div className="container page nf-wrap">
        <EmptyState icon="search" title="Page not found"
          action={<Link to="/" className="btn btn-primary">Back to home</Link>}>
          The page you're looking for doesn't exist or the fundraiser link may
          have been deleted by its organizer.
        </EmptyState>
      </div>
    </PublicShell>
  )
}
