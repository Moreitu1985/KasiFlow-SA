import { describe, expect, it } from 'vitest'
import { CustomerExperience, Experience, RoleExperience, customerScreenPathFor, screenPathFor, type ExperienceDto, type ScreenDto } from './experience'
import { initialsOf } from './utils'

const barber: ExperienceDto = {
  role: 'staff',
  title: 'Barber app',
  purpose: 'Your day',
  homePath: '/workspace',
  screens: [
    { key: 'workspace', path: '/workspace', label: 'Barber Workspace', short: 'Workspace', group: 'today' },
    { key: 'queue', path: '/queue', label: 'Walk-in queue', short: 'Queue', group: 'today' },
    { key: 'bookings', path: '/bookings', label: 'Bookings', short: 'Bookings', group: 'today' },
    { key: 'earnings', path: '/earnings', label: 'My earnings', short: 'Earnings', group: 'today' },
  ],
  mobileTabs: ['workspace', 'queue', 'bookings', 'earnings', 'payments'],
}

const manager: ExperienceDto = {
  role: 'branch_manager',
  title: 'Manager app',
  purpose: 'Run the floor',
  homePath: '/floor',
  screens: [
    { key: 'floor', path: '/floor', label: 'Today on the floor', short: 'Floor', group: 'today' },
    { key: 'queue', path: '/queue', label: 'Walk-in queue', short: 'Queue', group: 'today' },
    { key: 'bookings', path: '/bookings', label: 'Bookings', short: 'Bookings', group: 'today' },
    { key: 'staff', path: '/staff', label: 'Staff', short: 'Staff', group: 'shop' },
    { key: 'houseCallMap', path: '/map', label: 'House-call map', short: 'Map', group: 'shop' },
  ],
  mobileTabs: ['floor', 'queue', 'bookings', 'shifts'],
}

describe('Experience (business roles)', () => {
  const e = Experience.from(barber)

  it('builds a role app from an API experience', () => {
    expect(e).toBeInstanceOf(RoleExperience)
    expect(e.isCustomer).toBe(false)
    expect(e.key).toBe('staff')
    expect(e.homePath).toBe('/workspace')
  })

  it('opens only its own screens and their sub-pages', () => {
    expect(e.canOpen('/workspace')).toBe(true)
    expect(e.canOpen('/bookings/123')).toBe(true)
    expect(e.canOpen('/payments')).toBe(false)
    expect(e.canOpen('/transactions/abc')).toBe(false)
    expect(e.canOpen('/app')).toBe(false)
    expect(e.canOpen('/dashboard')).toBe(false)
    expect(e.canOpen('/customers/debts/1')).toBe(false)
    expect(e.canOpen('/floor')).toBe(false)
  })

  it('does not block paths that are not role screens', () => {
    expect(e.canOpen('/join')).toBe(true)
  })

  it('never shows a tab for a screen it does not have, and at most four', () => {
    expect(e.tabs.map((t) => t.key)).toEqual(['workspace', 'queue', 'bookings', 'earnings'])
    expect(Experience.from(manager).tabs.map((t) => t.key)).toEqual(['floor', 'queue', 'bookings'])
  })

  it('gives barbers the queue and their own earnings, never the owner’s pay, map or insights', () => {
    expect(e.canOpen('/queue')).toBe(true)
    expect(e.canOpen('/earnings')).toBe(true)
    expect(e.canOpen('/payroll')).toBe(false)
    expect(e.canOpen('/insights')).toBe(false)
    expect(e.canOpen('/map')).toBe(false)
    const m = Experience.from(manager)
    expect(m.canOpen('/map')).toBe(true)
    expect(m.canOpen('/payroll')).toBe(false)
  })

  it('leaves the public queue ticket alone (it is not a business screen)', () => {
    expect(screenPathFor('/q/123')).toBeNull()
    expect(screenPathFor('/queue')).toBe('/queue')
    expect(e.canOpen('/q/abc')).toBe(true)
  })

  it('keeps its screen list private and immutable', () => {
    expect(Object.isFrozen(e.screens)).toBe(true)
    expect(() => (e.screens as ScreenDto[]).push({} as ScreenDto)).toThrow()
    expect(() => {
      ;(e.screens[0] as { label: string }).label = 'Hacked'
    }).toThrow()
    expect('screens' in e && Object.keys(e)).toEqual([])
  })

  it('gives the manager the floor as home, without business stats', () => {
    const m = Experience.from(manager)
    expect(m.homePath).toBe('/floor')
    expect(m.canOpen('/floor')).toBe(true)
    expect(m.canOpen('/app')).toBe(false)
    expect(m.canOpen('/reports/business-summary')).toBe(false)
    expect(m.isActive('/bookings/abc', '/bookings')).toBe(true)
    expect(m.activeScreen('/join')).toBeUndefined()
  })

  it('never lands on a home it cannot open', () => {
    expect(Experience.from({ ...barber, homePath: '/app' }).homePath).toBe('/workspace')
  })

  it('says whose app it is', () => {
    expect(e.headline('Ayanda')).toBe('Barber app · Ayanda')
    expect(e.headline('  ')).toBe('Barber app')
  })

  it('maps nested paths to the most specific screen', () => {
    expect(screenPathFor('/team/register')).toBe('/team/register')
    expect(screenPathFor('/reports/business-summary')).toBe('/reports')
    expect(screenPathFor('/floor')).toBe('/floor')
    expect(screenPathFor('/payroll')).toBe('/payroll')
    expect(screenPathFor('/insights')).toBe('/insights')
    expect(screenPathFor('/map')).toBe('/map')
    expect(screenPathFor('/earnings')).toBe('/earnings')
    expect(screenPathFor('/c/account')).toBeNull()
  })
})

describe('RoleExperience.fromPermissions (older API)', () => {
  const ALL: ScreenDto[] = [
    { key: 'app', path: '/app', label: 'Business overview', short: 'Home', group: 'today' },
    { key: 'floor', path: '/floor', label: 'Today on the floor', short: 'Floor', group: 'today' },
    { key: 'bookings', path: '/bookings', label: 'Bookings', short: 'Bookings', group: 'today' },
    { key: 'workspace', path: '/workspace', label: 'Workspace', short: 'Workspace', group: 'today' },
    { key: 'reports', path: '/reports', label: 'Reports', short: 'Reports', group: 'money' },
  ]

  it('keeps the overview and reports for the owner only', () => {
    const owner = RoleExperience.fromPermissions('owner', ['viewBusinessInsights', 'manageBookings', 'updateOwnStatus'], ALL)
    expect(owner.homePath).toBe('/app')
    expect(owner.canOpen('/reports')).toBe(true)
    const manager = RoleExperience.fromPermissions('branch_manager', ['viewFinancials', 'manageBookings', 'viewBookings', 'manageStaffSchedules'], ALL)
    expect(manager.homePath).toBe('/floor')
    expect(manager.canOpen('/app')).toBe(false)
    expect(manager.canOpen('/reports')).toBe(false)
    expect(manager.tabs[0]?.path).toBe('/floor')
  })

  it('sends barbers to their workspace', () => {
    const b = RoleExperience.fromPermissions('staff', ['workOwnBookings', 'updateOwnStatus'], ALL)
    expect(b.homePath).toBe('/workspace')
    expect(b.canOpen('/floor')).toBe(false)
  })
})

describe('CustomerExperience', () => {
  const c = Experience.customer()

  it('is the customer app with the API defaults', () => {
    expect(c).toBeInstanceOf(CustomerExperience)
    expect(c.isCustomer).toBe(true)
    expect(c.homePath).toBe('/c')
    expect(c.screens.map((s) => s.path)).toEqual(['/c/shops', '/c', '/c/account'])
    expect(c.tabs).toHaveLength(3)
  })

  it('builds from the API DTO through the same factory', () => {
    expect(Experience.from({ ...CustomerExperience.DEFAULT, title: 'Customer app' })).toBeInstanceOf(CustomerExperience)
  })

  it('maps customer URLs to its screens and leaves business URLs alone', () => {
    expect(c.isActive('/c/bookings/BK-1', '/c')).toBe(true)
    expect(c.isActive('/c/shops', '/c')).toBe(false)
    expect(c.isActive('/c/account', '/c/account')).toBe(true)
    expect(c.canOpen('/workspace')).toBe(true)
    expect(customerScreenPathFor('/c/sign-in')).toBeNull()
  })

  it('shows signed-out visitors only the public catalogue', () => {
    const guest = c.forGuest()
    expect(guest.screens.map((s) => s.path)).toEqual(['/c/shops'])
    expect(guest.homePath).toBe('/c/shops')
    expect(guest.canOpen('/c')).toBe(false)
    expect(guest.isPublic('/c/shops')).toBe(true)
    expect(c.isPublic('/c/account')).toBe(false)
  })
})

describe('initialsOf', () => {
  it('takes up to two initials and ignores bracketed notes and punctuation', () => {
    expect(initialsOf("Thato's Barber Studio")).toBe('TB')
    expect(initialsOf('Ayanda (fictional)')).toBe('A')
    expect(initialsOf('  ')).toBe('')
  })
})
