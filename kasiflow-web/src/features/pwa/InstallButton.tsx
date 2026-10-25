import { useState } from 'react'
import { Download, Share, SquarePlus } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useInstallPrompt } from './install'

/** iPhone/iPad: installing is done from Safari's Share menu. */
export function IosInstallHint({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add KasiFlow to your home screen</DialogTitle>
          <DialogDescription>It opens like an app, full screen, with the barber-pole icon.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ol className="space-y-3 text-[15px]">
            <li className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-tint text-forest-800">
                <Share className="size-4" aria-hidden />
              </span>
              <span>
                In Safari, tap <strong>Share</strong> (the square with an arrow).
              </span>
            </li>
            <li className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-tint text-forest-800">
                <SquarePlus className="size-4" aria-hidden />
              </span>
              <span>
                Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
              </span>
            </li>
          </ol>
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** "Install app": shown only when this browser can install it (or on iPhone, as a how-to). */
export function InstallButton({ label = 'Install app', ...props }: Omit<ButtonProps, 'onClick'> & { label?: string }) {
  const { canInstall, showIosHint, install } = useInstallPrompt()
  const [hint, setHint] = useState(false)
  if (!canInstall && !showIosHint) return null
  return (
    <>
      <Button {...props} onClick={() => (canInstall ? void install() : setHint(true))}>
        <Download aria-hidden /> {label}
      </Button>
      <IosInstallHint open={hint} onOpenChange={setHint} />
    </>
  )
}
