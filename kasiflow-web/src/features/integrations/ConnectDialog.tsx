import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, NativeSelect } from '@/components/ui/input'
import { Callout } from '@/components/shared/Callout'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { useBranches } from '@/features/branches/api'
import type { ProviderCardDto } from '@/types/automation'
import { useConnect } from './api'

const REF_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export function ConnectDialog({ card, onOpenChange }: { card: ProviderCardDto | null; onOpenChange: (open: boolean) => void }) {
  const connect = useConnect()
  const branches = useBranches()
  const [displayName, setDisplayName] = useState('')
  const [credentialRef, setCredentialRef] = useState('')
  const [branchId, setBranchId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const isSnap = card?.key === 'snapscan'
  const activeBranches = (branches.data ?? []).filter((b) => b.isActive)

  const close = (open: boolean) => {
    if (!open) {
      setDisplayName('')
      setCredentialRef('')
      setBranchId('')
      setErrors({})
    }
    onOpenChange(open)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!card) return
    const errs: Record<string, string> = {}
    if (isSnap && !REF_PATTERN.test(credentialRef.trim()))
      errs.credentialRef = "Use a short name with letters, numbers, '-' or '_' (for example main). Never paste the API key here."
    if (displayName.trim().length > 80) errs.displayName = 'Use 80 characters or fewer.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    connect.mutate(
      {
        providerKey: card.key,
        displayName: displayName.trim() || null,
        credentialRef: isSnap ? credentialRef.trim() : null,
        defaultBranchId: branchId || null,
      },
      {
        onSuccess: (r) => {
          if (r.ok) toast.success(`${r.connection.displayName} connected`, { description: r.connection.health.label })
          else toast.warning(`${r.connection.displayName} added, but not connected yet`, { description: [r.error, r.hint].filter(Boolean).join(' ') })
          close(false)
        },
        onError: (err) => {
          if (err instanceof ApiError && Object.keys(err.errors).length) {
            setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]])))
          } else toast.error('Could not connect', { description: errorMessage(err) })
        },
      },
    )
  }

  return (
    <Dialog open={!!card} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>Connect {card?.name}</DialogTitle>
            <DialogDescription>
              {isSnap
                ? 'KasiFlow only shows “Connected” after SnapScan accepts the key during a connection test.'
                : 'The sandbox sends clearly labelled, simulated events through the real processing pipeline. Never real money.'}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            {isSnap && (
              <Callout tone="info" title="Secrets stay on the server">
                <p>
                  Do not paste your SnapScan API key or webhook key into the browser. Choose a short credential name here, then set these
                  environment variables on the API server:
                </p>
                <code className="mt-2 block text-[12px] break-all">
                  Integrations__SnapScan__Credentials__{credentialRef.trim() || '<name>'}__ApiKey
                  <br />
                  Integrations__SnapScan__Credentials__{credentialRef.trim() || '<name>'}__WebhookKey
                </code>
              </Callout>
            )}
            {isSnap && (
              <Field
                id="cn-ref"
                label={
                  <span className="inline-flex items-center gap-1.5">
                    <KeyRound className="size-4" aria-hidden /> Credential name
                  </span>
                }
                hint="Only a label, for example “main”. It tells the server which configured key to use."
                error={errors.credentialRef}
              >
                <Input value={credentialRef} onChange={(e) => setCredentialRef(e.target.value)} placeholder="main" autoComplete="off" spellCheck={false} maxLength={64} />
              </Field>
            )}
            <Field id="cn-name" label="Display name" optional error={errors.displayName}>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={isSnap ? 'SnapScan' : 'Demo sandbox'} maxLength={80} />
            </Field>
            {activeBranches.length > 1 && (
              <Field id="cn-branch" label="Default branch for these payments" optional error={errors.defaultBranchId} hint="Used when the provider does not say which branch a sale belongs to.">
                <NativeSelect value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                  <option value="">First branch</option>
                  {activeBranches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            {errors.providerKey && <p className="text-[13px] font-medium text-red-700">{errors.providerKey}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={connect.isPending}>
              Connect and test
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
