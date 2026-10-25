# KasiFlow SA — web frontend

React 19 + TypeScript (strict) + Vite, Tailwind CSS v4, Radix-based UI components, TanStack Query,
React Hook Form + Zod, Recharts. Supabase is used for authentication only; all business data
comes from the KasiFlow SA API (`docs/API.md`).

## Run locally

```bash
cp .env.example .env.local   # fill in the three values
npm install
npm run dev                  # http://localhost:5173
```

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon / publishable key (never the service_role key) |
| `VITE_API_BASE_URL` | KasiFlow API base URL, e.g. `http://localhost:5080` |
| `VITE_CUSTOMER_SMS_OTP` | Optional, default `false`. `true` shows a "Phone" tab on customer sign-in (needs an SMS provider in Supabase). |

If any variable is missing the app shows a "Configuration required" screen instead of starting.

In Supabase Auth settings, add `<your-origin>/reset-password` and `<your-origin>/sign-in` to the allowed redirect URLs.

Customers sign in with a one-time code (`/c/sign-in`, and inline on `/p/:slug/book`). For the 6-digit code to appear in the
email, the Supabase **Magic Link** email template must include `{{ .Token }}`. The link in that email also signs the customer
in, so add `<your-origin>/c/sign-in` and `<your-origin>/p/*` to the allowed redirect URLs as well. KasiFlow does not send
any SMS or email itself: codes come from Supabase, and barber invite links are shared by the owner (copy / WhatsApp).

## Scripts

`npm run dev` · `npm run build` (type-check + production build) · `npm run typecheck` · `npm run lint` · `npm run preview`

## Layout

- `src/app` — providers, query client, router (route-level code splitting)
- `src/lib` — `apiClient` (auth + `X-Business-Id` headers, RFC 7807 errors, CSV download), `format` (ZAR / dates), env, Supabase client
- `src/types/api.ts` — DTOs typed from the API contract
- `src/features/*` — one folder per area (API hooks + components); `src/pages` are thin lazy route entries
- `src/components/ui` — primitives; `src/components/shared` and `src/components/charts` — shared pieces

Deploys as a static SPA; `vercel.json` rewrites all paths to `index.html`.
