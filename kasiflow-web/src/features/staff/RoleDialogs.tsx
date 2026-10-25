import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Checkbox, Input, NativeSelect } from '@/components/ui/input'
import { Callout } from '@/components/shared/Callout'
import { CopyButton } from '@/components/shared/CopyButton'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { formatDateTime } from '@/lib/format'
import { useAccess } from '@/features/access/useAccess'
import type { BranchDto, InvitationCreatedDto, RoleInfoDto, StaffMemberDto } from '@/types/automation'
import { useChangeRole, useInvite } from './api'

/** Roles the current person may hand out. Ownership is never assignable; only the owner manages admins. */
export function assignableRoles(roles: RoleInfoDto[], actorRole: string): RoleInfoDto[] {
  return roles.filter((r) => r.key !== 'owner' && (r.key !== 'business_admin' || actorRole === 'owner'))
}

function RoleAndBranches({
  idPrefix,
  roles,
  branches,
  role,
  setRole,
  branchIds,
  setBranchIds,
  errors,
}: {
  idPrefix: string
  roles: RoleInfoDto[]
  branches: BranchDto[]
  role: string
  setRole: (r: string) => void
  branchIds: string[]
  setBranchIds: (ids: string[]) => void
  errors: Record<string, string>
}) {
  const info = roles.find((r) => r.key === role)
  const active = branches.filter((b) => b.isActive)
  return (
    <>
      <Field id={`${idPrefix}-role`} label="Role" error={errors.role} hint={info ? `${info.permissions.length} permissions${info.branchScoped ? ' · limited to the chosen branches' : ' · all branches'}` : undefined}>
        <NativeSelect value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Choose a role</option>
          {roles.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {info?.branchScoped && (
        <fieldset aria-describedby={errors.branchIds ? `${idPrefix}-branches-error` : undefined}>
          <legend className="text-sm font-medium">Branches</legend>
          <p className="text-[13px] text-ink-muted">This role only sees records of the branches you choose. Choose at least one.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {active.map((b) => (
              <label key={b.id} className="flex cursor-pointer items-center gap-2.5 rounded-md border border-line-strong p-2.5 text-sm has-[:checked]:border-forest-800 has-[:checked]:bg-forest-50">
                <Checkbox
                  checked={branchIds.includes(b.id)}
                  onChange={(e) => setBranchIds(e.target.checked ? [...branchIds, b.id] : branchIds.filter((x) => x !== b.id))}
                />
                <span className="min-w-0 truncate">{b.name}</span>
              </label>
            ))}
          </div>
          {errors.branchIds && (
            <p id={`${idPrefix}-branches-error`} role="alert" className="mt-1.5 text-[13px] font-medium text-red-700">
              {errors.branchIds}
            </p>
          )}
        </fieldset>
      )}
    </>
  )
}

function validate(role: string, branchIds: string[], roles: RoleInfoDto[]): Record<string, string> {
  const errs: Record<string, string> = {}
  if (!role) errs.role = 'Choose a role.'
  else if (roles.find((r) => r.key === role)?.branchScoped && branchIds.length === 0) errs.branchIds = 'Choose at least one branch for this role.'
  return errs
}

function apiErrors(err: unknown): Record<string, string> | null {
  if (err instanceof ApiError && Object.keys(err.errors).length) return Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]]))
  return null
}

export function InviteDialog({ open, onOpenChange, roles, branches }: { open: boolean; onOpenChange: (o: boolean) => void; roles: RoleInfoDto[]; branches: BranchDto[] }) {
  const invite = useInvite()
  const { role: actorRole } = useAccess()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [branchIds, setBranchIds] = useState<string[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [created, setCreated] = useState<InvitationCreatedDto | null>(null)
  const options = assignableRoles(roles, actorRole)

  const close = (o: boolean) => {
    if (!o) {
      setEmail('')
      setRole('')
      setBranchIds([])
      setErrors({})
      setCreated(null)
    }
    onOpenChange(o)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const errs = validate(role, branchIds, roles)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs.email = "Enter the person's email address."
    setErrors(errs)
    if (Object.keys(errs).length) return
    const scoped = roles.find((r) => r.key === role)?.branchScoped
    invite.mutate(
      { email: email.trim(), role, branchIds: scoped ? branchIds : [] },
      {
        onSuccess: (r) => setCreated(r),
        onError: (err) => {
          const fe = apiErrors(err)
          if (fe) setErrors(fe)
          else toast.error('Could not create the invitation', { description: errorMessage(err) })
        },
      },
    )
  }

  const link = created ? `${window.location.origin}${created.acceptPath}` : ''

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Invitation ready</DialogTitle>
              <DialogDescription>
                Send this link to {created.invitation.email}. They sign in (or sign up) with that email address to join.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-4">
              <Callout tone="warning" title="This link is shown only once">
                {created.note || 'Copy it now. KasiFlow stores only a fingerprint of it and cannot show it again.'} It expires on{' '}
                {formatDateTime(created.invitation.expiresAt)}.
              </Callout>
              <div className="rounded-md border border-line bg-paper p-3">
                <code className="block text-[13px] break-all">{link}</code>
              </div>
              <CopyButton text={link} label="Copy invitation link" />
            </DialogBody>
            <DialogFooter>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogHeader>
              <DialogTitle>Invite someone</DialogTitle>
              <DialogDescription>You get a one-time link to share by WhatsApp or SMS. KasiFlow does not send emails.</DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-5">
              <Field id="inv-email" label="Their email address" error={errors.email} hint="They must sign in with this exact email to accept.">
                <Input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
              </Field>
              <RoleAndBranches idPrefix="inv" roles={options} branches={branches} role={role} setRole={setRole} branchIds={branchIds} setBranchIds={setBranchIds} errors={errors} />
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={invite.isPending}>
                Create invitation link
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function ChangeRoleDialog({
  member,
  onOpenChange,
  roles,
  branches,
}: {
  member: StaffMemberDto | null
  onOpenChange: (o: boolean) => void
  roles: RoleInfoDto[]
  branches: BranchDto[]
}) {
  const change = useChangeRole()
  const { role: actorRole } = useAccess()
  const [role, setRole] = useState(member?.role ?? '')
  const [branchIds, setBranchIds] = useState<string[]>(member?.branchIds ?? [])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const options = assignableRoles(roles, actorRole)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!member) return
    const errs = validate(role, branchIds, roles)
    setErrors(errs)
    if (Object.keys(errs).length) return
    const scoped = roles.find((r) => r.key === role)?.branchScoped
    change.mutate(
      { userId: member.userId, input: { role, branchIds: scoped ? branchIds : [] } },
      {
        onSuccess: () => {
          toast.success('Role updated')
          onOpenChange(false)
        },
        onError: (err) => {
          const fe = apiErrors(err)
          if (fe) setErrors(fe)
          else toast.error('Could not change the role', { description: errorMessage(err) })
        },
      },
    )
  }

  return (
    <Dialog open={!!member} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>Change role</DialogTitle>
            <DialogDescription>{member?.displayName ?? member?.email ?? 'Team member'} gets the new access straight away.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            <RoleAndBranches idPrefix="chg" roles={options} branches={branches} role={role} setRole={setRole} branchIds={branchIds} setBranchIds={setBranchIds} errors={errors} />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={change.isPending}>
              Save role
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
