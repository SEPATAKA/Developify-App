# Developify security model (phase 1)

## Authentication

- Firebase Authentication email/password accounts and verified Firebase ID tokens
- Firebase Admin verifies tokens server-side and enforces account state
- Admin roles are read from protected `adminUsers` Firestore documents

## Authorization

- Portal membership (`investor` / `landowner`) and investor entity scope are enforced server-side
- Admin RBAC: `admin`, `ops`, `compliance`
- Resource ownership checks on wallet/KYC/property access

## Financial

- Firestore ledger entries in integer cents
- Idempotency keys on invest / deposit / withdraw
- Capacity and ledger writes use Firestore transactions
- Transaction PIN verified server-side on money writes
- No card PAN/CVV storage; card add rejected until Paystack adapter configured

## Data protection

- Document uploads use short-lived signed URLs for Firebase Storage
- Firestore client rules are restrictive; the backend Admin SDK is separately authorized by service-account IAM
- Soft-delete field on documents for retention workflows
- Audit log for admin actions and settlement confirmations
- HTTPS required for non-localhost API base URLs in the mobile client

## Operational

- Rate limiting via Nest Throttler
- CORS locked to `ADMIN_ORIGIN`
- Secrets only via environment variables
