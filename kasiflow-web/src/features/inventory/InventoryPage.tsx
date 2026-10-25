import { useEffect, useState } from 'react'
import { ArrowLeftRight, Check, History, MoreHorizontal, Package, PackagePlus, Pencil, Search, SlidersHorizontal, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Callout } from '@/components/shared/Callout'
import { Money } from '@/components/shared/Money'
import { RoleHeader } from '@/features/access/RoleHeader'
import { ReasonDialog } from '@/components/shared/ReasonDialog'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/States'
import { errorMessage } from '@/lib/apiClient'
import { formatDateTime, humanize } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAccess } from '@/features/access/useAccess'
import { useBranches } from '@/features/branches/api'
import type { BranchDto, ProductDto, StockMovementDto } from '@/types/automation'
import { useDecideAdjustment, useMovements, useProducts, useReorderSuggestions } from './api'
import { AdjustDialog, MovementsDialog, ProductDialog, ReceiveDialog, TransferDialog } from './InventoryDialogs'

type DialogKind = 'edit' | 'receive' | 'adjust' | 'transfer' | 'history'

function ProductActions({ p, onAction, branches }: { p: ProductDto; onAction: (k: DialogKind, p: ProductDto) => void; branches: BranchDto[] }) {
  const { can } = useAccess()
  const stock = p.kind === 'product'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${p.name}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onAction('history', p)}>
          <History /> Stock history
        </DropdownMenuItem>
        {can('manageInventory') && (
          <DropdownMenuItem onSelect={() => onAction('edit', p)}>
            <Pencil /> Edit product
          </DropdownMenuItem>
        )}
        {stock && can('manageInventory') && (
          <DropdownMenuItem onSelect={() => onAction('receive', p)}>
            <PackagePlus /> Receive stock
          </DropdownMenuItem>
        )}
        {stock && can('recordStockAdjustment') && (
          <DropdownMenuItem onSelect={() => onAction('adjust', p)}>
            <SlidersHorizontal /> Adjust stock
          </DropdownMenuItem>
        )}
        {stock && can('manageInventory') && branches.filter((b) => b.isActive).length > 1 && (
          <DropdownMenuItem onSelect={() => onAction('transfer', p)}>
            <ArrowLeftRight /> Transfer between branches
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function LowBadge({ p }: { p: ProductDto }) {
  if (p.kind !== 'product') return <Badge variant="neutral">Service</Badge>
  if (p.levels.some((l) => l.isLow)) return <Badge variant="warning">Low stock</Badge>
  return null
}

function ProductsTab({ branches }: { branches: BranchDto[] }) {
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [dialog, setDialog] = useState<{ kind: DialogKind; product: ProductDto } | null>(null)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  const q = useProducts({ search: debounced, includeInactive })
  const onAction = (kind: DialogKind, product: ProductDto) => setDialog({ kind, product })
  const close = (o: boolean) => !o && setDialog(null)
  const pick = (k: DialogKind) => (dialog?.kind === k ? dialog.product : null)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Label htmlFor="inv-search">Search</Label>
          <div className="relative mt-1.5">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
            <Input id="inv-search" className="pl-9" placeholder="Name, SKU or barcode" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={60} />
          </div>
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch id="inv-inactive" checked={includeInactive} onCheckedChange={setIncludeInactive} />
          <Label htmlFor="inv-inactive" className="font-normal">
            Show inactive
          </Label>
        </div>
      </div>

      {q.isLoading ? (
        <ListSkeleton rows={5} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon={Package} title={debounced ? 'No products match' : 'No products yet'} description="Add the items you sell so sales can reduce stock automatically." />
      ) : (
        <>
          {/* Mobile cards */}
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface md:hidden">
            {q.data.map((p) => (
              <li key={p.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className={cn('font-medium', !p.isActive && 'text-ink-muted line-through')}>{p.name}</p>
                  <p className="text-[12px] break-all text-ink-muted">
                    {p.sku}
                    {p.barcode ? ` · ${p.barcode}` : ''}
                  </p>
                  <p className="mt-1 text-[13px]">
                    <Money cents={p.unitPriceCents} className="font-semibold" />
                    {p.kind === 'product' && <span className="text-ink-muted"> · {p.totalQuantity} in stock</span>}
                  </p>
                  {p.levels.length > 1 && <p className="text-[12px] text-ink-muted">{p.levels.map((l) => `${l.branchName}: ${l.quantity}`).join(' · ')}</p>}
                  <div className="mt-1">
                    <LowBadge p={p} />
                  </div>
                </div>
                <ProductActions p={p} onAction={onAction} branches={branches} />
              </li>
            ))}
          </ul>
          {/* Desktop table */}
          <Card className="hidden overflow-hidden md:block">
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH>SKU / barcode</TH>
                  <TH className="text-right">Price</TH>
                  <TH className="text-right">Cost</TH>
                  <TH className="text-right">Total qty</TH>
                  <TH>Per branch</TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {q.data.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <span className={cn('font-medium', !p.isActive && 'text-ink-muted line-through')}>{p.name}</span>
                      <div className="mt-0.5 flex gap-1">
                        <LowBadge p={p} />
                        {!p.isActive && <Badge variant="neutral">Inactive</Badge>}
                      </div>
                    </TD>
                    <TD className="text-[13px] text-ink-soft">
                      {p.sku}
                      {p.barcode && <span className="block text-ink-muted">{p.barcode}</span>}
                    </TD>
                    <TD className="text-right">
                      <Money cents={p.unitPriceCents} />
                    </TD>
                    <TD className="text-right">
                      <Money cents={p.unitCostCents} tone="muted" />
                    </TD>
                    <TD className="text-right font-semibold tabular">{p.kind === 'product' ? p.totalQuantity : '—'}</TD>
                    <TD className="text-[13px]">
                      {p.levels.length === 0
                        ? '—'
                        : p.levels.map((l) => (
                            <span key={l.branchId} className={cn('block', l.isLow && 'font-semibold text-amber-800')}>
                              {l.branchName}: {l.quantity}
                              {l.isLow && ' (low)'}
                            </span>
                          ))}
                    </TD>
                    <TD className="text-right">
                      <ProductActions p={p} onAction={onAction} branches={branches} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        </>
      )}

      <ProductDialog key={pick('edit')?.id ?? 'edit-none'} product={pick('edit')} open={!!pick('edit')} onOpenChange={close} />
      <ReceiveDialog key={`rc-${pick('receive')?.id ?? 'none'}`} product={pick('receive')} branches={branches} onOpenChange={close} />
      <AdjustDialog key={`ad-${pick('adjust')?.id ?? 'none'}`} product={pick('adjust')} branches={branches} onOpenChange={close} />
      <TransferDialog key={`tr-${pick('transfer')?.id ?? 'none'}`} product={pick('transfer')} branches={branches} onOpenChange={close} />
      <MovementsDialog product={pick('history')} onOpenChange={close} />
    </div>
  )
}

function ApprovalsTab() {
  const { can } = useAccess()
  const q = useMovements({ status: 'pending_approval' })
  const decide = useDecideAdjustment()
  const [rejecting, setRejecting] = useState<StockMovementDto | null>(null)
  const canApprove = can('approveStockAdjustment')
  if (q.isLoading) return <ListSkeleton rows={3} />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data?.length) return <EmptyState icon={Check} title="Nothing waiting for approval" />
  return (
    <div className="space-y-3">
      {!canApprove && <Callout tone="neutral">These adjustments are waiting for a manager. Your role cannot approve them.</Callout>}
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {q.data.map((m) => (
          <li key={m.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {m.productName}: <span className={m.quantityDelta < 0 ? 'text-red-700' : 'text-emerald-800'}>{m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta}</span> ({humanize(m.movementType)})
              </p>
              <p className="text-[13px] text-ink-muted">
                {m.branchName} · {m.createdByName ?? 'Someone'} · {formatDateTime(m.createdAt)}
              </p>
              {m.reason && <p className="text-[13px] break-words">Reason: {m.reason}</p>}
            </div>
            {canApprove && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  loading={decide.isPending && decide.variables?.id === m.id && decide.variables.approve}
                  onClick={() =>
                    decide
                      .mutateAsync({ id: m.id, approve: true })
                      .then(() => toast.success('Adjustment approved'))
                      .catch((e: unknown) => toast.error('Could not approve', { description: errorMessage(e) }))
                  }
                >
                  <Check /> Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => setRejecting(m)}>
                  <X /> Reject
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <ReasonDialog
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        title="Reject this adjustment?"
        description="Stock levels stay as they are. The person who asked can see your note."
        reasonLabel="Why are you rejecting it?"
        confirmLabel="Reject adjustment"
        pending={decide.isPending}
        onConfirm={(note) =>
          rejecting &&
          decide.mutate(
            { id: rejecting.id, approve: false, note },
            {
              onSuccess: () => {
                toast.success('Adjustment rejected')
                setRejecting(null)
              },
              onError: (e) => toast.error('Could not reject', { description: errorMessage(e) }),
            },
          )
        }
      />
    </div>
  )
}

function ReorderTab() {
  const [onlyNeeded, setOnlyNeeded] = useState(true)
  const q = useReorderSuggestions(onlyNeeded)
  return (
    <div className="space-y-4">
      <Callout tone="info" title="Suggestion only — nothing is ordered automatically">
        Worked out from your recorded sales, lead times and minimum stock. Check the assumptions and your own knowledge before you buy.
      </Callout>
      <div className="flex items-center gap-2">
        <Switch id="only-needed" checked={onlyNeeded} onCheckedChange={setOnlyNeeded} />
        <Label htmlFor="only-needed" className="font-normal">
          Only show products that need reordering
        </Label>
      </div>
      {q.isLoading ? (
        <ListSkeleton rows={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon={Package} title="Nothing to reorder" description="Stock is above the reorder point everywhere." />
      ) : (
        <ul className="grid min-w-0 gap-4 lg:grid-cols-2">
          {q.data.map((r) => (
            <li key={`${r.productId}-${r.branchId}`} className="min-w-0">
              <Card className="h-full">
                <CardContent className="space-y-3 pt-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{r.name}</p>
                      <p className="text-[13px] text-ink-muted">
                        {r.sku} · {r.branchName}
                        {r.supplierName ? ` · ${r.supplierName}` : ''}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {r.isLowStock && <Badge variant="warning">Low stock</Badge>}
                      {r.insufficientHistory && <Badge variant="neutral">Little sales history</Badge>}
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div>
                      <dt className="text-[12px] text-ink-muted">On hand</dt>
                      <dd className="font-semibold tabular">{r.onHand}</dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-ink-muted">Reorder point</dt>
                      <dd className="font-semibold tabular">{r.reorderPoint}</dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-ink-muted">Suggested qty</dt>
                      <dd className="font-semibold tabular">{r.suggestedQuantity}</dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-ink-muted">Estimated cost</dt>
                      <dd className="font-semibold">
                        <Money cents={r.estimatedCostCents} />
                      </dd>
                    </div>
                  </dl>
                  <details>
                    <summary className="cursor-pointer text-[13px] font-semibold text-forest-800">Assumptions</summary>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-ink-soft">
                      {r.assumptions.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </details>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function InventoryPage() {
  const { can } = useAccess()
  const branches = useBranches()
  const pending = useMovements({ status: 'pending_approval' })
  const [adding, setAdding] = useState(false)
  const pendingCount = pending.data?.length ?? 0
  return (
    <div className="space-y-6">
      <RoleHeader
        title="Inventory"
        description="Products, stock per branch, approvals and reorder suggestions. Sales with product lines reduce stock automatically."
       
        actions={
          can('manageInventory') && (
            <Button onClick={() => setAdding(true)}>
              <PackagePlus /> Add product
            </Button>
          )
        }
      />
      <Tabs defaultValue="products">
        <TabsList aria-label="Inventory views">
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="approvals">
            Approvals {pendingCount > 0 && <Badge variant="warning">{pendingCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="reorder">Reorder suggestions</TabsTrigger>
        </TabsList>
        <TabsContent value="products">
          <ProductsTab branches={branches.data ?? []} />
        </TabsContent>
        <TabsContent value="approvals">
          <ApprovalsTab />
        </TabsContent>
        <TabsContent value="reorder">
          <ReorderTab />
        </TabsContent>
      </Tabs>
      <ProductDialog key={adding ? 'new-open' : 'new-closed'} product={null} open={adding} onOpenChange={setAdding} />
    </div>
  )
}
