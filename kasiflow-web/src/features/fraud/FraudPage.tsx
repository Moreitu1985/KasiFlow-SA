import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ListChecks, NotebookPen, Pencil, Plus, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAccess } from '@/features/access/useAccess'
import { Badge } from '@/components/ui/badge'
import { Checkbox, NativeSelect } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RoleHeader } from '@/features/access/RoleHeader'
import { Callout } from '@/components/shared/Callout'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/States'
import { formatDate } from '@/lib/format'
import { INCIDENT_STATUS, INCIDENT_TYPES, entries } from '@/lib/labels'
import { cn } from '@/lib/utils'
import type { FraudIncidentDto, IncidentStatus } from '@/types/api'
import { FRAUD_TOPICS, PRE_PAYMENT_CHECKLIST, type FraudTopic } from './content'
import { useIncidents } from './api'
import { IncidentDialog } from './IncidentDialog'

function TopicCard({ t }: { t: FraudTopic }) {
  const [open, setOpen] = useState(false)
  const id = `topic-${t.type}`
  return (
    <article className="flex flex-col rounded-lg border border-line bg-surface shadow-card">
      <div className="flex-1 p-5">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-md bg-forest-50 text-forest-800">
            <t.icon className="size-5" aria-hidden />
          </span>
          <h3 className="font-sans text-[15px] font-semibold">{t.title}</h3>
        </div>
        <p className="mt-2.5 text-sm leading-relaxed text-ink-soft">{t.summary}</p>
        {open && (
          <div id={id} className="mt-4 space-y-4">
            <div>
              <h4 className="text-[13px] font-semibold text-amber-800">Warning signs</h4>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink-soft">
                {t.signs.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-[13px] font-semibold text-forest-800">What you can do</h4>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink-soft">
                {t.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex cursor-pointer items-center gap-1.5 border-t border-line px-5 py-2.5 text-left text-sm font-semibold text-forest-800 hover:bg-paper"
      >
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
        {open ? 'Show less' : 'Warning signs and what to do'}
      </button>
    </article>
  )
}

function PrePaymentChecklist() {
  const [checked, setChecked] = useState<boolean[]>(() => PRE_PAYMENT_CHECKLIST.map(() => false))
  const done = checked.filter(Boolean).length
  const all = done === checked.length
  return (
    <section aria-labelledby="checklist-title" className="rounded-lg border border-line bg-surface p-5 shadow-card">
      <div className="flex items-start gap-3">
        <ListChecks className="mt-0.5 size-5 text-forest-800" aria-hidden />
        <div className="flex-1">
          <h2 id="checklist-title" className="text-lg font-bold">
            Before you pay — or release goods
          </h2>
          <p className="text-sm text-ink-muted">Run through this whenever a payment feels unusual. It is not saved.</p>
        </div>
      </div>
      <ul className="mt-4 space-y-2">
        {PRE_PAYMENT_CHECKLIST.map((item, i) => (
          <li key={item}>
            <label className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 text-sm leading-relaxed hover:bg-paper">
              <Checkbox
                className="mt-0.5"
                checked={checked[i]}
                onChange={(e) => setChecked((c) => c.map((v, j) => (j === i ? e.target.checked : v)))}
              />
              {item}
            </label>
          </li>
        ))}
      </ul>
      <p role="status" className={cn('mt-3 rounded-md px-3 py-2 text-sm', all ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900')}>
        {all
          ? 'All checks ticked. That lowers the risk, but trust your instincts — if something still feels wrong, wait and verify.'
          : `${done} of ${checked.length} checked. If you can't tick an item, stop and verify before paying.`}
      </p>
      <Button variant="ghost" size="sm" className="mt-2" onClick={() => setChecked(PRE_PAYMENT_CHECKLIST.map(() => false))}>
        Clear checklist
      </Button>
    </section>
  )
}

function IncidentLog() {
  const { can } = useAccess()
  const [status, setStatus] = useState<IncidentStatus | ''>('')
  const [dialog, setDialog] = useState<{ open: boolean; incident?: FraudIncidentDto }>({ open: false })
  const q = useIncidents(status)
  return (
    <section aria-labelledby="log-title">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="log-title" className="text-lg font-bold">
            Incident log
          </h2>
          <p className="text-sm text-ink-muted">A private record of suspicious events — useful if you report to your bank or SAPS.</p>
        </div>
        <div className="flex gap-2">
          <div>
            <Label htmlFor="inc-status" className="sr-only">
              Status
            </Label>
            <NativeSelect id="inc-status" className="h-10 w-36" value={status} onChange={(e) => setStatus(e.target.value as IncidentStatus | '')}>
              <option value="">All</option>
              {entries(INCIDENT_STATUS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </div>
          {can('manageFraud', 'recordSales') && (
            <Button onClick={() => setDialog({ open: true })}>
              <Plus /> Log incident
            </Button>
          )}
        </div>
      </div>
      <Callout tone="info" className="mb-4">
        Keep this log factual and private. Do not publish accusations about identifiable people online or on social media — report suspected fraud to your bank and SAPS instead.
      </Callout>
      {q.isLoading ? (
        <ListSkeleton rows={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon={NotebookPen} title="No incidents logged" description="Nothing logged yet. If something suspicious happens, write it down while the details are fresh." />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {q.data.map((i) => (
            <li key={i.id} className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{INCIDENT_TYPES[i.incidentType]}</p>
                  <Badge variant={i.status === 'resolved' ? 'success' : i.status === 'monitoring' ? 'info' : 'warning'}>{INCIDENT_STATUS[i.status]}</Badge>
                  <span className="text-[13px] text-ink-muted">{formatDate(i.incidentDate)}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{i.description}</p>
                {i.actionTaken && <p className="mt-1 text-[13px] text-ink-muted">Action: {i.actionTaken}</p>}
                {i.relatedTransactionId && (
                  <Link to={`/transactions/${i.relatedTransactionId}`} className="mt-1 inline-block text-[13px] font-semibold text-forest-800 hover:underline">
                    View related transaction
                  </Link>
                )}
              </div>
              {can('manageFraud') && (
                <Button variant="outline" size="sm" onClick={() => setDialog({ open: true, incident: i })}>
                  <Pencil /> Update
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <IncidentDialog open={dialog.open} incident={dialog.incident} onOpenChange={(open) => setDialog((d) => ({ ...d, open }))} />
    </section>
  )
}

export function FraudPage() {
  return (
    <div className="space-y-8">
      <RoleHeader
        title="Fraud protection"
        description="Common scams aimed at small businesses in South Africa, how to spot them, and what to check before money changes hands."
       
      />
      <div className="flex items-start gap-3 rounded-lg border border-forest-800/20 bg-forest-50 p-4">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-forest-800" aria-hidden />
        <p className="text-sm leading-relaxed text-forest-950">
          <strong>Three rules that stop most scams:</strong> check your own banking app before releasing goods; confirm changed bank details by calling a number you already have; and never share a PIN, password or OTP — banks never ask for them.
        </p>
      </div>
      <section aria-labelledby="learn-title">
        <h2 id="learn-title" className="mb-3 text-lg font-bold">
          Learn the warning signs
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {FRAUD_TOPICS.map((t) => (
            <TopicCard key={t.type} t={t} />
          ))}
        </div>
        <p className="mt-3 text-[13px] text-ink-muted">
          This guidance helps you decide what to check. A warning sign does not prove that someone is committing fraud, and the absence of signs does not guarantee a payment is safe.
        </p>
      </section>
      <div className="grid gap-8 xl:grid-cols-[2fr_3fr]">
        <PrePaymentChecklist />
        <IncidentLog />
      </div>
    </div>
  )
}
