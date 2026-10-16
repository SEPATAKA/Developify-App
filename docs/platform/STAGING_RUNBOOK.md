# Staging runbook

## Preflight

1. Confirm the Supabase project and its Auth email/password and callback
   settings match the staging environment.
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as backend-only secrets.
   Never put the service-role key in a client build or source control.
3. Set `API_PUBLIC_URL`, `ADMIN_ORIGIN`, and the admin's
   `NEXT_PUBLIC_API_URL` to the staging HTTPS origins.
4. Confirm admin roles and user/entity access controls in Supabase before
   testing privileged workflows.

## Deploy

Configure the Render API with root directory `backend`, build command
`npm ci && npm run build`, and start command `npm run start:prod`. Set the
Vercel admin's `NEXT_PUBLIC_API_URL` to the Render URL ending in `/v1`, then
set Render's `ADMIN_ORIGIN` to the Vercel origin.

Apply database schema changes only through the reviewed Supabase migration
process used by the repository.

## Smoke checks

1. Verify `/docs-json` advertises the Supabase auth-session route.
2. Confirm an invalid auth token is rejected and an authenticated API request
   succeeds with a staging Supabase user.
3. Verify admin access is denied without an authorized role.
4. Verify private document uploads use short-lived Supabase Storage URLs.
5. Exercise manual KYC and deposit-review workflows; do not treat them as
   verified external provider callbacks.

## Flutter live mode

```sh
--dart-define=MOCK_MODE=false
--dart-define=API_BASE_URL=https://your-render-service.onrender.com
```

## Rollback

1. Revert to the previous known-good API deployment.
2. Restore database state only through the reviewed Supabase backup and
   migration process.
