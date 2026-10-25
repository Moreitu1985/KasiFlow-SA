import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { BadgeDollarSign } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RoleHeader } from '@/features/access/RoleHeader'
import { FundingTab } from '@/features/funding/FundingTab'
import { RegistrationTab } from './RegistrationTab'

/** Business Setup: registration guidance. Funding readiness has its own page (/funding); old ?tab=funding links redirect. */
export function ReadinessPage() {
  const [params] = useSearchParams()
  if (params.get('tab') === 'funding') return <Navigate to="/funding" replace />
  return (
    <div>
      <RoleHeader
        title="Business setup"
        description="Step-by-step guidance to formalise your business: structure, registration, tax and the paperwork bigger customers ask for."
        actions={
          <Button asChild variant="outline">
            <Link to="/funding">
              <BadgeDollarSign /> Funding readiness
            </Link>
          </Button>
        }
      />
      <RegistrationTab />
    </div>
  )
}

export function FundingPage() {
  return (
    <div>
      <RoleHeader
        title="Funding readiness"
        description="What funders usually ask for, and how ready your records are. It does not mean you qualify for any specific funding."
      />
      <FundingTab />
    </div>
  )
}
