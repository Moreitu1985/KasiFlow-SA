import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Banknote, Car, Images, KeyRound, Link2, Lock, Pencil, Plus, Scissors, Send, UserPlus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/States'
import { StaffStatusBadge } from '@/components/shared/StatusBadges'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { useAccess } from '@/features/access/useAccess'
import { useLoginInvite, useSaveProfile, useTeam } from '@/features/team/api'
import { PortfolioManager } from '@/features/portfolio/PortfolioManager'
import { formatDateTime } from '@/lib/format'
import { isEmail } from '@/lib/customer'
import type { RegisterBarberResultDto } from '@/types/customer'
import { InviteLinkResult } from './InviteLinkResult'
import { PayTermsDialog } from '@/features/pay/PayDialogs'
import { HoursEditor } from '@/features/workspace/HoursEditor'
import type { BranchDto, StaffMemberDto } from '@/types/automation'
import type { StaffProfileDto } from '@/types/barbershop'

const EMPTY_PROFILE = {
  displayName: '',
  roleTitle: 'Barber',
  branchId: '',
  userId: '',
  isBookable: true,
  acceptsHouseCalls: false,
  isActive: true,
  bio: '',
  specialties: '',
  contactPhone: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
}

function ProfileDialog({
  profile,
  open,
  onOpenChange,
  members,
  branches,
  linked,
}: {
  profile: StaffProfileDto | null
  open: boolean
  onOpenChange: (o: boolean) => void
  members: StaffMemberDto[]
  branches: BranchDto[]
  linked: Set<string>
}) {
  const save = useSaveProfile()
  const [v, setV] = useState(EMPTY_PROFILE)
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!open) return
    setErrors({})
    setV(
      profile
        ? {
            displayName: profile.displayName,
            roleTitle: profile.roleTitle,
            branchId: profile.branchId ?? '',
            userId: profile.userId ?? '',
            isBookable: profile.isBookable,
            acceptsHouseCalls: profile.acceptsHouseCalls,
            isActive: profile.isActive,
            bio: profile.bio ?? '',
            specialties: profile.specialties ?? '',
            contactPhone: profile.contactPhone ?? '',
            emergencyContactName: profile.emergencyContactName ?? '',
            emergencyContactPhone: profile.emergencyContactPhone ?? '',
          }
        : { ...EMPTY_PROFILE, branchId: branches.find((b) => b.isActive)?.id ?? '' },
    )
  }, [open, profile, branches])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!v.displayName.trim()) return setErrors({ displayName: 'Enter the name customers will see.' })
    save.mutate(
      {
        id: profile?.id,
        input: {
          displayName: v.displayName.trim(),
          roleTitle: v.roleTitle.trim() || null,
          branchId: v.branchId || null,
          userId: v.userId || null,
          isBookable: v.isBookable,
          acceptsHouseCalls: v.acceptsHouseCalls,
          isActive: v.isActive,
          bio: v.bio.trim() || null,
          specialties: v.specialties.trim() || null,
          contactPhone: v.contactPhone.trim() || null,
          emergencyContactName: v.emergencyContactName.trim() || null,
          emergencyContactPhone: v.emergencyContactPhone.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast.success(profile ? 'Profile saved' : 'Profile created')
          onOpenChange(false)
        },
        onError: (err) => {
          if (err instanceof ApiError && Object.keys(err.errors).length) setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, x]) => [k, x[0]])))
          else toast.error('Could not save the profile', { description: errorMessage(err) })
        },
      },
    )
  }

  const options = members.filter((m) => m.isActive && (!linked.has(m.userId) || m.userId === profile?.userId))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>{profile ? `Edit ${profile.displayName}` : 'New team profile'}</DialogTitle>
            <DialogDescription>A profile is the person customers book. Link it to a login so they can use the Barber Workspace.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Field id="tp-name" label="Display name" hint="Customers see this name on the booking page." error={errors.displayName}>
              <Input maxLength={80} value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} />
            </Field>
            <Field id="tp-title" label="Role title" optional error={errors.roleTitle}>
              <Input maxLength={60} value={v.roleTitle} onChange={(e) => setV({ ...v, roleTitle: e.target.value })} placeholder="Barber, Junior barber, Stylist…" />
            </Field>
            {branches.length > 0 && (
              <Field id="tp-branch" label="Branch" optional error={errors.branchId}>
                <NativeSelect value={v.branchId} onChange={(e) => setV({ ...v, branchId: e.target.value })}>
                  <option value="">No specific branch</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Field id="tp-bio" label="Short bio" optional hint="Shown on the booking page." error={errors.bio}>
              <Textarea rows={2} maxLength={300} value={v.bio} onChange={(e) => setV({ ...v, bio: e.target.value })} />
            </Field>
            <Field id="tp-spec" label="Good at" optional hint="Shown on the booking page." error={errors.specialties}>
              <Input maxLength={160} value={v.specialties} onChange={(e) => setV({ ...v, specialties: e.target.value })} placeholder="Fades, line-ups…" />
            </Field>
            <fieldset className="space-y-3 rounded-lg border border-line bg-paper/60 p-3">
              <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold">
                <Lock className="size-4 text-forest-800" aria-hidden /> Private: managers only
              </legend>
              <p className="-mt-1 text-[13px] text-ink-soft">Never shown to customers. Used to reach the barber or someone close to them if a house call goes wrong.</p>
              <Field id="tp-phone" label="Barber’s phone" optional error={errors.contactPhone}>
                <Input type="tel" maxLength={30} value={v.contactPhone} onChange={(e) => setV({ ...v, contactPhone: e.target.value })} />
              </Field>
              <Field id="tp-ecn" label="Emergency contact name" optional error={errors.emergencyContactName}>
                <Input maxLength={80} value={v.emergencyContactName} onChange={(e) => setV({ ...v, emergencyContactName: e.target.value })} />
              </Field>
              <Field id="tp-ecp" label="Emergency contact phone" optional error={errors.emergencyContactPhone}>
                <Input type="tel" maxLength={30} value={v.emergencyContactPhone} onChange={(e) => setV({ ...v, emergencyContactPhone: e.target.value })} />
              </Field>
            </fieldset>
            <Field id="tp-user" label="Linked login" optional hint="Only active team members who are not linked to another profile are listed." error={errors.userId}>
              <NativeSelect value={v.userId} onChange={(e) => setV({ ...v, userId: e.target.value })}>
                <option value="">Not linked</option>
                {options.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {(m.displayName ?? m.email ?? 'Team member') + ` (${m.roleLabel})`}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {(
              [
                ['isBookable', 'Customers can book this person'],
                ['acceptsHouseCalls', 'Does house calls'],
                ...(profile ? ([['isActive', 'Active']] as const) : []),
              ] as const
            ).map(([k, label]) => (
              <div key={k} className="flex items-center justify-between gap-3">
                <Label htmlFor={`tp-${k}`}>{label}</Label>
                <Switch id={`tp-${k}`} checked={v[k]} onCheckedChange={(c) => setV({ ...v, [k]: c })} />
              </div>
            ))}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save profile
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function HoursDialog({ profile, onOpenChange }: { profile: StaffProfileDto | null; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={!!profile} onOpenChange={onOpenChange}>
      <DialogContent variant="sheet">
        <DialogHeader>
          <DialogTitle>{profile?.displayName}: working hours</DialogTitle>
          <DialogDescription>Changes are recorded in the history with your name.</DialogDescription>
        </DialogHeader>
        <DialogBody className="p-0 sm:p-0">{profile && <HoursEditor staffId={profile.id} hours={profile.hours} title="Working hours" />}</DialogBody>
      </DialogContent>
    </Dialog>
  )
}

function LoginLinkDialog({ profile, onOpenChange }: { profile: StaffProfileDto | null; onOpenChange: (o: boolean) => void }) {
  const invite = useLoginInvite()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<RegisterBarberResultDto | null>(null)
  useEffect(() => {
    if (!profile) return
    setEmail(profile.pendingLogin?.email ?? '')
    setError(undefined)
    setResult(null)
  }, [profile])
  return (
    <Dialog open={!!profile} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Login link for {profile?.displayName}</DialogTitle>
          <DialogDescription>They get their own barber screen: status, today’s customers, safety check-ins and photos of their work.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {result?.invitePath && profile ? (
            <InviteLinkResult name={profile.displayName} email={result.profile.pendingLogin?.email ?? email} invitePath={result.invitePath} inviteMessage={result.inviteMessage} expiresAt={result.profile.pendingLogin?.expiresAt} />
          ) : (
            <form
              id="login-link-form"
              noValidate
              onSubmit={(e) => {
                e.preventDefault()
                if (!profile) return
                if (!isEmail(email)) return setError('Enter the email address they will sign in with.')
                setError(undefined)
                invite.mutate(
                  { staffId: profile.id, email: email.trim() },
                  {
                    onSuccess: (r) => setResult(r),
                    onError: (err) => (err instanceof ApiError && err.fieldError('email') ? setError(err.fieldError('email')) : setError(errorMessage(err))),
                  },
                )
              }}
            >
              <Field id="ll-email" label="Their email address" hint="A new link replaces any earlier one for this profile. Nothing is emailed: you share the link." error={error}>
                <Input type="email" autoComplete="off" maxLength={160} value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
            </form>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {result ? 'Done' : 'Cancel'}
          </Button>
          {!result && (
            <Button type="submit" form="login-link-form" loading={invite.isPending}>
              <Send /> Create login link
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PortfolioDialog({ profile, onOpenChange }: { profile: StaffProfileDto | null; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={!!profile} onOpenChange={onOpenChange}>
      <DialogContent variant="sheet">
        <DialogHeader>
          <DialogTitle>{profile?.displayName}: photos of their work</DialogTitle>
          <DialogDescription>Public photos show on the booking page. Only upload photos the customer agreed to.</DialogDescription>
        </DialogHeader>
        <DialogBody>{profile && <PortfolioManager staffId={profile.id} services={profile.services} embedded />}</DialogBody>
      </DialogContent>
    </Dialog>
  )
}

/** Bookable team profiles (barbers), separate from logins: a barber can exist before they have an account. */
export function TeamProfilesTab({ members, branches }: { members: StaffMemberDto[]; branches: BranchDto[] }) {
  const { can } = useAccess()
  const q = useTeam()
  const [editing, setEditing] = useState<{ open: boolean; profile: StaffProfileDto | null }>({ open: false, profile: null })
  const [hoursFor, setHoursFor] = useState<StaffProfileDto | null>(null)
  const [loginFor, setLoginFor] = useState<StaffProfileDto | null>(null)
  const [photosFor, setPhotosFor] = useState<StaffProfileDto | null>(null)
  const [payFor, setPayFor] = useState<{ id: string; name: string } | null>(null)
  const canManage = can('manageStaff')
  const linked = new Set((q.data ?? []).map((p) => p.userId).filter((x): x is string => !!x))
  const memberName = (id: string | null) => {
    if (!id) return null
    const m = members.find((x) => x.userId === id)
    return m ? (m.displayName ?? m.email ?? 'Team member') : 'A team login'
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex flex-col gap-3 rounded-lg border border-forest-800/20 bg-forest-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">Register a barber</p>
            <p className="text-[13px] text-ink-soft">Details, services and prices, hours, house calls and a login link, in four short steps.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/team/register">
                <UserPlus /> Register a barber
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setEditing({ open: true, profile: null })}>
              <Plus /> Quick profile
            </Button>
          </div>
        </div>
      )}
      {q.isLoading ? (
        <ListSkeleton rows={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon={Scissors} title="No team profiles yet" description="Add each barber so customers can book them." />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {q.data.map((p) => (
            <li key={p.id} className={`flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center ${p.isActive ? '' : 'opacity-60'}`}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {p.displayName} <span className="font-normal text-ink-muted">· {p.roleTitle}</span>
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5">
                  <StaffStatusBadge status={p.status.status} label={p.status.label} stale={p.status.stale} />
                  {!p.isActive && <Badge variant="neutral">Inactive</Badge>}
                  {p.isBookable ? <Badge variant="info">Bookable</Badge> : <Badge variant="neutral">Not bookable</Badge>}
                  {p.acceptsHouseCalls && (
                    <Badge variant="outline">
                      <Car aria-hidden /> House calls
                    </Badge>
                  )}
                </p>
                <p className="mt-1 inline-flex items-start gap-1 text-[13px] text-ink-muted">
                  {p.userId || p.hasLogin ? <Link2 className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
                  <span className="[overflow-wrap:anywhere]">
                    {p.userId
                      ? `Linked to ${memberName(p.userId)}`
                      : p.pendingLogin
                        ? `Invite for ${p.pendingLogin.email}, expires ${formatDateTime(p.pendingLogin.expiresAt)}`
                        : 'No login yet'}
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {can('manageStaffSchedules') && (
                  <Button size="sm" variant="outline" onClick={() => setHoursFor(p)}>
                    Hours
                  </Button>
                )}
                {canManage && !p.userId && !p.hasLogin && (
                  <Button size="sm" variant={p.pendingLogin ? 'outline' : 'default'} onClick={() => setLoginFor(p)}>
                    <Send /> {p.pendingLogin ? 'New login link' : 'Send login link'}
                  </Button>
                )}
                {(canManage || p.isYou) && (
                  <Button size="sm" variant="outline" onClick={() => setPhotosFor(p)}>
                    <Images /> Photos{p.photoCount ? ` (${p.photoCount})` : ''}
                  </Button>
                )}
                {canManage && (
                  <Button size="sm" variant="outline" onClick={() => setPayFor({ id: p.id, name: p.displayName })}>
                    <Banknote /> Pay terms
                  </Button>
                )}
                {canManage && (
                  <Button size="sm" variant="outline" onClick={() => setEditing({ open: true, profile: p })}>
                    <Pencil /> Edit
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ProfileDialog
        profile={editing.profile}
        open={editing.open}
        onOpenChange={(o) => setEditing((x) => ({ ...x, open: o }))}
        members={members}
        branches={branches}
        linked={linked}
      />
      <HoursDialog profile={hoursFor} onOpenChange={(o) => !o && setHoursFor(null)} />
      <LoginLinkDialog profile={loginFor} onOpenChange={(o) => !o && setLoginFor(null)} />
      <PortfolioDialog profile={photosFor} onOpenChange={(o) => !o && setPhotosFor(null)} />
      {canManage && <PayTermsDialog staff={payFor} onOpenChange={(o) => !o && setPayFor(null)} />}
    </div>
  )
}
