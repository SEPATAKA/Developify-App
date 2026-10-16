# Developify security model

## Authentication and authorization

- Supabase Auth issues user access tokens; the API verifies them with Supabase.
- The API enforces user, portal-membership, entity-scope, and admin-role
  authorization before protected operations.
- Resource ownership checks protect wallet, KYC, property, and document
  operations.

## Financial

- Ledger amounts are represented as integer cents.
- Money writes use server-side authorization and idempotency checks.
- Transaction PINs are verified server-side.
- Card PAN/CVV values are not stored; card deposits require a configured
  payment-provider integration.

## Data protection

- Private uploads use short-lived signed Supabase Storage URLs.
- Supabase service-role credentials are backend-only secrets.
- Soft-delete and audit fields support retention and administrative review.
- HTTPS is required for non-local API URLs in the mobile client.

## Operational

- API rate limiting uses Nest Throttler.
- CORS is restricted to configured `ADMIN_ORIGIN` values.
- Secrets are supplied through deployment secret stores and environment
  variables, never committed to source.
