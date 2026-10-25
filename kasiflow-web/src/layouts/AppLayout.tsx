import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Building2, Check, ChevronsUpDown, LogOut, Menu, Plus } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Wordmark } from '@/components/shared/Logo'
import { SandboxBadge } from '@/components/shared/Badges'
import { useAuth } from '@/features/auth/AuthProvider'
import { useBusiness } from '@/features/business/BusinessProvider'
import { useAccess } from '@/features/access/useAccess'
import { RequireAccess } from '@/features/access/RequireAccess'
import { NotificationBell } from '@/features/notifications/NotificationBell'
import { RecordProvider, useRecord } from '@/features/transactions/RecordProvider'
import { roleLabel } from '@/lib/access'
import { cn } from '@/lib/utils'
import { ThemeSegmented } from '@/features/theme/ThemeToggle'
import { InstallButton } from '@/features/pwa/InstallButton'
import { AppBadge, ShellBottomTabs, ShellSideNav } from './shell'

/** Pages with their own main button at the top: the floating "Record" button would only get in the way there. */
const NO_FAB = ['/queue', '/transactions', '/expenses', '/payments', '/debts', '/payroll', '/insights', '/map', '/earnings', '/bookings/', '/shifts']

function BusinessSwitcher({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  const { businesses, activeBusiness, setActiveBusiness } = useBusiness()
  const name = activeBusiness?.name ?? '…'
  const base =
    tone === 'dark'
      ? 'bg-forest-950/40 text-white hover:bg-forest-950/60 border-white/10'
      : 'bg-paper text-ink hover:bg-forest-50 border-line'
  if (businesses.length <= 1)
    return (
      <div className={cn('flex items-center gap-2 rounded-md border px-3 py-2', base)}>
        <Building2 className="size-4 shrink-0 opacity-70" aria-hidden />
        <span className="truncate text-sm font-semibold">{name}</span>
      </div>
    )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn('flex w-full cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-left', base)}>
        <Building2 className="size-4 shrink-0 opacity-70" aria-hidden />
        <span className="flex-1 truncate text-sm font-semibold">{name}</span>
        <ChevronsUpDown className="size-4 opacity-70" aria-hidden />
        <span className="sr-only">Switch business</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Switch business</DropdownMenuLabel>
        {businesses.map((b) => (
          <DropdownMenuItem key={b.id} onSelect={() => setActiveBusiness(b.id)}>
            <Check className={cn(b.id === activeBusiness?.id ? 'opacity-100' : 'opacity-0')} aria-hidden />
            <span className="truncate">{b.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth()
  const { role, experience } = useAccess()
  return (
    <div className="flex h-full flex-col bg-forest-900 text-white">
      <div className="kasi-band h-3 shrink-0" aria-hidden />
      <div className="px-4 pt-5 pb-4">
        <Wordmark tone="light" />
        <div className="mt-5 space-y-2.5">
          <BusinessSwitcher />
          <AppBadge experience={experience} tone="dark" className="w-full" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <ShellSideNav experience={experience} onNavigate={onNavigate} />
      </div>
      <div className="space-y-2 border-t border-white/10 px-4 py-3">
        <ThemeSegmented tone="dark" compact />
        <InstallButton variant="outline" size="sm" className="w-full border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white" label="Install KasiFlow app" />
        <p className="truncate text-[13px] text-cream/70" title={user?.email ?? undefined}>
          {user?.email}
        </p>
        {role && <p className="truncate text-[12px] text-cream/60">{roleLabel(role)}</p>}
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-1 inline-flex cursor-pointer items-center gap-2 rounded text-sm font-medium text-white/90 hover:text-white"
        >
          <LogOut className="size-4" aria-hidden /> Sign out
        </button>
      </div>
    </div>
  )
}

function RecordFab() {
  const { openRecord } = useRecord()
  const { can, experience } = useAccess()
  const { pathname } = useLocation()
  // Only apps that include the money book get the quick "record" button (barbers record through their bookings).
  if (!can('recordSales', 'manageFinancials') || !experience.has('transactions')) return null
  if (NO_FAB.some((p) => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)))) return null
  const fabClass =
    'fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 flex h-13 cursor-pointer items-center gap-2 rounded-full bg-emerald-brand px-5 font-semibold text-forest-950 shadow-raised lg:hidden'
  // Sales-only roles (cashier, staff) record income only: a single button, no menu.
  if (!can('manageFinancials'))
    return (
      <button type="button" className={fabClass} onClick={() => openRecord('income')}>
        <Plus className="size-5" aria-hidden /> Record sale
      </button>
    )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 flex h-13 cursor-pointer items-center gap-2 rounded-full bg-emerald-brand px-5 font-semibold text-forest-950 shadow-raised lg:hidden"
        aria-label="Record a transaction"
      >
        <Plus className="size-5" aria-hidden /> Record
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="min-w-52">
        <DropdownMenuItem onSelect={() => openRecord('income')}>
          <ArrowDownLeft /> Record sale / income
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openRecord('expense')}>
          <ArrowUpRight /> Record expense
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Each page fades and slides in a little (switched off by prefers-reduced-motion). */
function PageTransition() {
  const { pathname } = useLocation()
  return (
    <div key={pathname} className="animate-page-in">
      <Outlet />
    </div>
  )
}

export function AppLayout() {
  const [drawer, setDrawer] = useState(false)
  const { isDemo, experience } = useAccess()
  return (
    <RecordProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <div className="min-h-dvh lg:pl-64">
        <aside className="no-print fixed inset-y-0 left-0 hidden w-64 lg:block dark:border-r dark:border-white/8">
          <SidebarBody />
        </aside>

        <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            className="-ml-1.5 cursor-pointer rounded-md p-1.5 text-ink hover:bg-forest-50"
            aria-label="Open menu"
          >
            <Menu className="size-6" aria-hidden />
          </button>
          <Wordmark className="[&_svg]:size-7 [&>span:last-child]:max-[359px]:hidden" />
          <div className="ml-auto flex min-w-0 items-center gap-1">
            <div className="max-w-[9.5rem] min-w-0 sm:max-w-56">
              <BusinessSwitcher tone="light" />
            </div>
            <NotificationBell />
          </div>
        </header>
        {isDemo && (
          <div className="no-print sticky top-14 z-20 border-b border-ochre/50 bg-ochre-soft px-4 py-1.5 lg:hidden">
            <SandboxBadge className="w-full justify-center" />
          </div>
        )}

          <div className="no-print sticky top-0 z-20 hidden h-14 items-center gap-3 border-b border-line bg-surface/95 px-10 backdrop-blur lg:flex">
          {isDemo && <SandboxBadge />}
          <div className="ml-auto">
            <NotificationBell />
          </div>
        </div>

        <Dialog open={drawer} onOpenChange={setDrawer}>
          <DialogContent variant="drawer-left" className="p-0 [&>button]:text-white [&>button]:hover:bg-white/10">
            <DialogTitle className="sr-only">Menu</DialogTitle>
            <DialogDescription className="sr-only">Main navigation</DialogDescription>
            <SidebarBody onNavigate={() => setDrawer(false)} />
          </DialogContent>
        </Dialog>

        <main id="main" className="mx-auto w-full max-w-7xl px-4 pt-6 pb-36 sm:px-6 lg:px-10 lg:pt-10 lg:pb-16">
          <RequireAccess>
            <PageTransition />
          </RequireAccess>
        </main>

        <div className="no-print">
          <RecordFab />
          <ShellBottomTabs experience={experience} onMore={() => setDrawer(true)} className="lg:hidden" />
        </div>
      </div>
    </RecordProvider>
  )
}
