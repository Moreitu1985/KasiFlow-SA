import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Building, Pencil, Power, UserPlus, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Callout } from '@/components/shared/Callout'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DateRangeBar } from '@/components/shared/DateRangeBar'
import { Money } from '@/components/shared/Money'
import { RoleHeader } from '@/features/access/RoleHeader'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/States'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { formatDate, formatDateTime, todayJhb } from '@/lib/format'
import { roleLabel } from '@/lib/access'
import { firstOfMonth } from '@/lib/periods'
import { useAccess } from '@/features/access/useAccess'
import { useSaveBranch } from '@/features/branches/api'
import type { BranchDto, StaffMemberDto } from '@/types/automation'
import { useRevokeInvitation, useSetMemberActive, useStaffOverview, useStaffPerformance } from './api'
import { ChangeRoleDialog, InviteDialog } from './RoleDialogs'
import { TeamProfilesTab } from './TeamProfilesTab'

function BranchDialog({ branch, open, onOpenChange }: { branch: BranchDto | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const save = useSaveBranch()
  const [name, setName] = useState(branch?.name ?? '')
  const [area, setArea] = useState(branch?.area ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setErrors({ name: 'Enter a branch name.' })
      return
    }
    save.mutate(
      { id: branch?.id, input: { name: name.trim(), area: area.trim() || null, isActive: branch?.isActive ?? true } },
      {
        onSuccess: () => {
          toast.success(branch ? 'Branch renamed' : 'Branch created')
          onOpenChange(false)
        },
        onError: (err) => {
          if (err instanceof ApiError && Object.keys(err.errors).length) setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]])))
          else toast.error('Could not save the branch', { description: errorMessage(err) })
        },
      },
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>{branch ? 'Edit branch' : 'New branch'}</DialogTitle>
            <DialogDescription>A branch is a place where you sell: a shop, a stall, a salon chair.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            <Field id="br-name" label="Name" error={errors.name}>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </Field>
            <Field id="br-area" label="Area" optional error={errors.area}>
              <Input value={area} onChange={(e) => setArea(e.target.value)} maxLength={120} placeholder="e.g. Taxi rank" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save branch
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function BranchesTab({ branches, canManage }: { branches: BranchDto[]; canManage: boolean }) {
  const save = useSaveBranch()
  const [editing, setEditing] = useState<{ open: boolean; branch: BranchDto | null }>({ open: false, branch: null })
  const [toggle, setToggle] = useState<BranchDto | null>(null)
  return (
    <div className="space-y-4">
      {canManage && (
        <Button onClick={() => setEditing({ open: true, branch: null })}>
          <Building /> New branch
        </Button>
      )}
      {branches.length === 0 ? (
        <EmptyState icon={Building} title="No branches yet" />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {branches.map((b) => (
            <li key={b.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {b.name} {!b.isActive && <Badge variant="neutral">Closed</Badge>}
                </p>
                <p className="text-[13px] text-ink-muted">
                  {b.area ?? 'No area'} · since {formatDate(b.createdAt)}
                </p>
              </div>
              {canManage && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing({ open: true, branch: b })}>
                    <Pencil /> Rename
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setToggle(b)}>
                    <Power /> {b.isActive ? 'Close branch' : 'Reopen'}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <BranchDialog key={editing.branch?.id ?? 'new'} open={editing.open} branch={editing.branch} onOpenChange={(o) => setEditing((s) => ({ ...s, open: o }))} />
      <ConfirmDialog
        open={!!toggle}
        onOpenChange={(o) => !o && setToggle(null)}
        title={toggle?.isActive ? `Close ${toggle?.name}?` : `Reopen ${toggle?.name}?`}
        description={
          toggle?.isActive
            ? 'Nobody can record new sales or open shifts at a closed branch. Its history stays. Close any open shifts there first.'
            : 'The branch can be used for sales and shifts again.'
        }
        confirmLabel={toggle?.isActive ? 'Close branch' : 'Reopen branch'}
        destructive={toggle?.isActive}
        pending={save.isPending}
        onConfirm={() =>
          toggle &&
          save.mutate(
            { id: toggle.id, input: { name: toggle.name, area: toggle.area, isActive: !toggle.isActive } },
            {
              onSuccess: () => {
                toast.success(toggle.isActive ? 'Branch closed' : 'Branch reopened')
                setToggle(null)
              },
              onError: (e) => toast.error('Could not update the branch', { description: errorMessage(e) }),
            },
          )
        }
      />
    </div>
  )
}

function PerformanceTab() {
  const [range, setRange] = useState({ from: firstOfMonth(todayJhb()), to: todayJhb() })
  const q = useStaffPerformance(range.from, range.to, true)
  return (
    <div className="space-y-4">
      <DateRangeBar from={range.from} to={range.to} onChange={setRange} />
      {q.data && q.data.caveats.length > 0 && (
        <Callout tone="warning" title="Read these numbers with care">
          <ul className="list-disc space-y-1 pl-5">
            {q.data.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </Callout>
      )}
      {q.isLoading ? (
        <ListSkeleton rows={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.rows.length ? (
        <EmptyState icon={Users} title="No activity in this period" />
      ) : (
        <Card className="min-w-0 overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Person</TH>
                <TH className="text-right">Sales</TH>
                <TH className="text-right">Sales value</TH>
                <TH className="text-right">Average sale</TH>
                <TH className="text-right">Voided</TH>
                <TH className="text-right">Shifts closed</TH>
                <TH className="text-right">Cash-ups to review</TH>
                <TH className="text-right">Net cash difference</TH>
              </TR>
            </THead>
            <TBody>
              {q.data.rows.map((r) => (
                <TR key={r.userId}>
                  <TD>
                    <span className="block font-medium">{r.name}</span>
                    <span className="text-[12px] text-ink-muted">{roleLabel(r.role)}</span>
                  </TD>
                  <TD className="text-right tabular">{r.salesCount}</TD>
                  <TD className="text-right">
                    <Money cents={r.salesCents} />
                  </TD>
                  <TD className="text-right">
                    <Money cents={r.averageSaleCents} />
                  </TD>
                  <TD className="text-right tabular">{r.voidedCount}</TD>
                  <TD className="text-right tabular">{r.shiftsClosed}</TD>
                  <TD className="text-right tabular">{r.cashUpsNeedingReview}</TD>
                  <TD className="text-right">
                    <Money cents={r.netCashVarianceCents} tone="auto" />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  )
}

export function StaffPage() {
  const { can } = useAccess()
  const [params] = useSearchParams()
  const q = useStaffOverview()
  const revoke = useRevokeInvitation()
  const setActive = useSetMemberActive()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [roleFor, setRoleFor] = useState<StaffMemberDto | null>(null)
  const [activeFor, setActiveFor] = useState<StaffMemberDto | null>(null)
  const canManage = can('manageStaff')
  const data = q.data
  const branchName = (id: string) => data?.branches.find((b) => b.id === id)?.name ?? 'Unknown branch'

  return (
    <div className="space-y-6">
      <RoleHeader
        title="Staff"
        description="Who works in the business, what each role may do, the barbers customers can book, and where."
       
        actions={
          canManage && (
            <Button onClick={() => setInviteOpen(true)} disabled={!data}>
              <UserPlus /> Invite someone
            </Button>
          )
        }
      />
      {q.isLoading ? (
        <ListSkeleton rows={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : data ? (
        <Tabs defaultValue={params.get('tab') ?? 'team'}>
          <TabsList aria-label="Staff views">
            <TabsTrigger value="team">Logins & roles</TabsTrigger>
            <TabsTrigger value="profiles">Team profiles</TabsTrigger>
            <TabsTrigger value="branches">Branches</TabsTrigger>
            {can('viewBusinessInsights') && <TabsTrigger value="performance">Performance</TabsTrigger>}
          </TabsList>
          <TabsContent value="team" className="space-y-6">
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
              {data.members.map((m) => (
                <li key={m.userId} className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium break-words">
                      {m.displayName ?? m.email ?? 'Team member'} {m.isYou && <Badge variant="outline">You</Badge>}{' '}
                      {!m.isActive && <Badge variant="neutral">Deactivated</Badge>}
                    </p>
                    {m.email && m.displayName && <p className="text-[13px] break-all text-ink-muted">{m.email}</p>}
                    <p className="mt-1 flex flex-wrap gap-1.5">
                      <Badge variant={m.role === 'owner' ? 'forest' : 'info'}>{m.roleLabel}</Badge>
                      {m.branchIds.length > 0 ? (
                        m.branchIds.map((id) => (
                          <Badge key={id} variant="outline">
                            {branchName(id)}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-[12px] text-ink-muted">All branches</span>
                      )}
                    </p>
                  </div>
                  {canManage && !m.isYou && m.role !== 'owner' && (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" disabled={!m.isActive} onClick={() => setRoleFor(m)}>
                        <Pencil /> Change role
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setActiveFor(m)}>
                        <Power /> {m.isActive ? 'Deactivate' : 'Reactivate'}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {canManage && (
              <Card>
                <CardHeader>
                  <CardTitle>Pending invitations</CardTitle>
                  <CardDescription>Links you created that nobody has accepted yet.</CardDescription>
                </CardHeader>
                <CardContent>
                  {data.invitations.length === 0 ? (
                    <p className="text-sm text-ink-muted">No pending invitations.</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {data.invitations.map((i) => (
                        <li key={i.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium break-all">{i.email}</p>
                            <p className="text-[13px] text-ink-muted">
                              {roleLabel(i.role)} · {i.status === 'expired' ? 'expired' : `expires ${formatDateTime(i.expiresAt)}`}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="self-start text-red-700 hover:text-red-800 sm:self-center"
                            loading={revoke.isPending && revoke.variables === i.id}
                            onClick={() =>
                              revoke
                                .mutateAsync(i.id)
                                .then(() => toast.success('Invitation revoked'))
                                .catch((e: unknown) => toast.error('Could not revoke', { description: errorMessage(e) }))
                            }
                          >
                            <X /> Revoke
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            )}

            <details className="rounded-lg border border-line bg-surface p-4">
              <summary className="cursor-pointer text-sm font-semibold">What each role can do</summary>
              <ul className="mt-3 space-y-2">
                {data.roles.map((r) => (
                  <li key={r.key} className="text-[13px]">
                    <span className="font-semibold">{r.label}</span>
                    {r.branchScoped && <span className="text-ink-muted"> (branch-limited)</span>}:{' '}
                    <span className="text-ink-muted">{r.permissions.join(', ')}</span>
                  </li>
                ))}
              </ul>
            </details>
          </TabsContent>
          <TabsContent value="profiles">
            <TeamProfilesTab members={data.members} branches={data.branches} />
          </TabsContent>
          <TabsContent value="branches">
            <BranchesTab branches={data.branches} canManage={can('manageBranches')} />
          </TabsContent>
          {can('viewBusinessInsights') && (
            <TabsContent value="performance">
              <PerformanceTab />
            </TabsContent>
          )}
        </Tabs>
      ) : null}

      {data && <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} roles={data.roles} branches={data.branches} />}
      {data && <ChangeRoleDialog key={roleFor?.userId ?? 'none'} member={roleFor} onOpenChange={(o) => !o && setRoleFor(null)} roles={data.roles} branches={data.branches} />}
      <ConfirmDialog
        open={!!activeFor}
        onOpenChange={(o) => !o && setActiveFor(null)}
        title={activeFor?.isActive ? 'Deactivate this person?' : 'Reactivate this person?'}
        description={
          activeFor?.isActive
            ? 'They can no longer open this business. Everything they recorded stays on record. You can reactivate them later.'
            : 'They can open this business again with their previous role.'
        }
        confirmLabel={activeFor?.isActive ? 'Deactivate' : 'Reactivate'}
        destructive={activeFor?.isActive}
        pending={setActive.isPending}
        onConfirm={() =>
          activeFor &&
          setActive.mutate(
            { userId: activeFor.userId, active: !activeFor.isActive },
            {
              onSuccess: () => {
                toast.success(activeFor.isActive ? 'Deactivated' : 'Reactivated')
                setActiveFor(null)
              },
              onError: (e) => toast.error('Could not update', { description: errorMessage(e) }),
            },
          )
        }
      />
    </div>
  )
}
