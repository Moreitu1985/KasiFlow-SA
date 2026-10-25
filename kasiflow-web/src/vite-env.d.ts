/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_API_BASE_URL?: string
  readonly VITE_CUSTOMER_SMS_OTP?: string
  readonly VITE_DEMO_PASSWORD_SIGNIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
