import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { TransactionType } from '@/types/api'
const TransactionFormDialog = lazy(() => import('./TransactionFormDialog').then((m) => ({ default: m.TransactionFormDialog })))

interface RecordCtx {
  openRecord: (type: TransactionType) => void
}

const Ctx = createContext<RecordCtx | null>(null)

/** Lets any screen (dashboard quick actions, mobile Record button) open the transaction form. */
export function RecordProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; type: TransactionType }>({ open: false, type: 'income' })
  // Load the form code on first use only.
  const [used, setUsed] = useState(false)
  const openRecord = useCallback((type: TransactionType) => {
    setUsed(true)
    setState({ open: true, type })
  }, [])
  const value = useMemo(() => ({ openRecord }), [openRecord])
  return (
    <Ctx.Provider value={value}>
      {children}
      {used && (
        <Suspense fallback={null}>
          <TransactionFormDialog open={state.open} defaultType={state.type} onOpenChange={(open) => setState((s) => ({ ...s, open }))} />
        </Suspense>
      )}
    </Ctx.Provider>
  )
}

export function useRecord(): RecordCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useRecord must be used inside RecordProvider')
  return ctx
}
