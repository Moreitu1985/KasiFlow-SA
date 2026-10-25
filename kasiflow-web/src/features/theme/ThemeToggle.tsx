import { Check, Download, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ThemePref } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { useInstallPrompt } from '@/features/pwa/install'
import { IosInstallHint } from '@/features/pwa/InstallButton'
import { useState } from 'react'
import { useTheme } from './ThemeProvider'

const OPTIONS: { value: ThemePref; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Night shift', icon: Moon },
]

/** Three-way switch (System / Light / Night shift) for the sidebar and settings-like places. */
export function ThemeSegmented({ tone = 'light', compact, className }: { tone?: 'light' | 'dark'; compact?: boolean; className?: string }) {
  const { pref, setPref } = useTheme()
  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn('grid grid-cols-3 gap-1 rounded-lg border p-1', tone === 'dark' ? 'border-white/10 bg-forest-950/40' : 'border-line bg-paper', className)}
    >
      {OPTIONS.map((o) => {
        const on = pref === o.value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setPref(o.value)}
            className={cn(
              compact ? 'flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md text-[12px] font-semibold transition-colors' : 'flex min-h-11 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md text-[11px] font-semibold transition-colors',
              tone === 'dark'
                ? on
                  ? 'bg-emerald-brand text-forest-950'
                  : 'text-cream/80 hover:bg-white/8 hover:text-white'
                : on
                  ? 'bg-primary text-primary-fg'
                  : 'text-ink-soft hover:bg-tint',
            )}
          >
            <o.icon className={compact ? 'size-3.5' : 'size-4'} aria-hidden />
            {o.value === 'dark' ? 'Night' : o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Icon button for headers: theme choice plus "Install app" when the browser offers it. */
export function ThemeMenuButton({ className }: { className?: string }) {
  const { pref, theme, setPref } = useTheme()
  const install = useInstallPrompt()
  const [iosHint, setIosHint] = useState(false)
  const Icon = theme === 'dark' ? Moon : Sun
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn('flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-tint hover:text-ink', className)}
          aria-label="Theme and app"
        >
          <Icon className="size-5" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          {OPTIONS.map((o) => (
            <DropdownMenuItem key={o.value} onSelect={() => setPref(o.value)} aria-checked={pref === o.value} role="menuitemradio">
              <o.icon aria-hidden />
              <span className="flex-1">{o.label}</span>
              <Check className={cn(pref === o.value ? 'opacity-100' : 'opacity-0')} aria-hidden />
            </DropdownMenuItem>
          ))}
          {(install.canInstall || install.showIosHint) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => (install.canInstall ? void install.install() : setIosHint(true))}>
                <Download aria-hidden /> Install KasiFlow on this phone
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <IosInstallHint open={iosHint} onOpenChange={setIosHint} />
    </>
  )
}
