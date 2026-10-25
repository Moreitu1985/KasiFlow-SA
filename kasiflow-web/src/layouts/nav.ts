import {
  ArrowLeftRight,
  BadgeDollarSign,
  BarChart3,
  Banknote,
  ListOrdered,
  Map as MapIcon,
  WalletCards,
  Boxes,
  CalendarDays,
  Car,
  ClipboardCheck,
  Clock,
  Compass,
  CreditCard,
  FileBarChart,
  HandCoins,
  LayoutDashboard,
  LayoutGrid,
  Search,
  UserRound,
  BookOpenCheck,
  Calculator,
  Crown,
  ConciergeBell,
  ClipboardList,
  Plug,
  QrCode,
  Receipt,
  Scissors,
  Settings,
  ShieldAlert,
  Sprout,
  Sun,
  Tags,
  Truck,
  UserCog,
  Users,
  Waves,
  type LucideIcon,
} from 'lucide-react'
import type { ScreenGroup } from '@/lib/experience'

export type NavGroup = ScreenGroup

export interface NavItem {
  to: string
  label: string
  short?: string
  icon: LucideIcon
  group: NavGroup
  /** Shown only when the person cannot open this other path (e.g. the fraud guide for roles without the alerts centre). */
  fallbackFor?: string
}

/** Every business screen with its icon. What a person sees comes from their Experience (lib/experience). */
export const NAV: NavItem[] = [
  { to: '/app', label: 'Business overview', short: 'Home', icon: LayoutDashboard, group: 'today' },
  { to: '/floor', label: 'Today on the floor', short: 'Floor', icon: LayoutGrid, group: 'today' },
  { to: '/queue', label: 'Walk-in queue', short: 'Queue', icon: ListOrdered, group: 'today' },
  { to: '/bookings', label: 'Bookings', short: 'Bookings', icon: CalendarDays, group: 'today' },
  { to: '/workspace', label: 'Barber Workspace', short: 'Workspace', icon: Scissors, group: 'today' },
  { to: '/earnings', label: 'My earnings', short: 'Earnings', icon: WalletCards, group: 'today' },
  { to: '/briefing', label: 'Daily briefing', short: 'Briefing', icon: Sun, group: 'today' },

  { to: '/payments', label: 'Payments', short: 'Payments', icon: CreditCard, group: 'money' },
  { to: '/payroll', label: 'Barber pay', short: 'Pay', icon: Banknote, group: 'money' },
  { to: '/debts', label: 'Debts', short: 'Debts', icon: HandCoins, group: 'money' },
  { to: '/expenses', label: 'Expenses', short: 'Expenses', icon: Receipt, group: 'money' },
  { to: '/transactions', label: 'Transactions', short: 'Money', icon: ArrowLeftRight, group: 'money' },
  { to: '/cash-flow', label: 'Cash Flow', icon: Waves, group: 'money' },
  { to: '/reports', label: 'Reports', icon: FileBarChart, group: 'money' },
  { to: '/customers', label: 'Customers', icon: Users, group: 'money' },
  { to: '/suppliers', label: 'Suppliers & bills', short: 'Bills', icon: Truck, group: 'money' },

  { to: '/staff', label: 'Staff', short: 'Staff', icon: UserCog, group: 'shop' },
  { to: '/shifts', label: 'Shifts & cash-up', short: 'Shift', icon: Clock, group: 'shop' },
  { to: '/inventory', label: 'Inventory', short: 'Stock', icon: Boxes, group: 'shop' },
  { to: '/house-calls', label: 'House Calls', short: 'House calls', icon: Car, group: 'shop' },
  { to: '/map', label: 'House-call map', short: 'Map', icon: MapIcon, group: 'shop' },
  { to: '/services', label: 'Services & prices', short: 'Services', icon: Tags, group: 'shop' },

  { to: '/growth', label: 'Growth Insights', short: 'Growth', icon: Sprout, group: 'grow' },
  { to: '/insights', label: 'Shop insights', short: 'Insights', icon: BarChart3, group: 'grow' },
  { to: '/alerts', label: 'Fraud & Alerts', short: 'Alerts', icon: ShieldAlert, group: 'grow' },
  { to: '/fraud', label: 'Fraud protection', short: 'Fraud', icon: ShieldAlert, group: 'grow', fallbackFor: '/alerts' },
  { to: '/readiness', label: 'Business Setup', icon: ClipboardCheck, group: 'grow' },
  { to: '/opportunities', label: 'Procurement', icon: Compass, group: 'grow' },
  { to: '/funding', label: 'Funding Readiness', icon: BadgeDollarSign, group: 'grow' },
  { to: '/business-profile', label: 'Business Profile', icon: QrCode, group: 'grow' },
  { to: '/integrations', label: 'Integrations', icon: Plug, group: 'grow' },
  { to: '/settings', label: 'Settings', icon: Settings, group: 'grow' },
]

const EXTRA_ICONS: Record<string, LucideIcon> = {
  '/team/register': UserCog,
  '/reconciliation': Plug,
  '/c/shops': Search,
  '/c': CalendarDays,
  '/c/account': UserRound,
}

/** Icons for the screens the API sends (by path). Screens without an entry here get a generic icon. */
export function iconFor(path: string): LucideIcon {
  return NAV.find((n) => n.to === path)?.icon ?? EXTRA_ICONS[path] ?? LayoutDashboard
}

/** Menu items for an experience's screens, in the order the API chose. */
export function experienceNav(screens: readonly { path: string; label: string; short: string; group: NavGroup }[]): NavItem[] {
  return screens.filter((s) => s.path !== '/team/register').map((s) => ({ to: s.path, label: s.label, short: s.short, icon: iconFor(s.path), group: s.group }))
}

/** The badge icon for whose app this is (by experience key: the role, or 'customer'). */
export function appIcon(key: string): LucideIcon {
  const map: Record<string, LucideIcon> = {
    owner: Crown,
    business_admin: ClipboardList,
    branch_manager: LayoutGrid,
    cashier: ConciergeBell,
    staff: Scissors,
    accountant: Calculator,
    customer: BookOpenCheck,
  }
  return map[key] ?? LayoutDashboard
}

export const GROUP_LABELS: Record<NavGroup, string> = {
  today: 'Today',
  money: 'Money',
  shop: 'Shop',
  grow: 'Protect & grow',
  customer: 'Customer',
}

export const GROUP_ORDER: NavGroup[] = ['today', 'money', 'shop', 'grow', 'customer']
