import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertOctagon, AlertTriangle, Bell, CalendarDays, CheckCheck, HandCoins, Info, LifeBuoy, ShieldAlert, type LucideIcon } from 'lucide-react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { formatDateTime } from '@/lib/format'
import { appLink, NOTIFICATION_KINDS } from '@/lib/automation'
import { cn } from '@/lib/utils'
import type { NotificationDto } from '@/types/automation'
import { useAccess } from '@/features/access/useAccess'
import { useMarkRead, useNotifications } from './api'

const SEVERITY = {
  critical: { Icon: AlertOctagon, cls: 'text-red-700', dot: 'bg-red-600', label: 'Critical' },
  warning: { Icon: AlertTriangle, cls: 'text-amber-700', dot: 'bg-amber-500', label: 'Warning' },
  informational: { Icon: Info, cls: 'text-sky-700', dot: 'bg-sky-600', label: 'Info' },
} as const

const KIND_ICON: Record<string, LucideIcon> = { booking: CalendarDays, alert: ShieldAlert, debt: HandCoins, safety: LifeBuoy }

function Item({ n, onOpen }: { n: NotificationDto; onOpen: (n: NotificationDto) => void }) {
  const s = SEVERITY[n.severity] ?? SEVERITY.informational
  const Icon = KIND_ICON[n.kind] ?? s.Icon
  const kind = NOTIFICATION_KINDS[n.kind]
  return (
    <Menu.Item
      onSelect={() => onOpen(n)}
      className={cn('flex cursor-pointer gap-2.5 rounded-md px-2.5 py-2 outline-none select-none data-[highlighted]:bg-forest-50', !n.readAt && 'bg-forest-50/50')}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', s.cls)} aria-label={kind ? `${kind}, ${s.label.toLowerCase()}` : s.label} />
      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm leading-snug', !n.readAt ? 'font-semibold' : 'font-medium text-ink-soft')}>
          {n.title}
          {!n.readAt && <span className="sr-only"> (unread)</span>}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-ink-muted">{n.body}</span>
        <span className="mt-0.5 block text-[11px] text-ink-muted">{formatDateTime(n.createdAt)}</span>
      </span>
      {!n.readAt && <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', s.dot)} aria-hidden />}
    </Menu.Item>
  )
}

/** Header bell: unread count (polled every 30 s while the tab is visible) and the latest notifications. */
export function NotificationBell({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const q = useNotifications()
  const mark = useMarkRead()
  const navigate = useNavigate()
  const { experience } = useAccess()
  const [open, setOpen] = useState(false)
  const unread = q.data?.unreadCount ?? 0
  const items = (q.data?.items ?? []).slice(0, 12)

  const openItem = (n: NotificationDto) => {
    if (!n.readAt) mark.mutate(n.id)
    const to = appLink(n.link)
    if (to) navigate(to)
  }

  return (
    <Menu.Root modal={false} open={open} onOpenChange={setOpen}>
      <Menu.Trigger asChild>
        <button
          type="button"
          className={cn(
            'relative inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors',
            tone === 'light' ? 'text-ink hover:bg-forest-50' : 'text-white hover:bg-white/10',
          )}
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <Bell className="size-5" aria-hidden />
          {unread > 0 && (
            <span className="absolute top-1 right-1 flex min-w-4.5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] leading-4.5 font-bold text-white" aria-hidden>
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={6} collisionPadding={8} className="z-50 w-[min(24rem,calc(100vw-1rem))] rounded-lg border border-line bg-surface p-1 shadow-raised">
          <div className="flex items-center justify-between gap-2 px-2.5 py-2">
            <p className="text-sm font-semibold">Notifications</p>
            <Menu.Item
              disabled={unread === 0}
              onSelect={(e) => {
                e.preventDefault()
                mark.mutate(null)
              }}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-semibold text-forest-800 outline-none data-[disabled]:cursor-default data-[disabled]:opacity-50 data-[highlighted]:bg-forest-50"
            >
              <CheckCheck className="size-4" aria-hidden /> Mark all read
            </Menu.Item>
          </div>
          <Menu.Separator className="my-1 h-px bg-line" />
          <div className="max-h-[60dvh] overflow-y-auto">
            {q.isLoading ? (
              <p className="px-2.5 py-4 text-sm text-ink-muted">Loading…</p>
            ) : q.isError ? (
              <p className="px-2.5 py-4 text-sm text-red-700">Could not load notifications.</p>
            ) : items.length === 0 ? (
              <p className="px-2.5 py-4 text-sm text-ink-muted">You are all caught up.</p>
            ) : (
              items.map((n) => <Item key={n.id} n={n} onOpen={openItem} />)
            )}
          </div>
          {experience.canOpen('/briefing') && <Menu.Separator className="my-1 h-px bg-line" />}
          {experience.canOpen('/briefing') && (
          <Menu.Item
            onSelect={() => navigate('/briefing')}
            className="cursor-pointer rounded-md px-2.5 py-2 text-sm font-semibold text-forest-800 outline-none data-[highlighted]:bg-forest-50"
          >
            Open today's briefing
          </Menu.Item>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}
