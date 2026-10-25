import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/shared/Callout'
import { RoleHeader } from '@/features/access/RoleHeader'
import { CardsSkeleton, EmptyState, ErrorState } from '@/components/shared/States'
import { CATEGORY_LABELS } from '@/lib/automation'
import type { ConnectionDto, ProviderCardDto } from '@/types/automation'
import { useIntegrations } from './api'
import { ActivityDrawer } from './ActivityDrawer'
import { CatalogueCard } from './CatalogueCard'
import { ConnectDialog } from './ConnectDialog'
import { ConnectionCard } from './ConnectionCard'
import { JobsCard } from './JobsCard'
import { SandboxPanel } from './SandboxPanel'

const CATEGORY_ORDER = ['payment', 'pos', 'accounting', 'inventory_device', 'notification']

export function IntegrationsPage() {
  const q = useIntegrations()
  const [connectCard, setConnectCard] = useState<ProviderCardDto | null>(null)
  const [activityFor, setActivityFor] = useState<ConnectionDto | null>(null)
  const data = q.data

  const groups = useMemo(() => {
    if (!data) return []
    const cats = [...new Set(data.catalogue.map((c) => c.category))].sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a)
      const ib = CATEGORY_ORDER.indexOf(b)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
    return cats.map((cat) => ({ cat, cards: data.catalogue.filter((c) => c.category === cat) }))
  }, [data])

  const connections = data?.connections.filter((c) => c.status !== 'disconnected') ?? []
  const sandboxConnection = connections.find((c) => c.providerKey === 'sandbox')

  return (
    <div className="space-y-6">
      <RoleHeader
        title="Integrations Centre"
        description="Connect payment providers so verified payments flow into your records. Every card says honestly what is available, planned or only a sandbox."
       
        actions={
          <Button asChild variant="outline">
            <Link to="/reconciliation">Open Reconciliation</Link>
          </Button>
        }
      />

      {q.isLoading ? (
        <CardsSkeleton count={3} className="xl:grid-cols-3" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load integrations" />
      ) : data ? (
        <>
          {!data.canManage && (
            <Callout tone="neutral" title="View only">
              Your role can see integrations but not connect, test or change them.
            </Callout>
          )}

          <section aria-labelledby="conn-title" className="space-y-3">
            <h2 id="conn-title" className="text-lg font-bold">
              Your connections
            </h2>
            {connections.length === 0 ? (
              <EmptyState
                icon={Plug}
                title="Nothing connected yet"
                description={
                  data.isDemoBusiness
                    ? 'Connect the sandbox below to try the full payment pipeline with simulated money.'
                    : 'Choose an available provider below. Payments only count once the provider confirms them.'
                }
              />
            ) : (
              <div className="grid min-w-0 gap-4">
                {connections.map((c) => (
                  <ConnectionCard key={c.id} c={c} canManage={data.canManage} onActivity={() => setActivityFor(c)} />
                ))}
              </div>
            )}
          </section>

          {data.isDemoBusiness && <SandboxPanel connection={sandboxConnection} canManage={data.canManage} />}

          <JobsCard canManage={data.canManage} />

          {groups.map(({ cat, cards }) => (
            <section key={cat} aria-labelledby={`cat-${cat}`} className="space-y-3">
              <h2 id={`cat-${cat}`} className="text-lg font-bold">
                {CATEGORY_LABELS[cat] ?? cat}
              </h2>
              <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {cards.map((card) => (
                  <CatalogueCard
                    key={card.key}
                    card={card}
                    connection={connections.find((c) => c.providerKey === card.key)}
                    canManage={data.canManage}
                    onConnect={() => setConnectCard(card)}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      ) : null}

      <ConnectDialog card={connectCard} onOpenChange={(o) => !o && setConnectCard(null)} />
      <ActivityDrawer connection={activityFor} onOpenChange={(o) => !o && setActivityFor(null)} />
    </div>
  )
}
