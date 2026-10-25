import { Callout } from './Callout'

/** Shown when the API marks a forecast as preliminary (too little recorded history). */
export function PreliminaryCallout({ isPreliminary, reason, className }: { isPreliminary?: boolean; reason?: string | null; className?: string }) {
  if (!isPreliminary) return null
  return (
    <Callout tone="warning" title="Preliminary forecast" className={className}>
      {reason ?? 'There is not enough recorded history yet, so treat this forecast as a rough guide.'}
    </Callout>
  )
}
