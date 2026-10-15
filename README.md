# Developify Platform

Full-stack Developify workspace: accepted Flutter mobile app, NestJS production API, and Next.js admin dashboard.

## Packages

| Directory | Description |
| --- | --- |
| [developify-mobile](developify-mobile/) | Flutter Investor + Landowner app (UI frozen; API adapters added) |
| [backend](backend/) | NestJS API; Supabase Auth, PostgreSQL and Storage for identity and application data |
| [admin](admin/) | Next.js admin / ops dashboard |
| [docs/platform](docs/platform/) | Platform setup and staging runbook |

## Default mode

Mobile uses mock repositories only when `MOCK_MODE=true`. For live Supabase-backed accounts and API data, configure `API_BASE_URL`, keep `MOCK_MODE=false`, and set the Supabase project URL and publishable key. Configure the backend service-role key only in the backend environment.

To connect live services, see [docs/platform/README.md](docs/platform/README.md).

## Stack

- **Mobile:** Flutter, MobX, go_router, Dio, GetIt
- **API:** NestJS, Supabase Auth, PostgreSQL/JSONB, Supabase Storage, JWT
- **Admin:** Next.js 15 App Router
- **Money:** integer cents (ZAR), idempotent ledger writes
- **Payments / KYC (phase 1):** manual EFT + admin review; provider adapter stubs ready
