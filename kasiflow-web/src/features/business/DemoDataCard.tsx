import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Database } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api, ApiError } from '@/lib/apiClient'
import { useBusiness } from './BusinessProvider'
import type { BusinessDto } from '@/types/api'

interface DemoStatus {
  enabled: boolean
}

/** Shows a one-click "load demo data" option when the server allows it (App:EnableDemoData). */
export function DemoDataCard({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { setActiveBusiness } = useBusiness()
  const status = useQuery({
    queryKey: ['demo-status'],
    queryFn: () => api.get<DemoStatus>('/api/demo'),
    staleTime: 10 * 60_000,
    retry: false,
  })
  const load = useMutation({
    mutationFn: () => api.post<BusinessDto>('/api/demo/load'),
    onSuccess: async (biz) => {
      setActiveBusiness(biz.id)
      await qc.invalidateQueries()
      toast.success(`${biz.name} loaded with fictional demo data`)
      navigate('/app', { replace: true })
    },
    onError: (e) => toast.error(e instanceof ApiError ? (e.detail ?? e.title ?? 'Could not load the demo data.') : 'Could not load the demo data.'),
  })

  if (!status.data?.enabled) return null

  return (
    <div className={compact ? 'rounded-lg border border-dashed border-line-strong bg-paper p-4' : 'rounded-lg border border-dashed border-line-strong bg-surface p-5 shadow-card'}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <Database className="mt-0.5 size-5 shrink-0 text-forest-800" aria-hidden />
          <div>
            <p className="font-semibold">Just exploring? Load the demo business</p>
            <p className="text-[13px] text-ink-muted">
              Adds “Thato’s Barber Studio” with six months of fictional records, debts, bills and a cash-shortage scenario to
              your account. Your own business is not changed.
            </p>
          </div>
        </div>
        <Button variant="outline" loading={load.isPending} onClick={() => load.mutate()} className="shrink-0">
          Load demo data
        </Button>
      </div>
    </div>
  )
}
