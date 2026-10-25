import { Link, Outlet } from 'react-router-dom'
import { Wordmark } from '@/components/shared/Logo'

export function AuthLayout() {
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="relative hidden w-[42%] max-w-xl flex-col justify-between overflow-hidden bg-forest-900 p-10 text-white lg:flex">
        <Link to="/" aria-label="KasiFlow SA home">
          <Wordmark tone="light" />
        </Link>
        <div>
          <p className="font-display text-[2.6rem] leading-[1.05] font-bold">
            Book a chair.
            <br />
            Run the shop.
          </p>
          <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-cream">
            Bookings, the floor, cash-ups and your numbers for kasi barbershops, with an app for the owner, the manager,
            the front desk and every barber.
          </p>
        </div>
        <div className="kasi-band -mx-10 -mb-10 h-6" aria-hidden />
      </aside>
      <main className="flex flex-1 flex-col">
        <div className="flex items-center justify-between px-4 py-4 sm:px-8 lg:hidden">
          <Link to="/" aria-label="KasiFlow SA home">
            <Wordmark />
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center px-4 py-8 sm:px-8">
          <div className="w-full max-w-sm">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  )
}
