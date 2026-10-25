import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

const overlayClass =
  'fixed inset-0 z-50 bg-forest-950/40 backdrop-blur-[1px] data-[state=open]:animate-[fade-in_150ms_ease-out]'

interface ContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /** `dialog` is centred; `sheet` slides in from the right on desktop and from the bottom on phones. */
  variant?: 'dialog' | 'sheet' | 'drawer-left'
  hideClose?: boolean
}

export const DialogContent = React.forwardRef<React.ComponentRef<typeof DialogPrimitive.Content>, ContentProps>(
  ({ className, children, variant = 'dialog', hideClose, ...props }, ref) => (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClass} />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed z-50 flex flex-col bg-surface text-ink shadow-raised focus:outline-none data-[state=open]:animate-rise-in',
          variant === 'dialog' &&
            'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-lg sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[88dvh] sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg',
          variant === 'sheet' &&
            'inset-x-0 bottom-0 max-h-[94dvh] rounded-t-lg sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-full sm:max-w-xl sm:rounded-none',
          variant === 'drawer-left' && 'inset-y-0 left-0 w-[86vw] max-w-80',
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            className="absolute top-3.5 right-3.5 rounded-md p-1.5 text-ink-muted transition-colors hover:bg-forest-50 hover:text-ink cursor-pointer"
            aria-label="Close"
          >
            <X className="size-5" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  ),
)
DialogContent.displayName = 'DialogContent'

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 border-b border-line px-5 pt-5 pb-4 pr-12', className)} {...props} />
}

export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex-1 overflow-y-auto px-5 py-5', className)} {...props} />
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 border-t border-line bg-paper/60 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  )
}

export const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('font-display text-lg font-semibold text-ink', className)} {...props} />
))
DialogTitle.displayName = 'DialogTitle'

export const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-sm text-ink-muted', className)} {...props} />
))
DialogDescription.displayName = 'DialogDescription'
