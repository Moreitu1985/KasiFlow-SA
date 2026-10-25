import type { ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/States'
import { roleLabel } from '@/lib/access'
import { useAccess } from './useAccess'

/**
 * Route guard: asks the person's Experience whether this screen is part of their app. If not, it shows a friendly
 * "not available for your role" screen instead of firing requests that would 403. `redirect` sends them home instead
 * (for pages outside the app frame, such as the printable business summary).
 */
export function RequireAccess({ children, redirect }: { children: ReactNode; redirect?: boolean }) {
  const { pathname } = useLocation()
  const { role, experience } = useAccess()
  if (experience.canOpen(pathname)) return <>{children}</>
  // "/app" is the generic home link: send people to their own role's home instead of a dead end.
  if (redirect || pathname === '/app' || pathname === '/dashboard') return <Navigate to={experience.homePath} replace />
  return (
    <EmptyState
      icon={Lock}
      title="Not available for your role"
      className="mx-auto mt-6 max-w-xl"
      description={
        <>
          You are signed in as <strong>{roleLabel(role)}</strong> and are using the {experience.title}. This page belongs to a different role in this
          business. Ask the owner if you need it.
        </>
      }
      action={
        <Button asChild size="lg">
          <Link to={experience.homePath}>Go to my home screen</Link>
        </Button>
      }
    />
  )
}
