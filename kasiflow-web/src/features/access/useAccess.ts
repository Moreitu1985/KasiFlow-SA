import { useCallback, useMemo } from 'react'
import { useBusiness } from '@/features/business/BusinessProvider'
import { hasAny, type Permission } from '@/lib/access'
import { Experience, RoleExperience } from '@/lib/experience'
import { NAV } from '@/layouts/nav'
import type { BusinessDto } from '@/types/api'

export interface Access {
  role: string
  permissions: readonly string[]
  isDemo: boolean
  /** `true` when the current role has ANY of the given permissions. */
  can: (...permissions: Permission[]) => boolean
  /** This role's own app: menu, phone tabs, landing page and which screens it may open. */
  experience: Experience
}

const EMPTY: readonly string[] = []

const ALL_SCREENS = NAV.filter((n) => !n.fallbackFor).map((n) => ({ key: n.to.slice(1), path: n.to, label: n.label, short: n.short ?? n.label, group: n.group }))

/** The app a member has in one business: the API's experience, or one derived from permissions on an older API. */
export function experienceFor(business: Pick<BusinessDto, 'role' | 'permissions' | 'experience'> | null | undefined): Experience {
  if (business?.experience) return Experience.from(business.experience)
  return RoleExperience.fromPermissions(business?.role ?? '', business?.permissions ?? EMPTY, ALL_SCREENS)
}

/**
 * The signed-in person's role and permissions in the active business, from /api/me.
 * Only hides controls; the API enforces every permission.
 */
export function useAccess(): Access {
  const { activeBusiness } = useBusiness()
  const role = activeBusiness?.role ?? ''
  const permissions = activeBusiness?.permissions ?? EMPTY
  const isDemo = !!activeBusiness?.isDemo
  const can = useCallback((...wanted: Permission[]) => hasAny(permissions, ...wanted), [permissions])
  const dto = activeBusiness?.experience
  const experience = useMemo(() => experienceFor({ role, permissions: [...permissions], experience: dto }), [dto, role, permissions])
  return useMemo(() => ({ role, permissions, isDemo, can, experience }), [role, permissions, isDemo, can, experience])
}
