import { MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/shared/CopyButton'
import { formatDateTime } from '@/lib/format'
import { inviteMessageFor, inviteUrl, whatsappShareUrl } from '@/lib/customer'
import { useBusiness } from '@/features/business/BusinessProvider'

/** The barber's login link, with Copy and a WhatsApp share. Honest about delivery: KasiFlow sends nothing itself. */
export function InviteLinkResult({ name, email, invitePath, inviteMessage, expiresAt }: { name: string; email?: string | null; invitePath: string; inviteMessage?: string | null; expiresAt?: string | null }) {
  const { activeBusiness } = useBusiness()
  const link = inviteUrl(window.location.origin, invitePath)
  const message = inviteMessageFor(name, activeBusiness?.name)
  return (
    <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <p className="font-semibold">Send {name.split(' ')[0] || 'them'} this login link</p>
      <p className="text-sm">{inviteMessage ?? 'Share this link yourself: KasiFlow does not send emails or SMS. It works once, only for the invited email.'}</p>
      <p className="text-sm">
        {name.split(' ')[0] || 'They'} must sign up or sign in with {email ? <strong className="[overflow-wrap:anywhere]">{email}</strong> : 'the invited email'}.
        {expiresAt ? ` Expires ${formatDateTime(expiresAt)}.` : ''}
      </p>
      <p className="rounded bg-surface px-2 py-1.5 font-mono text-[12px] break-all text-ink">{link}</p>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={link} label="Copy link" />
        <Button asChild size="sm" className="bg-[#128C4A] text-white hover:bg-[#0f7a40]">
          <a href={whatsappShareUrl(message, link)} target="_blank" rel="noopener noreferrer">
            <MessageCircle aria-hidden /> Share on WhatsApp
          </a>
        </Button>
      </div>
    </div>
  )
}
