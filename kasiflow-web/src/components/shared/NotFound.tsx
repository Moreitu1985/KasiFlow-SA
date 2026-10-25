import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Wordmark } from './Logo'

export function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-start justify-center px-4">
      <Wordmark />
      <h1 className="mt-10 text-3xl font-bold">Page not found</h1>
      <p className="mt-2 text-ink-soft">The link may be wrong, or the page has moved.</p>
      <Button asChild className="mt-6">
        <Link to="/">Go to the home page</Link>
      </Button>
    </main>
  )
}

export function RouteError() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-start justify-center px-4">
      <Wordmark />
      <h1 className="mt-10 text-3xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-ink-soft">This screen failed to load. Reload the page to try again; your saved records are not affected.</p>
      <Button className="mt-6" onClick={() => window.location.reload()}>
        Reload page
      </Button>
    </main>
  )
}
