import { cn } from '@/lib/utils'

/** KasiFlow mark: a barber pole on a charcoal tile with brass caps. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-8', className)}>
      <defs>
        <clipPath id="kf-pole">
          <rect x="12" y="7" width="8" height="18" rx="2" />
        </clipPath>
      </defs>
      <rect width="32" height="32" rx="7" fill="currentColor" />
      <g clipPath="url(#kf-pole)">
        <rect x="12" y="7" width="8" height="18" fill="#ffffff" />
        <path d="M4 14l16-10v4L4 18zM4 22l16-10v4L4 26zM4 30l16-10v4L4 34z" fill="#c8102e" />
        <path d="M4 18l16-10v2L4 20zM4 26l16-10v2L4 28z" fill="#1d3557" />
      </g>
      <rect x="11" y="4.5" width="10" height="3" rx="1.5" fill="#d4a64a" />
      <rect x="11" y="24.5" width="10" height="3" rx="1.5" fill="#d4a64a" />
    </svg>
  )
}

export function Wordmark({ className, tone = 'dark' }: { className?: string; tone?: 'dark' | 'light' }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark className={tone === 'light' ? 'text-forest-950' : 'text-forest-900 dark:text-[#2a2a2f]'} />
      <span
        className={cn(
          'font-display text-[1.35rem] leading-none font-bold tracking-tight',
          tone === 'light' ? 'text-white' : 'text-heading',
        )}
      >
        KasiFlow
        <span className={cn('ml-1 text-[0.8rem] font-semibold', tone === 'light' ? 'text-emerald-brand' : 'text-ochre')}>
          SA
        </span>
      </span>
    </span>
  )
}
