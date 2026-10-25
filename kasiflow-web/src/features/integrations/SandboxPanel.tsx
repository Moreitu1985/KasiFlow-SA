import { useState } from 'react'
import { FlaskConical, Play, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input, NativeSelect } from '@/components/ui/input'
import { Callout } from '@/components/shared/Callout'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { MoneyInput } from '@/components/shared/MoneyInput'
import { errorMessage } from '@/lib/apiClient'
import { parseRandToCents } from '@/lib/format'
import { SANDBOX_SCENARIOS, type ScenarioDef } from '@/lib/automation'
import { useProducts } from '@/features/inventory/api'
import type { ConnectionDto, SimulateInput, SimulateResultDto } from '@/types/automation'
import { useResetSandbox, useSimulate } from './api'

interface Result extends SimulateResultDto {
  at: number
  error?: false
}
interface Failure {
  scenario: string
  message: string
  at: number
  error: true
}

const FIELD_LABELS: Record<ScenarioDef['fields'][number], string> = {
  amount: 'amount',
  reference: 'reference',
  method: 'method',
  sku: 'product',
  quantity: 'quantity',
  fee: 'fee',
}

export function SandboxPanel({ connection, canManage }: { connection: ConnectionDto | undefined; canManage: boolean }) {
  const simulate = useSimulate()
  const reset = useResetSandbox()
  const products = useProducts({ search: '' })
  const [amount, setAmount] = useState('150.00')
  const [reference, setReference] = useState('')
  const [method, setMethod] = useState<'qr' | 'card'>('qr')
  const [sku, setSku] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [fee, setFee] = useState('')
  const [results, setResults] = useState<(Result | Failure)[]>([])
  const [confirmReset, setConfirmReset] = useState(false)
  const stockProducts = (products.data ?? []).filter((p) => p.kind === 'product' && p.isActive)

  const ready = connection && connection.status === 'connected'

  const run = (def: ScenarioDef) => {
    if (!connection) return
    const input: SimulateInput = { scenario: def.key }
    if (def.fields.includes('amount') && amount.trim()) {
      const cents = parseRandToCents(amount)
      if (cents === null) {
        toast.error('Enter an amount like 150 or 150.50.')
        return
      }
      input.amountCents = cents
    }
    if (def.fields.includes('reference') && reference.trim()) input.reference = reference.trim()
    if (def.fields.includes('method')) input.method = method
    if (def.fields.includes('sku') && sku) input.sku = sku
    if (def.fields.includes('quantity')) input.quantity = Number.parseInt(quantity, 10) || 1
    if (def.fields.includes('fee') && fee.trim()) {
      const cents = parseRandToCents(fee)
      if (cents === null) {
        toast.error('Enter a fee like 4.50, or leave it empty for the illustrative 2.95%.')
        return
      }
      input.feeCents = cents
    }
    simulate.mutate(
      { connectionId: connection.id, input },
      {
        onSuccess: (r) => setResults((prev) => [{ ...r, at: Date.now() }, ...prev].slice(0, 8)),
        onError: (e) => setResults((prev) => [{ scenario: def.key, message: errorMessage(e), at: Date.now(), error: true as const }, ...prev].slice(0, 8)),
      },
    )
  }

  return (
    <Card className="min-w-0 border-ochre/60">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <FlaskConical className="size-5 text-ochre" aria-hidden />
          <CardTitle>Sandbox simulator</CardTitle>
          <Badge variant="forest" className="border-ochre bg-ochre text-forest-950">
            SIMULATED — NOT REAL MONEY
          </Badge>
        </div>
        <CardDescription>
          Sends signed, clearly labelled test events through the same webhook pipeline real providers use. A background worker processes them, so results
          appear in Reconciliation and Transactions a few seconds later.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!ready ? (
          <Callout tone="info" title="Connect the sandbox first">
            Use “Connect” on the KasiFlow sandbox card below. It is only available on this fictional demo business.
          </Callout>
        ) : !canManage ? (
          <Callout tone="neutral" title="View only">
            Your role cannot run simulations.
          </Callout>
        ) : (
          <>
            <fieldset className="grid min-w-0 gap-4 rounded-lg border border-line bg-paper p-4 sm:grid-cols-2 lg:grid-cols-3">
              <legend className="px-1 text-[13px] font-semibold">Event details (used where relevant)</legend>
              <Field id="sbx-amount" label="Amount" hint="R1 to R100 000">
                <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              <Field id="sbx-ref" label="Merchant reference" optional hint="Match a sale's reference to test auto-matching.">
                <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} />
              </Field>
              <Field id="sbx-method" label="Method">
                <NativeSelect value={method} onChange={(e) => setMethod(e.target.value as 'qr' | 'card')}>
                  <option value="qr">QR code</option>
                  <option value="card">Card</option>
                </NativeSelect>
              </Field>
              <Field id="sbx-sku" label="Product (POS sale)" hint={stockProducts.length === 0 ? 'Add a stock product in Inventory first.' : undefined}>
                <NativeSelect value={sku} onChange={(e) => setSku(e.target.value)}>
                  <option value="">First active product</option>
                  {stockProducts.map((p) => (
                    <option key={p.id} value={p.sku}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="sbx-qty" label="Quantity (POS sale)" hint="1 to 50">
                <Input type="number" inputMode="numeric" min={1} max={50} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </Field>
              <Field id="sbx-fee" label="Settlement fee" optional hint="Empty = illustrative 2.95%. Real fees come from the provider.">
                <MoneyInput value={fee} onChange={(e) => setFee(e.target.value)} />
              </Field>
            </fieldset>

            <ul className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {SANDBOX_SCENARIOS.map((def) => (
                <li key={def.key} className="flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-surface p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{def.label}</p>
                    <p className="text-[13px] text-ink-muted">{def.description}</p>
                    {def.fields.length > 0 && <p className="mt-0.5 text-[12px] text-ink-muted">Uses: {def.fields.map((f) => FIELD_LABELS[f]).join(', ')}</p>}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-auto self-start"
                    loading={simulate.isPending && simulate.variables?.input.scenario === def.key}
                    disabled={simulate.isPending}
                    onClick={() => run(def)}
                  >
                    <Play /> Simulate
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}

        {results.length > 0 && (
          <section aria-labelledby="sbx-results" aria-live="polite">
            <h3 id="sbx-results" className="font-sans text-sm font-semibold">
              Results
            </h3>
            <ul className="mt-2 space-y-2">
              {results.map((r) => (
                <li key={r.at} className={`rounded-md border p-3 text-sm ${r.error ? 'border-red-200 bg-red-50' : 'border-line bg-paper'}`}>
                  <p className="font-medium break-words">
                    <span className="mr-1.5 text-ink-muted">{SANDBOX_SCENARIOS.find((s) => s.key === r.scenario)?.label ?? r.scenario}:</span>
                    {r.message}
                  </p>
                  {!r.error && r.deliveries.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {r.deliveries.map((d, i) => (
                        <li key={`${d.externalEventId}-${i}`} className="flex flex-wrap items-center gap-2 text-[12px]">
                          <Badge variant={d.httpStatus >= 400 ? 'critical' : d.outcome.includes('duplicate') ? 'neutral' : 'success'}>HTTP {d.httpStatus}</Badge>
                          <span className="font-medium">{d.outcome}</span>
                          <code className="break-all text-ink-muted">{d.externalEventId}</code>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {canManage && (
          <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-ink-muted">Removes every simulated payment, settlement and sale (and their stock changes) from this demo business.</p>
            <Button variant="outline" className="shrink-0 text-red-700 hover:text-red-800" onClick={() => setConfirmReset(true)}>
              <RotateCcw /> Reset sandbox data
            </Button>
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset sandbox data?"
        description="All simulated provider payments, settlements, events and the sales created from them are removed, and their stock changes are reversed. Sales you recorded yourself stay, but lose their match. This only affects the demo business."
        confirmLabel="Reset sandbox data"
        destructive
        pending={reset.isPending}
        onConfirm={() =>
          reset.mutate(undefined, {
            onSuccess: (r) => {
              toast.success('Sandbox data reset', {
                description: `${r.paymentsRemoved} payment(s) and ${r.transactionsRemoved} simulated sale(s) removed; ${r.stockMovementsReversed} stock movement(s) reversed.`,
              })
              setResults([])
              setConfirmReset(false)
            },
            onError: (e) => toast.error('Could not reset', { description: errorMessage(e) }),
          })
        }
      />
    </Card>
  )
}
