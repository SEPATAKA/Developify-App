# Staging runbook

## Preflight

1. Confirm Firebase project `developify-5615a` is the intended environment, Email/Password authentication is enabled, and the existing Firestore database is available.
2. Compare local `developify-mobile/firestore.rules` and `firestore.indexes.json` with the current Firebase Console configuration before deploying; Firebase CLI deployment overwrites those resources.
3. Configure Firebase service-account credentials as server-only secrets. Grant the API's required Firebase Authentication and Firestore access.
4. Set `FIREBASE_PROJECT_ID`, `API_PUBLIC_URL`, and `ADMIN_ORIGIN`. Set `FIREBASE_STORAGE_BUCKET` only after Storage is enabled with approved billing.
5. Confirm an admin Firebase Authentication account exists and has a corresponding authorized `adminUsers` document in Firestore.

Firebase Console currently reports that Storage requires a Blaze billing account. Do not upgrade billing without approval. Document uploads remain unavailable until Storage is intentionally enabled, the bucket is configured, and the service account can sign upload URLs.

## Deploy

The Render service should use Root Directory `backend`, build command `npm install && npm run build`, and start command `npm run start:prod`. Set `PORT` from the Render environment; the server binds to `0.0.0.0`.

Deploy the existing Firestore configuration only after reviewing the current console rules:

```sh
cd developify-mobile
firebase deploy --only firestore --project developify-5615a
```

No PostgreSQL, Redis, S3, Prisma migration, or SQL seed step is needed. Set Vercel's `NEXT_PUBLIC_API_URL` to the Render URL ending in `/v1`, then set Render's `ADMIN_ORIGIN` to the actual Vercel origin.

## Smoke checks

1. Sign in to the admin portal with its verified Firebase Authentication account.
2. Confirm a protected API request succeeds through the admin dashboard and that unauthorized requests are rejected.
3. Verify the dashboard reads and updates Firestore-backed records.
4. Verify an authenticated upload request returns a short-lived Firebase Storage URL and that a test file reaches the configured bucket.
5. Exercise the manual KYC and deposit-review workflows; do not treat them as verified external provider callbacks.

## Flutter live mode

```sh
--dart-define=MOCK_MODE=false
--dart-define=FIREBASE_ENABLED=true
--dart-define=API_BASE_URL=https://your-render-service.onrender.com
```

## Rollback

1. Revert to the previous known-good API deployment.
2. Restore the previously reviewed Firestore rules and indexes only from a saved, known-good configuration; do not deploy open rules.
