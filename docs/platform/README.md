# Developify Platform

Developify consists of a Flutter mobile app, a NestJS API, and a Next.js admin
dashboard. Supabase Auth provides identity; the API uses Supabase for
application data and private file storage. The mobile client uses the
publishable Supabase key and API; the Supabase service-role key is backend-only.
Remote push notifications are not configured.

## Local development

1. Copy `backend/.env.example` to `backend/.env` and set `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` from the Supabase project. Keep the service-role
   key outside source control.
2. In `backend`, run `npm ci`, then `npm run start:dev`. The API listens on
   port 3000 at `/v1`; Swagger is available at `/docs`.
3. Set the admin's `NEXT_PUBLIC_API_URL` to `http://localhost:3000/v1`, then
   run `npm run dev` from `admin`.
4. For Flutter live mode, set `MOCK_MODE=false` and `API_BASE_URL` to the
   backend origin. Supabase Auth settings must allow the app's configured
   callback URL.

## Render API deployment

Use `backend` as the service root directory, `npm ci && npm run build` as the
build command, and `npm run start:prod` as the start command. Configure
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_ORIGIN`, and
`API_PUBLIC_URL` in Render's environment settings. Never place the
service-role key in the mobile app, admin bundle, Git, or a build-time
variable.

## Admin deployment

Use `admin` as the root directory and `npm run build` as the build command.
Set `NEXT_PUBLIC_API_URL` to the deployed API URL ending in `/v1`, then set
Render's `ADMIN_ORIGIN` to the deployed admin origin and redeploy the API so
browser requests pass CORS.

## Operational limits

Payments and KYC are manual phase-one workflows. A deployed service is not
evidence that live-money payment, KYC, email, or regulatory integrations are
configured or approved.
