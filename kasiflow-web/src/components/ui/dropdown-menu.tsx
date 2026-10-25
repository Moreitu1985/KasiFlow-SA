import * as React from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'

export const DropdownMenu = Menu.Root
export const DropdownMenuTrigger = Menu.Trigger
export const DropdownMenuGroup = Menu.Group

export const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof Menu.Content>,
  React.ComponentPropsWithoutRef<typeof Menu.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <Menu.Portal>
    <Menu.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn('z-50 min-w-56 rounded-lg border border-line bg-surface p-1 shadow-raised', className)}
      {...props}
    />
  </Menu.Portal>
))
DropdownMenuContent.displayName = 'DropdownMenuContent'

export const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof Menu.Item>,
  React.ComponentPropsWithoutRef<typeof Menu.Item>
>(({ className, ...props }, ref) => (
  <Menu.Item
    ref={ref}
    className={cn(
      'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-ink outline-none select-none data-[highlighted]:bg-forest-50 [&_svg]:size-4 [&_svg]:text-ink-muted',
      className,
    )}
    {...props}
  />
))
DropdownMenuItem.displayName = 'DropdownMenuItem'

export function DropdownMenuLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-2.5 py-1.5 text-xs font-medium text-ink-muted', className)} {...props} />
}

export function DropdownMenuSeparator() {
  return <Menu.Separator className="my-1 h-px bg-line" />
}
