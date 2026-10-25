/**
 * Navigation pieces shared by every app shell (business roles and customers). They render whatever the person's
 * Experience says — never a hard-coded list of links — so each role and the customer get their own app from one
 * set of components.
 */
import type { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { MoreHorizontal } from 'lucide-react'
import type { Experience } from '@/lib/experience'
import { cn } from '@/lib/utils'
import { GROUP_LABELS, GROUP_ORDER, appIcon, experienceNav, type NavItem } from './nav'

/** "Barber app · Ayanda": says whose app this is. `tone="dark"` for use on the forest hero panels. */
export function AppBadge({ experience, who, tone = 'light', className }: { experience: Experience; who?: string | null; tone?: 'light' | 'dark'; className?: string }) {
  const Icon = appIcon(experience.key)
  const name = who?.trim()
  return (
    <span
      className={cn(
        'inline-flex max-w-full min-w-0 items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-[13px] font-semibold',
        tone === 'dark' ? 'border-white/15 bg-white/10 text-white' : 'border-forest-800/15 bg-forest-50 text-heading',
        className,
      )}
    >
      <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full', tone === 'dark' ? 'bg-emerald-brand text-forest-950' : 'bg-primary text-primary-fg')} aria-hidden>
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 truncate">
        {experience.title}
        {name && <span className={cn('font-medium', tone === 'dark' ? 'text-cream' : 'text-ink-soft')}> · {name}</span>}
      </span>
    </span>
  )
}

function SideLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate?: () => void }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium transition-colors',
        active ? 'bg-white/12 text-white' : 'text-cream/85 hover:bg-white/6 hover:text-white',
      )}
    >
      {active && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r bg-emerald-brand" aria-hidden />}
      <Icon className={cn('size-[18px] shrink-0', active ? 'text-emerald-brand' : 'opacity-80')} aria-hidden />
      <span className="truncate">{item.label}</span>
    </NavLink>
  )
}

/** Grouped menu (Today / Money / Shop / Protect & grow) for the sidebar and the phone drawer. */
export function ShellSideNav({ experience, onNavigate }: { experience: Experience; onNavigate?: () => void }) {
  const { pathname } = useLocation()
  const nav = experienceNav(experience.screens)
  const groups = GROUP_ORDER.map((g) => ({ g, items: nav.filter((n) => n.group === g) })).filter((x) => x.items.length > 0)
  const single = groups.length === 1
  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {groups.map(({ g, items }) => (
        <div key={g}>
          {!single && <p className="mb-1 px-3 text-xs font-medium text-cream/60">{GROUP_LABELS[g]}</p>}
          <ul className="flex flex-col gap-0.5">
            {items.map((item) => (
              <li key={item.to}>
                <SideLink item={item} active={experience.isActive(pathname, item.to)} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

/** Horizontal links for wide screens of small apps (the customer app). */
export function ShellTopNav({ experience, className }: { experience: Experience; className?: string }) {
  const { pathname } = useLocation()
  return (
    <nav aria-label="Main" className={className}>
      <ul className="flex items-center gap-1">
        {experienceNav(experience.screens).map((t) => {
          const active = experience.isActive(pathname, t.to)
          return (
            <li key={t.to}>
              <NavLink
                to={t.to}
                end
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex h-11 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition-colors',
                  active ? 'bg-primary text-primary-fg' : 'text-ink-soft hover:bg-forest-50 hover:text-ink',
                )}
              >
                <t.icon className="size-4" aria-hidden />
                {t.label}
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Phone tab bar: the experience's tabs, plus an optional "More" button that opens the full menu. */
export function ShellBottomTabs({ experience, onMore, className }: { experience: Experience; onMore?: () => void; className?: string }) {
  const { pathname } = useLocation()
  const tabs = experienceNav(experience.tabs)
  const moreActive = !!onMore && !tabs.some((t) => experience.isActive(pathname, t.to))
  const cols = tabs.length + (onMore ? 1 : 0)
  if (cols === 0) return null
  return (
    <nav
      aria-label="Quick navigation"
      className={cn('fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur', className)}
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {tabs.map((t) => {
          const active = experience.isActive(pathname, t.to)
          return (
            <li key={t.to}>
              <TabLink to={t.to} active={active} icon={<t.icon className="size-5" aria-hidden />} label={t.short ?? t.label} />
            </li>
          )
        })}
        {onMore && (
          <li>
            <button
              type="button"
              onClick={onMore}
              className={cn('flex min-h-14 w-full cursor-pointer flex-col items-center justify-center gap-0.5 text-[11px] font-semibold', moreActive ? 'text-heading' : 'text-ink-muted')}
            >
              <span className={cn('flex h-7 w-12 items-center justify-center rounded-full', moreActive && 'bg-forest-100')}>
                <MoreHorizontal className="size-5" aria-hidden />
              </span>
              More
            </button>
          </li>
        )}
      </ul>
    </nav>
  )
}

function TabLink({ to, active, icon, label }: { to: string; active: boolean; icon: ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      end
      aria-current={active ? 'page' : undefined}
      className={cn('flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold', active ? 'text-heading' : 'text-ink-muted')}
    >
      <span className={cn('flex h-7 w-12 items-center justify-center rounded-full transition-colors', active && 'bg-forest-100 text-heading')}>{icon}</span>
      <span className="max-w-full truncate px-1">{label}</span>
    </NavLink>
  )
}
