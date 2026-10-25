import type { ComponentProps } from 'react'
import { PageHeader } from '@/components/shared/PageHeader'
import { AppBadge } from '@/layouts/shell'
import { useCustomerExperience } from './useCustomerExperience'

/** Page header for the customer app with its "Customer app · Lerato" badge. */
export function CustomerHeader(props: Omit<ComponentProps<typeof PageHeader>, 'eyebrow'>) {
  const { experience, who } = useCustomerExperience()
  return <PageHeader eyebrow={<AppBadge experience={experience} who={who} />} {...props} />
}
