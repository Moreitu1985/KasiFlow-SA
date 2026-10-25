import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarPlus, SearchX } from 'lucide-react'
import { api, ApiError } from '@/lib/apiClient'
import { Skeleton } from '@/components/ui/skeleton'
import { Wordmark } from '@/components/shared/Logo'
import { ErrorState } from '@/components/shared/States'
import type { PublicProfileDto } from '@/types/api'
import { ProfileView } from './ProfileView'
import { usePublicBookingInfo } from '@/features/public-booking/api'

export function PublicProfilePage() {
  const { slug = '' } = useParams()
  const validSlug = /^[a-z0-9-]{3,80}$/.test(slug)
  const q = useQuery({
    queryKey: ['public-profile', slug],
    queryFn: () => api.get<PublicProfileDto>(`/api/public/profiles/${encodeURIComponent(slug)}`, undefined, { anonymous: true }),
    enabled: validSlug,
    retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2,
  })
  const notFound = !validSlug || (q.error instanceof ApiError && q.error.status === 404)
  // Only offer "Book now" when the business has services customers can book online.
  const booking = usePublicBookingInfo(slug, !!q.data)
  const canBook = (booking.data?.services.length ?? 0) > 0

  useEffect(() => {
    document.title = q.data ? `${q.data.businessName} | KasiFlow SA` : 'Business profile | KasiFlow SA'
  }, [q.data])

  return (
    <div className="min-h-dvh">
      <main className="mx-auto max-w-2xl px-4 py-8 sm:py-14">
        {notFound ? (
          <div className="rounded-lg border border-line bg-surface px-6 py-14 text-center shadow-card">
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-forest-50 text-forest-800">
              <SearchX className="size-6" aria-hidden />
            </div>
            <h1 className="text-2xl font-bold">Profile not found</h1>
            <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-ink-soft">
              This business profile does not exist or is not public. Check the link with the business owner.
            </p>
          </div>
        ) : q.isLoading ? (
          <div className="space-y-4 rounded-lg border border-line bg-surface p-8" aria-busy aria-label="Loading profile">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load this profile" />
        ) : q.data ? (
          <>
            {canBook && (
              <Link
                to={`/p/${slug}/book`}
                className="mb-4 flex h-14 items-center justify-center gap-2 rounded-lg bg-emerald-brand px-5 text-lg font-bold text-forest-950 shadow-card hover:brightness-105"
              >
                <CalendarPlus className="size-5" aria-hidden /> Book now
              </Link>
            )}
            <ProfileView p={q.data} />
          </>
        ) : null}
        <footer className="mt-8 flex flex-col items-center gap-2 text-center text-[13px] text-ink-muted">
          <Link to="/" aria-label="KasiFlow SA home" className="opacity-80 hover:opacity-100">
            <Wordmark className="[&_svg]:size-6 [&_span]:text-base" />
          </Link>
          <p>Business profiles are created by business owners. KasiFlow SA does not verify listed details.</p>
        </footer>
      </main>
    </div>
  )
}
