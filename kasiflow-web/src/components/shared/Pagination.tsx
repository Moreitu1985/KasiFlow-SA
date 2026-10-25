import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function Pagination({
  page,
  totalPages,
  totalCount,
  onPage,
}: {
  page: number
  totalPages: number
  totalCount: number
  onPage: (page: number) => void
}) {
  if (totalPages <= 1) return <p className="px-1 pt-3 text-[13px] text-ink-muted">{totalCount} total</p>
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 px-1 pt-3">
      <p className="text-[13px] text-ink-muted">
        Page {page} of {totalPages} · {totalCount} total
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft /> Previous
        </Button>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next <ChevronRight />
        </Button>
      </div>
    </nav>
  )
}
