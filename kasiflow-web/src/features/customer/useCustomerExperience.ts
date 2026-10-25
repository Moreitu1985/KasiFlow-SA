import { useMemo } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { Experience, type CustomerExperience } from '@/lib/experience'
import { useCustomerAccount } from './api'

export interface CustomerApp {
  experience: CustomerExperience
  signedIn: boolean
  /** The customer's name for the "Customer app · …" badge (their saved name, else the verified contact). */
  who: string | null
}

/** The customer app from /api/customer/me; signed-out visitors get the guest version (only the public screens). */
export function useCustomerExperience(): CustomerApp {
  const { session } = useAuth()
  const account = useCustomerAccount(!!session)
  const dto = account.data?.experience
  const name = account.data?.fullName ?? account.data?.verifiedContact ?? null
  return useMemo(() => {
    const app = Experience.customer(dto)
    return session ? { experience: app, signedIn: true, who: name } : { experience: app.forGuest(), signedIn: false, who: null }
  }, [dto, session, name])
}
