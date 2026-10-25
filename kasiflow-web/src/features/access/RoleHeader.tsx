import type { ComponentProps } from 'react'
import { PageHeader } from '@/components/shared/PageHeader'
import { AppBadge } from '@/layouts/shell'
import { useBusiness } from '@/features/business/BusinessProvider'
import { useAccess } from './useAccess'

/**
 * Page header for business screens with the "whose app is this" badge ("Manager app · Thato's Barber Studio").
 * `who` defaults to the business name; pages that know the person (the barber's workspace) pass their name.
 */
export function RoleHeader({ who, ...props }: Omit<ComponentProps<typeof PageHeader>, 'eyebrow'> & { who?: string | null }) {
  const { experience } = useAccess()
  const { activeBusiness } = useBusiness()
  return <PageHeader eyebrow={<AppBadge experience={experience} who={who ?? activeBusiness?.name} />} {...props} />
}
