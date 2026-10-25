import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { BusinessProvider } from '@/features/business/BusinessProvider'
import { ThemeProvider, useTheme } from '@/features/theme/ThemeProvider'
import { queryClient } from './queryClient'
import { router } from './router'

function ThemedToaster() {
  const { theme } = useTheme()
  return <Toaster position="top-center" richColors closeButton theme={theme} toastOptions={{ classNames: { toast: 'font-sans' } }} />
}

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BusinessProvider>
            <TooltipProvider delayDuration={150}>
              <RouterProvider router={router} />
              <ThemedToaster />
            </TooltipProvider>
          </BusinessProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
