import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom'
import { AppLayout } from '@/layouts/AppLayout'
import { AuthLayout } from '@/layouts/AuthLayout'
import { PublicLayout } from '@/layouts/PublicLayout'
import { GuestOnly, ProtectedRoute } from '@/features/auth/ProtectedRoute'
import { RequireBusiness } from '@/features/business/RequireBusiness'
import { RequireAccess } from '@/features/access/RequireAccess'
import { CustomerLayout, RequireCustomer } from '@/features/customer/CustomerLayout'
import { FullPageLoader } from '@/components/shared/FullPageLoader'
import { NotFound, RouteError } from '@/components/shared/NotFound'
import { Skeleton } from '@/components/ui/skeleton'

const Landing = lazy(() => import('@/pages/LandingPage'))
const SignIn = lazy(() => import('@/pages/SignInPage'))
const SignUp = lazy(() => import('@/pages/SignUpPage'))
const ForgotPassword = lazy(() => import('@/pages/ForgotPasswordPage'))
const ResetPassword = lazy(() => import('@/pages/ResetPasswordPage'))
const Onboarding = lazy(() => import('@/pages/OnboardingPage'))
const Dashboard = lazy(() => import('@/pages/DashboardPage'))
const Transactions = lazy(() => import('@/pages/TransactionsPage'))
const TransactionDetail = lazy(() => import('@/pages/TransactionDetailPage'))
const Customers = lazy(() => import('@/pages/CustomersPage'))
const Suppliers = lazy(() => import('@/pages/SuppliersPage'))
const BillDetail = lazy(() => import('@/pages/BillDetailPage'))
const CashFlow = lazy(() => import('@/pages/CashFlowPage'))
const Growth = lazy(() => import('@/pages/GrowthPage'))
const Opportunities = lazy(() => import('@/pages/OpportunitiesPage'))
const Readiness = lazy(() => import('@/pages/ReadinessPage'))
const Fraud = lazy(() => import('@/pages/FraudPage'))
const Reports = lazy(() => import('@/pages/ReportsPage'))
const BusinessSummary = lazy(() => import('@/pages/BusinessSummaryPage'))
const Settings = lazy(() => import('@/pages/SettingsPage'))
const PublicProfile = lazy(() => import('@/pages/PublicProfilePage'))
const Integrations = lazy(() => import('@/pages/IntegrationsPage'))
const Reconciliation = lazy(() => import('@/pages/ReconciliationPage'))
const Staff = lazy(() => import('@/pages/StaffPage'))
const Join = lazy(() => import('@/pages/JoinPage'))
const Shifts = lazy(() => import('@/pages/ShiftsPage'))
const Inventory = lazy(() => import('@/pages/InventoryPage'))
const Briefing = lazy(() => import('@/pages/BriefingPage'))
const Workspace = lazy(() => import('@/pages/WorkspacePage'))
const Floor = lazy(() => import('@/pages/FloorPage'))
const Shops = lazy(() => import('@/pages/ShopsPage'))
const Bookings = lazy(() => import('@/pages/BookingsPage'))
const BookingDetail = lazy(() => import('@/pages/BookingDetailPage'))
const HouseCalls = lazy(() => import('@/pages/HouseCallsPage'))
const Services = lazy(() => import('@/pages/ServicesPage'))
const Payments = lazy(() => import('@/pages/PaymentsPage'))
const Debts = lazy(() => import('@/pages/DebtsPage'))
const DebtAccount = lazy(() => import('@/pages/DebtAccountPage'))
const Expenses = lazy(() => import('@/pages/ExpensesPage'))
const Alerts = lazy(() => import('@/pages/AlertsPage'))
const BusinessProfile = lazy(() => import('@/pages/BusinessProfilePage'))
const Funding = lazy(() => import('@/pages/FundingPage'))
const PublicBooking = lazy(() => import('@/pages/PublicBookingPage'))
const PublicBookingStatus = lazy(() => import('@/pages/PublicBookingStatusPage'))
const CustomerSignIn = lazy(() => import('@/pages/CustomerSignInPage'))
const MyBookings = lazy(() => import('@/pages/MyBookingsPage'))
const CustomerBooking = lazy(() => import('@/pages/CustomerBookingPage'))
const CustomerAccount = lazy(() => import('@/pages/CustomerAccountPage'))
const RegisterBarber = lazy(() => import('@/pages/RegisterBarberPage'))
const Start = lazy(() => import('@/pages/StartPage'))
const Queue = lazy(() => import('@/pages/QueuePage'))
const QueueTicket = lazy(() => import('@/pages/QueueTicketPage'))
const Earnings = lazy(() => import('@/pages/EarningsPage'))
const Payroll = lazy(() => import('@/pages/PayrollPage'))
const HouseCallMap = lazy(() => import('@/pages/HouseCallMapPage'))
const Insights = lazy(() => import('@/pages/InsightsPage'))
const LegacyDebtRedirect = lazy(() => import('@/features/debts/DebtAccountPage').then((m) => ({ default: m.LegacyDebtRedirect })))

function PageFallback() {
  return (
    <div className="space-y-4" aria-busy aria-label="Loading page">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80" />
      <Skeleton className="h-48 w-full" />
    </div>
  )
}

const page = (node: ReactNode) => <Suspense fallback={<PageFallback />}>{node}</Suspense>
const full = (node: ReactNode) => <Suspense fallback={<FullPageLoader />}>{node}</Suspense>

export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      {
        element: <PublicLayout />,
        children: [{ path: '/', element: full(<Landing />) }],
      },
      { path: '/p/:slug', element: full(<PublicProfile />) },
      { path: '/p/:slug/book', element: full(<PublicBooking />) },
      { path: '/p/:slug/booking/:reference', element: full(<PublicBookingStatus />) },
      // A walk-in's queue ticket: works from its private link without signing in.
      { path: '/q/:id', element: full(<QueueTicket />) },
      // Customer app: find a barber (public), one-time-code sign-in, their own bookings. Never RequireBusiness.
      { path: '/c/sign-in', element: full(<CustomerSignIn />) },
      {
        element: <CustomerLayout />,
        children: [
          { path: '/c/shops', element: page(<Shops />) },
          {
            element: (
              <RequireCustomer>
                <Outlet />
              </RequireCustomer>
            ),
            children: [
              { path: '/c', element: page(<MyBookings />) },
              { path: '/c/bookings/:reference', element: page(<CustomerBooking />) },
              { path: '/c/account', element: page(<CustomerAccount />) },
            ],
          },
        ],
      },
      {
        element: (
          <GuestOnly>
            <AuthLayout />
          </GuestOnly>
        ),
        children: [
          { path: '/sign-in', element: page(<SignIn />) },
          { path: '/sign-up', element: page(<SignUp />) },
          { path: '/forgot-password', element: page(<ForgotPassword />) },
        ],
      },
      { element: <AuthLayout />, children: [{ path: '/reset-password', element: page(<ResetPassword />) }] },
      {
        element: (
          <ProtectedRoute>
            <Outlet />
          </ProtectedRoute>
        ),
        children: [
          { path: '/onboarding', element: full(<Onboarding />) },
          // Invitation links: signed-in people only (ProtectedRoute sends others to sign-in and back), no business needed yet.
          { path: '/join', element: full(<Join />) },
          // After sign-in: each role lands on its own home (its Experience's homePath).
          { path: '/start', element: <RequireBusiness>{full(<Start />)}</RequireBusiness> },
          {
            path: '/reports/business-summary',
            element: (
              <RequireBusiness>
                <RequireAccess redirect>{full(<BusinessSummary />)}</RequireAccess>
              </RequireBusiness>
            ),
          },
          {
            element: (
              <RequireBusiness>
                <AppLayout />
              </RequireBusiness>
            ),
            children: [
              { path: '/app', element: page(<Dashboard />) },
              { path: '/dashboard', element: <Navigate to="/app" replace /> },
              { path: '/transactions', element: page(<Transactions />) },
              { path: '/transactions/:id', element: page(<TransactionDetail />) },
              { path: '/customers', element: page(<Customers />) },
              { path: '/customers/debts/:id', element: page(<LegacyDebtRedirect />) },
              { path: '/debts', element: page(<Debts />) },
              { path: '/debts/:id', element: page(<DebtAccount />) },
              { path: '/floor', element: page(<Floor />) },
              { path: '/workspace', element: page(<Workspace />) },
              { path: '/queue', element: page(<Queue />) },
              { path: '/earnings', element: page(<Earnings />) },
              { path: '/payroll', element: page(<Payroll />) },
              { path: '/map', element: page(<HouseCallMap />) },
              { path: '/insights', element: page(<Insights />) },
              { path: '/bookings', element: page(<Bookings />) },
              { path: '/bookings/:id', element: page(<BookingDetail />) },
              { path: '/house-calls', element: page(<HouseCalls />) },
              { path: '/services', element: page(<Services />) },
              { path: '/payments', element: page(<Payments />) },
              { path: '/expenses', element: page(<Expenses />) },
              { path: '/alerts', element: page(<Alerts />) },
              { path: '/business-profile', element: page(<BusinessProfile />) },
              { path: '/funding', element: page(<Funding />) },
              { path: '/suppliers', element: page(<Suppliers />) },
              { path: '/suppliers/bills/:id', element: page(<BillDetail />) },
              { path: '/cash-flow', element: page(<CashFlow />) },
              { path: '/growth', element: page(<Growth />) },
              { path: '/opportunities', element: page(<Opportunities />) },
              { path: '/readiness', element: page(<Readiness />) },
              { path: '/fraud', element: page(<Fraud />) },
              { path: '/reports', element: page(<Reports />) },
              { path: '/settings', element: page(<Settings />) },
              { path: '/integrations', element: page(<Integrations />) },
              { path: '/reconciliation', element: page(<Reconciliation />) },
              { path: '/staff', element: page(<Staff />) },
              { path: '/team/register', element: page(<RegisterBarber />) },
              { path: '/shifts', element: page(<Shifts />) },
              { path: '/inventory', element: page(<Inventory />) },
              { path: '/briefing', element: page(<Briefing />) },
              // Links produced by the API's briefing use these names; older nav names redirect to the new pages.
              { path: '/bills', element: <Navigate to="/suppliers" replace /> },
              { path: '/procurement', element: <Navigate to="/opportunities" replace /> },
              { path: '/business-setup', element: <Navigate to="/readiness" replace /> },
              { path: '/fraud-alerts', element: <Navigate to="/alerts" replace /> },
              { path: '/public-profile', element: <Navigate to="/business-profile" replace /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
])
