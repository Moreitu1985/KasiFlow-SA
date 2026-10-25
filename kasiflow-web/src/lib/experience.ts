/**
 * The app a person sees — decided by the API (KasiFlow.Core/Access/RoleExperiences.cs) and mirrored here as a small
 * class hierarchy so the UI asks questions ("can I open this?", "what is my menu?", "where is home?") instead of
 * re-deriving rules from raw roles or permissions.
 *
 *   Experience (abstract)          one app: title, purpose, home, screens, phone tabs
 *   ├── RoleExperience             a business role's app (owner, manager, barber, front desk, accountant…)
 *   └── CustomerExperience         the customer app (find a barber, my bookings, my account)
 *
 * State is private and frozen; subclasses only decide which URL belongs to which screen. The API still checks every
 * request — this only decides what is shown.
 */
import { canOpenPath as permissionAllows, hasAny } from './access'

export type ScreenGroup = 'today' | 'money' | 'shop' | 'grow' | 'customer'

export interface ScreenDto {
  key: string
  path: string
  label: string
  short: string
  group: ScreenGroup
}

export interface ExperienceDto {
  role: string
  title: string
  purpose: string
  homePath: string
  screens: ScreenDto[]
  mobileTabs: string[]
}

/**
 * Paths of every screen of the business app, granted or not. A path under one of these belongs to that screen; any
 * other path (e.g. /join) is not a role screen. Must list the same paths as ScreenCatalog on the server.
 */
export const ALL_SCREEN_PATHS: readonly string[] = [
  '/app', '/floor', '/queue', '/bookings', '/workspace', '/earnings', '/briefing',
  '/payments', '/payroll', '/debts', '/expenses', '/transactions', '/cash-flow', '/reports', '/customers', '/suppliers',
  '/staff', '/team/register', '/shifts', '/inventory', '/house-calls', '/map', '/services',
  '/growth', '/insights', '/alerts', '/fraud', '/readiness', '/opportunities', '/funding', '/business-profile', '/integrations', '/reconciliation', '/settings',
]

/** The business screen path a URL belongs to (longest match), or null when it is not a role screen. */
export function screenPathFor(pathname: string): string | null {
  if (pathname === '/dashboard') return '/app'
  if (pathname.startsWith('/customers/debts')) return '/debts'
  let best: string | null = null
  for (const p of ALL_SCREEN_PATHS) {
    if ((pathname === p || pathname.startsWith(`${p}/`)) && (!best || p.length > best.length)) best = p
  }
  return best
}

/** The customer-app screen a URL belongs to, or null for any other path. `/c/bookings/…` belongs to My bookings. */
export function customerScreenPathFor(pathname: string): string | null {
  if (pathname === '/c/shops' || pathname.startsWith('/c/shops/')) return '/c/shops'
  if (pathname === '/c/account' || pathname.startsWith('/c/account/')) return '/c/account'
  if (pathname === '/c' || pathname.startsWith('/c/bookings')) return '/c'
  return null
}

export abstract class Experience {
  readonly #key: string
  readonly #title: string
  readonly #purpose: string
  readonly #homePath: string
  readonly #screens: readonly ScreenDto[]
  readonly #byPath: ReadonlyMap<string, ScreenDto>
  readonly #tabKeys: readonly string[]

  protected constructor(dto: ExperienceDto) {
    this.#key = dto.role
    this.#title = dto.title
    this.#purpose = dto.purpose
    this.#screens = Object.freeze(dto.screens.map((s) => Object.freeze({ ...s })))
    this.#byPath = new Map(this.#screens.map((s) => [s.path, s]))
    this.#tabKeys = Object.freeze([...dto.mobileTabs])
    // A home the app cannot open would be a dead end: fall back to the first screen.
    this.#homePath = this.#byPath.has(dto.homePath) ? dto.homePath : (this.#screens[0]?.path ?? dto.homePath)
  }

  /** Builds the right kind of app for an API experience. */
  static from(dto: ExperienceDto): Experience {
    return dto.role === CustomerExperience.KEY ? new CustomerExperience(dto) : new RoleExperience(dto)
  }

  /** The customer app; without a DTO (signed out, or an older API) it uses the same screens the API would send. */
  static customer(dto?: ExperienceDto | null): CustomerExperience {
    return new CustomerExperience(dto ?? CustomerExperience.DEFAULT)
  }

  /** Which screen (by its path) a URL belongs to in this kind of app, or null when the URL is not one of its screens. */
  protected abstract screenPathOf(pathname: string): string | null

  /** `true` for the customer app; business shells use this to decide on chrome such as the business switcher. */
  abstract get isCustomer(): boolean

  /** Stable key: the role (e.g. 'staff', 'branch_manager') or 'customer'. */
  get key(): string {
    return this.#key
  }

  /** Short name of the app, e.g. "Barber app". */
  get title(): string {
    return this.#title
  }

  get purpose(): string {
    return this.#purpose
  }

  get homePath(): string {
    return this.#homePath
  }

  /** Screens in menu order. */
  get screens(): readonly ScreenDto[] {
    return this.#screens
  }

  /** Bottom tabs on phones (at most four), never a screen the app does not have. */
  get tabs(): readonly ScreenDto[] {
    return this.#tabKeys
      .map((k) => this.#screens.find((s) => s.key === k))
      .filter((s): s is ScreenDto => !!s)
      .slice(0, 4)
  }

  /** `true` for any screen this app has, and for paths that are not screens of this kind of app at all. */
  canOpen(pathname: string): boolean {
    const screen = this.screenPathOf(pathname)
    return screen === null || this.#byPath.has(screen)
  }

  /** The screen a URL shows (for highlighting the menu), or undefined when it is not one of this app's screens. */
  activeScreen(pathname: string): ScreenDto | undefined {
    const screen = this.screenPathOf(pathname)
    return screen === null ? undefined : this.#byPath.get(screen)
  }

  isActive(pathname: string, screenPath: string): boolean {
    return this.activeScreen(pathname)?.path === screenPath
  }

  has(screenKey: string): boolean {
    return this.#screens.some((s) => s.key === screenKey)
  }

  /** The page-header label saying whose app this is, e.g. "Barber app · Ayanda". */
  headline(who?: string | null): string {
    const name = who?.trim()
    return name ? `${this.#title} · ${name}` : this.#title
  }
}

/** A business role's app. Only business screen paths are judged; anything else (e.g. /join) is left alone. */
export class RoleExperience extends Experience {
  constructor(dto: ExperienceDto) {
    super(dto)
  }

  get role(): string {
    return this.key
  }

  get isCustomer(): boolean {
    return false
  }

  protected screenPathOf(pathname: string): string | null {
    return screenPathFor(pathname)
  }

  /**
   * Older API without experiences: derive the same shape from permissions so nothing breaks.
   * `screens` is the full screen list (with labels), filtered by what the permissions allow.
   */
  static fromPermissions(role: string, permissions: readonly string[], screens: readonly ScreenDto[]): RoleExperience {
    const allowed = screens.filter((s) => permissionAllows(permissions, s.path))
    const preferred = hasAny(permissions, 'viewBusinessInsights')
      ? '/app'
      : hasAny(permissions, 'manageBookings', 'manageStaffSchedules')
        ? '/floor'
        : hasAny(permissions, 'workOwnBookings', 'updateOwnStatus') && !hasAny(permissions, 'viewBookings')
          ? '/workspace'
          : '/bookings'
    const home = allowed.some((s) => s.path === preferred) ? preferred : (allowed[0]?.path ?? '/app')
    const tabs = [home, ...allowed.map((s) => s.path)].filter((p, i, a) => a.indexOf(p) === i).slice(0, 4)
    return new RoleExperience({
      role,
      title: 'KasiFlow',
      purpose: '',
      homePath: home,
      screens: allowed,
      mobileTabs: tabs.map((p) => allowed.find((s) => s.path === p)?.key ?? '').filter(Boolean),
    })
  }
}

/** The customer app: no business screens at all. Find a barber is public; the rest needs a one-time-code sign-in. */
export class CustomerExperience extends Experience {
  static readonly KEY = 'customer'

  /** Mirrors CustomerExperience in RoleExperiences.cs (used when signed out or before /api/customer/me answers). */
  static readonly DEFAULT: ExperienceDto = Object.freeze({
    role: CustomerExperience.KEY,
    title: 'Customer app',
    purpose: 'Find a barber, see prices and their work, book a visit or a house call, and follow your bookings.',
    homePath: '/c',
    screens: [
      { key: 'customerShops', path: '/c/shops', label: 'Find a barber', short: 'Shops', group: 'customer' },
      { key: 'customerBookings', path: '/c', label: 'My bookings', short: 'Bookings', group: 'customer' },
      { key: 'customerAccount', path: '/c/account', label: 'My account', short: 'Account', group: 'customer' },
    ],
    mobileTabs: ['customerShops', 'customerBookings', 'customerAccount'],
  }) as ExperienceDto

  /** Screens anyone can open without signing in. */
  static readonly PUBLIC_PATHS: readonly string[] = Object.freeze(['/c/shops'])

  constructor(dto: ExperienceDto) {
    super(dto)
  }

  get isCustomer(): boolean {
    return true
  }

  protected screenPathOf(pathname: string): string | null {
    return customerScreenPathFor(pathname)
  }

  /** `true` when the URL can be shown to someone who is not signed in. */
  isPublic(pathname: string): boolean {
    const screen = customerScreenPathFor(pathname)
    return screen !== null && CustomerExperience.PUBLIC_PATHS.includes(screen)
  }

  /** What a signed-out visitor sees: only the public screens, landing on the shop catalogue. */
  forGuest(): CustomerExperience {
    const screens = this.screens.filter((s) => CustomerExperience.PUBLIC_PATHS.includes(s.path))
    return new CustomerExperience({
      role: this.key,
      title: this.title,
      purpose: this.purpose,
      homePath: screens[0]?.path ?? '/c/shops',
      screens: [...screens],
      mobileTabs: screens.map((s) => s.key),
    })
  }
}
