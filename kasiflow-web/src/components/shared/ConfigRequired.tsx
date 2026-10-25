import { CheckCircle2, XCircle } from 'lucide-react'
import { envChecks } from '@/lib/env'
import { Wordmark } from './Logo'

/** Shown instead of the app when required environment variables are missing. */
export function ConfigRequired() {
  return (
    <div className="min-h-dvh">
      <div className="kasi-band h-2" aria-hidden />
      <main className="mx-auto max-w-2xl px-4 py-12 sm:py-20">
        <Wordmark />
        <h1 className="mt-10 text-3xl font-bold">Configuration required</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
          This KasiFlow SA frontend is missing settings it needs to sign people in and reach the API. Add the variables below to a{' '}
          <code className="rounded bg-forest-50 px-1.5 py-0.5 text-[13px]">.env.local</code> file (or your hosting provider’s environment settings), then
          restart or rebuild the app.
        </p>
        <ul className="mt-8 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {envChecks.map((c) => (
            <li key={c.name} className="flex gap-3 px-4 py-4">
              {c.present ? (
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-700" aria-label="Set" />
              ) : (
                <XCircle className="mt-0.5 size-5 shrink-0 text-red-700" aria-label="Missing" />
              )}
              <div className="min-w-0">
                <p className="font-semibold break-all">
                  {c.name} <span className={`ml-1 text-[13px] font-medium ${c.present ? 'text-emerald-800' : 'text-red-700'}`}>{c.present ? 'set' : 'missing'}</span>
                </p>
                <p className="text-sm text-ink-muted">{c.purpose}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-6 overflow-x-auto rounded-lg bg-forest-950 p-4 text-[13px] leading-relaxed text-cream">
          <pre>{`VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
VITE_API_BASE_URL=http://localhost:5080`}</pre>
        </div>
        <p className="mt-4 text-sm text-ink-muted">
          Use only the Supabase anon / publishable key. Never put a service_role key in a frontend. See <code>.env.example</code> in the project.
        </p>
      </main>
    </div>
  )
}
