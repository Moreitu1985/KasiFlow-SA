function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const env = {
  supabaseUrl: clean(import.meta.env.VITE_SUPABASE_URL),
  supabaseAnonKey: clean(import.meta.env.VITE_SUPABASE_ANON_KEY),
  apiBaseUrl: clean(import.meta.env.VITE_API_BASE_URL).replace(/\/+$/, ''),
  /** Customers can also sign in with a code sent by SMS. Off until an SMS provider is configured in Supabase. */
  customerSmsOtp: clean(import.meta.env.VITE_CUSTOMER_SMS_OTP) === 'true',
  /** Local demos only: lets the demo customer accounts (created by `dotnet run -- demo-users`) sign in with a password. */
  demoPasswordSignIn: clean(import.meta.env.VITE_DEMO_PASSWORD_SIGNIN) === 'true',
}

export interface EnvCheck {
  name: string
  present: boolean
  purpose: string
}

export const envChecks: EnvCheck[] = [
  { name: 'VITE_SUPABASE_URL', present: env.supabaseUrl.length > 0, purpose: 'Your Supabase project URL, used for sign-in.' },
  {
    name: 'VITE_SUPABASE_ANON_KEY',
    present: env.supabaseAnonKey.length > 0,
    purpose: 'The Supabase anon (publishable) key. Never use the service_role key here.',
  },
  { name: 'VITE_API_BASE_URL', present: env.apiBaseUrl.length > 0, purpose: 'Base URL of the KasiFlow SA API, e.g. http://localhost:5080.' },
]

export const isConfigured = envChecks.every((c) => c.present)
