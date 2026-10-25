import { Scissors } from 'lucide-react'
import { cn, initialsOf } from '@/lib/utils'

/**
 * A shop's cover: its own public photo when it has one, otherwise a drawn placeholder (initials on the brand's
 * forest with the kasi band) — never a stock photo that could be mistaken for the shop.
 */
export function ShopCover({ name, src, className }: { name: string; src: string | null; className?: string }) {
  if (src)
    return (
      <div className={cn('relative overflow-hidden bg-forest-900', className)}>
        <img src={src} alt="" loading="lazy" className="size-full object-cover" />
      </div>
    )
  return (
    <div className={cn('relative flex items-center justify-center overflow-hidden bg-[#2a2a2f]', className)} aria-hidden>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgb(16_185_129/0.28),transparent_55%),radial-gradient(circle_at_85%_90%,rgb(224_164_58/0.25),transparent_50%)]" />
      <Scissors className="absolute top-3 right-3 size-5 text-white/35" />
      <span className="relative font-display text-5xl font-bold tracking-tight text-white">{initialsOf(name) || '•'}</span>
      <div className="kasi-band absolute inset-x-0 bottom-0 h-2.5" />
    </div>
  )
}
