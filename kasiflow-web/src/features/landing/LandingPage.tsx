import { Link } from 'react-router-dom'
import { BookOpen, ChevronRight, ClipboardCheck, LineChart, Search, ShieldCheck, Sprout, Store, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/AuthProvider'
import { useBusiness } from '@/features/business/BusinessProvider'
import { appIcon } from '@/layouts/nav'
import { InstallButton } from '@/features/pwa/InstallButton'

const STAGES: { name: string; icon: LucideIcon; body: string; detail: string }[] = [
  {
    name: 'Capture',
    icon: BookOpen,
    body: 'Record sales, expenses, money customers owe you and bills you owe suppliers — from your phone, in seconds.',
    detail: 'Cash book · Customers & debts · Suppliers & bills',
  },
  {
    name: 'Understand',
    icon: LineChart,
    body: 'See your cash balance, what came in and went out, and a day-by-day forecast of where your cash is heading.',
    detail: 'Overview · Cash-flow forecast · Reports',
  },
  {
    name: 'Protect',
    icon: ShieldCheck,
    body: 'Learn the warning signs of fake proof of payment, changed bank details and upfront-fee scams. Keep a private incident log.',
    detail: 'Fraud protection · Pre-payment checklist',
  },
  {
    name: 'Prepare',
    icon: ClipboardCheck,
    body: 'Work through registration steps with links to official sources, and get your records ready for funders and tenders.',
    detail: 'Registration guidance · Funding readiness · Business summary',
  },
  {
    name: 'Grow',
    icon: Sprout,
    body: 'Get specific, explained recommendations from your own records, and track funding and market opportunities.',
    detail: 'Growth Engine · Opportunities · Public profile',
  },
]

const APPS = [
  { key: 'customer', title: 'Customer app', body: 'Find a barber, book a chair or a house call, or join the walk-in queue from your phone.' },
  { key: 'staff', title: 'Barber app', body: 'My next customer, the walk-in queue, house-call safety and my earnings.' },
  { key: 'cashier', title: 'Front desk app', body: 'The walk-in queue, bookings, payments and the cash drawer.' },
  { key: 'branch_manager', title: 'Manager app', body: 'Today on the floor: walk-ins, requests, the team and the house-call map.' },
  { key: 'owner', title: 'Owner app', body: 'Shop insights, barber pay, forecasts and growth. Only the owner sees them.' },
]

export function LandingPage() {
  const { session } = useAuth()
  const { businesses } = useBusiness()
  return (
    <div>
      {/* Hero: two doors, one for customers and one for shop owners */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 pt-12 pb-16 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:pt-16 lg:pb-20">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-forest-800">For kasi barbershops and the people who sit in their chairs</p>
            <h1 className="mt-3 text-[2.4rem] leading-[1.02] font-bold tracking-tight text-heading sm:text-6xl lg:text-[4rem]">
              <span className="block">Book a chair.</span>
              <span className="block">Run the shop.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-soft">
              Customers find a barber, see real prices and real work, and book a visit or a house call. Shops run bookings, the floor, cash-ups and
              their money, with an app for every person on the team.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <Link to="/c/shops" className="group flex min-h-40 flex-col rounded-2xl bg-forest-900 p-5 text-white shadow-raised transition-colors hover:bg-forest-950">
                <span className="flex size-11 items-center justify-center rounded-full bg-emerald-brand text-forest-950" aria-hidden>
                  <Search className="size-5" />
                </span>
                <span className="mt-4 font-display text-2xl font-bold">Find a barber</span>
                <span className="mt-1 text-[15px] leading-snug text-cream">See prices, barbers and their work, then book.</span>
                <span className="mt-auto inline-flex items-center gap-1 pt-3 text-sm font-semibold text-gold group-hover:underline">
                  Browse shops <ChevronRight className="size-4" aria-hidden />
                </span>
              </Link>
              <Link
                to={session && businesses.length > 0 ? '/start' : '/sign-up'}
                className="group flex min-h-40 flex-col rounded-2xl border border-line-strong bg-surface p-5 shadow-card transition-colors hover:border-forest-700/50 hover:bg-forest-50/50"
              >
                <span className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-fg" aria-hidden>
                  <Store className="size-5" />
                </span>
                <span className="mt-4 font-display text-2xl font-bold text-heading">I own a shop</span>
                <span className="mt-1 text-[15px] leading-snug text-ink-soft">Bookings, your team, cash-ups and your numbers.</span>
                <span className="mt-auto inline-flex items-center gap-1 pt-3 text-sm font-semibold text-forest-800 group-hover:underline">
                  {session && businesses.length > 0 ? 'Open my shop' : 'Set up my shop for free'} <ChevronRight className="size-4" aria-hidden />
                </span>
              </Link>
            </div>
            <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <Link to={session ? '/c' : '/c/sign-in'} className="inline-flex min-h-11 items-center font-semibold text-forest-800 hover:underline">
                Already booked? See my bookings
              </Link>
              {!session && (
                <Link to="/sign-in" className="inline-flex min-h-11 items-center font-semibold text-forest-800 hover:underline">
                  Shop team sign in
                </Link>
              )}
            </p>
            <InstallButton variant="outline" className="mt-2" label="Install the app on this phone" />
          </div>

          {/* One shop, one app per person */}
          <figure className="relative min-w-0">
            <div className="kasi-band absolute -top-3 right-6 left-6 h-3 rounded-t-md" aria-hidden />
            <div className="relative rounded-2xl border border-line bg-surface p-5 shadow-raised sm:p-6">
              <figcaption className="font-display text-xl leading-snug font-semibold text-ink">One shop, an app for each person</figcaption>
              <p className="mt-1 text-[14px] text-ink-muted">Everyone opens KasiFlow and sees only what their job needs.</p>
              <ul className="mt-5 divide-y divide-line">
                {APPS.map((x) => {
                  const Icon = appIcon(x.key)
                  return (
                    <li key={x.key} className="flex items-start gap-3 py-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-forest-50 text-heading" aria-hidden>
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-semibold">{x.title}</span>
                        <span className="block text-[14px] leading-snug text-ink-soft">{x.body}</span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          </figure>
        </div>
      </section>

      {/* Five stages */}
      <section aria-labelledby="stages-title" className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 id="stages-title" className="max-w-2xl text-3xl font-bold sm:text-4xl">
            Five stages, from the first sale you record to your next big step
          </h2>
          <ol className="mt-10 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
            {STAGES.map((s, i) => (
              <li key={s.name} className="flex flex-col bg-surface p-5">
                <div className="flex items-center gap-2">
                  <span className="font-display text-sm font-bold text-ochre">{i + 1}</span>
                  <s.icon className="size-5 text-forest-800" aria-hidden />
                </div>
                <h3 className="mt-3 text-xl font-bold">{s.name}</h3>
                <p className="mt-2 flex-1 text-[15px] leading-relaxed text-ink-soft">{s.body}</p>
                <p className="mt-4 text-[13px] text-ink-muted">{s.detail}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Growth Engine */}
      <section aria-labelledby="engine-title" className="bg-forest-900 text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.3fr]">
          <div>
            <h2 id="engine-title" className="text-3xl font-bold text-white sm:text-4xl">
              The Growth Engine: rules, not guesses
            </h2>
            <p className="mt-4 text-[17px] leading-relaxed text-cream">
              Recommendations come from fixed, published rules applied to your own records. No AI is guessing about your business.
            </p>
          </div>
          <dl className="grid gap-6 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            {[
              ['Same records, same answer', 'Each rule is a calculation. Run it twice on the same data and you get the same result.'],
              ['Every finding shows its evidence', 'Recommendations list the transactions, debts and bills that triggered them, with links to each one.'],
              ['You stay in charge', 'Suggestions support your decisions. They can help, but they cannot guarantee an outcome.'],
            ].map(([t, d]) => (
              <div key={t} className="border-t-2 border-emerald-brand pt-4">
                <dt className="font-semibold text-white">{t}</dt>
                <dd className="mt-1.5 text-[15px] leading-relaxed text-cream">{d}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Honest limits */}
      <section aria-labelledby="limits-title" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <h2 id="limits-title" className="text-3xl font-bold">
              What KasiFlow is — and isn’t
            </h2>
            <p className="mt-4 text-[17px] leading-relaxed text-ink-soft">
              It works with the numbers you record. It does not connect to your bank, so it never claims a payment is confirmed unless you say so.
            </p>
          </div>
          <ul className="space-y-3 text-[15px] leading-relaxed">
            {[
              'Not a bank or payment app — it never moves your money.',
              'Not a credit score — funding readiness is a checklist of common documents and records.',
              'Not audited accounts — “net recorded result” is income minus expenses you recorded.',
              'Not a guarantee — forecasts and recommendations are planning aids.',
              'Opportunities are labelled clearly: verified from an official source, requires verification, or sample.',
            ].map((t) => (
              <li key={t} className="flex gap-3 rounded-md border border-line bg-surface px-4 py-3">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-ochre" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>
        {!session && (
          <div className="mt-14 flex flex-col items-start gap-4 rounded-lg border border-line bg-surface p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div>
              <p className="font-display text-2xl font-bold">Start with today’s sales.</p>
              <p className="mt-1 text-ink-soft">Set up takes a few minutes. You only need an email address.</p>
            </div>
            <Button asChild size="lg">
              <Link to="/sign-up">Create a free account</Link>
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
