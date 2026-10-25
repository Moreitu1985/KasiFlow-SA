import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button, type ButtonProps } from '@/components/ui/button'

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const el = document.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    el.remove()
    return ok
  } catch {
    return false
  }
}

/** Copies text to the clipboard with visible and screen-reader feedback. */
export function CopyButton({ text, label = 'Copy', ...props }: { text: string; label?: string } & Omit<ButtonProps, 'onClick'>) {
  const [done, setDone] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      {...props}
      onClick={async () => {
        const ok = await copyText(text)
        if (ok) {
          setDone(true)
          setTimeout(() => setDone(false), 2000)
        } else toast.error('Could not copy. Select the text and copy it manually.')
      }}
    >
      {done ? <Check aria-hidden /> : <Copy aria-hidden />}
      <span aria-live="polite">{done ? 'Copied' : label}</span>
    </Button>
  )
}
