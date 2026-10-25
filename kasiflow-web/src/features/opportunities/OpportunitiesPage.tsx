import { useEffect, useState } from 'react'
import { BookmarkCheck, CalendarDays, Compass, ExternalLink, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAccess } from '@/features/access/useAccess'
import { Badge } from '@/components/ui/badge'
import { Checkbox, Input, NativeSelect } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RoleHeader } from '@/features/access/RoleHeader'
import { Callout } from '@/components/shared/Callout'
import { VerificationBadge } from '@/components/shared/Badges'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/States'
import { formatDate, todayJhb } from '@/lib/format'
import { APPLICATION_STATUS, OPPORTUNITY_TYPES, VERIFICATION, entries } from '@/lib/labels'
import { cn } from '@/lib/utils'
import type { OpportunityType, VerificationStatus } from '@/types/api'
import { useOpportunities } from './api'
import { OpportunityDrawer } from './OpportunityDrawer'
import { AddOpportunityDialog } from './AddOpportunityDialog'

export function OpportunitiesPage() {
  const canEdit = useAccess().can('manageSettings')
  const [type, setType] = useState<OpportunityType | ''>('')
  const [verification, setVerification] = useState<VerificationStatus | ''>('')
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const [savedOnly, setSavedOnly] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const list = useOpportunities({ type, verification, search, savedOnly })
  const today = todayJhb()

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchText.trim()), 350)
    return () => clearTimeout(t)
  }, [searchText])

  return (
    <div>
      <RoleHeader
        title="Opportunities"
        description="Funding, tenders, supplier databases and training that may suit your business. Always check the source before applying."
        actions={
          canEdit && (
            <Button onClick={() => setAddOpen(true)}>
              <Plus /> Add opportunity
            </Button>
          )
        }
      />
      <Callout tone="warning" className="mb-5" title="Real funding never asks for an upfront fee">
        If anyone asks you to pay to “release”, “unlock” or “process” funding, it is very likely a scam. Check on the organisation’s official website.
      </Callout>

      <div className="mb-5 grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <Label htmlFor="o-search">Search</Label>
          <div className="relative mt-1.5">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
            <Input id="o-search" className="pl-9" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Title or organisation" />
          </div>
        </div>
        <div>
          <Label htmlFor="o-type-f">Type</Label>
          <NativeSelect id="o-type-f" className="mt-1.5" value={type} onChange={(e) => setType(e.target.value as OpportunityType | '')}>
            <option value="">All types</option>
            {entries(OPPORTUNITY_TYPES).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <Label htmlFor="o-ver">Verification</Label>
          <NativeSelect id="o-ver" className="mt-1.5" value={verification} onChange={(e) => setVerification(e.target.value as VerificationStatus | '')}>
            <option value="">Any</option>
            {entries(VERIFICATION).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </div>
        <label className="flex items-center gap-2 self-end pb-2.5 text-sm">
          <Checkbox checked={savedOnly} onChange={(e) => setSavedOnly(e.target.checked)} /> Saved only
        </label>
      </div>

      {list.isLoading ? (
        <ListSkeleton />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.length ? (
        <EmptyState
          icon={Compass}
          title={savedOnly ? 'No saved opportunities' : 'No opportunities found'}
          description={savedOnly ? 'Save opportunities to track your applications here.' : 'Try different filters, or add one you heard about yourself.'}
          action={canEdit ? <Button variant="outline" onClick={() => setAddOpen(true)}><Plus /> Add opportunity</Button> : undefined}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.data.map((o) => {
            const closed = !!o.applicationDeadline && o.applicationDeadline < today
            return (
              <article
                key={o.id}
                className={cn(
                  'flex flex-col rounded-lg border bg-surface shadow-card',
                  o.verificationStatus === 'sample' ? 'border-dashed border-ochre' : 'border-line',
                )}
              >
                <div className="flex-1 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <VerificationBadge status={o.verificationStatus} />
                    <Badge variant="outline">{OPPORTUNITY_TYPES[o.opportunityType]}</Badge>
                    {o.tracking && (
                      <Badge variant="success">
                        <BookmarkCheck aria-hidden /> {APPLICATION_STATUS[o.tracking.applicationStatus]}
                      </Badge>
                    )}
                  </div>
                  <h2 className="mt-3 font-sans text-[17px] leading-snug font-semibold">
                    <button type="button" onClick={() => setSelected(o.id)} className="cursor-pointer text-left hover:underline">
                      {o.title}
                    </button>
                  </h2>
                  <p className="text-sm text-ink-muted">{o.organisation}</p>
                  <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-soft">{o.description}</p>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-5 py-3 text-[13px]">
                  <span className={cn('inline-flex items-center gap-1.5', closed ? 'text-red-700' : 'text-ink-soft')}>
                    <CalendarDays className="size-3.5" aria-hidden />
                    {o.applicationDeadline ? `${closed ? 'Closed' : 'Closes'} ${formatDate(o.applicationDeadline)}` : 'No deadline listed'}
                  </span>
                  {o.sourceUrl && (
                    <a href={o.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-forest-800 hover:underline">
                      <ExternalLink className="size-3.5" aria-hidden /> Source
                    </a>
                  )}
                  <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setSelected(o.id)}>
                    Details
                  </Button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      <OpportunityDrawer id={selected} onOpenChange={(o) => !o && setSelected(null)} />
      <AddOpportunityDialog open={addOpen} onOpenChange={setAddOpen} onCreated={setSelected} />
    </div>
  )
}
