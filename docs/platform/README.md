# Developify Platform

Developify consists of a Flutter mobile app, a NestJS API, and a Next.js admin dashboard. Firebase Authentication provides identity and Cloud Firestore stores application data. Firebase Storage is the intended document store, but this project's Storage service is not enabled. The API does not use PostgreSQL, Redis, or S3.

## Local API

1. In Firebase Console, select project `developify-5615a`, confirm Email/Password sign-in is enabled, and confirm the existing Firestore database. Do not create a replacement database.
2. Copy `backend/.env.example` to `backend/.env`. Configure `FIREBASE_PROJECT_ID` and server-only Firebase credentials. Set `FIREBASE_STORAGE_BUCKET` only if Storage is later enabled. For a local service-account file, keep it outside the repository and set `FIREBASE_SERVICE_ACCOUNT_PATH`.
3. In `backend`, install dependencies and run `npm run start:dev`. No SQL migration or seed command is required.
4. Start the admin dashboard with `npm run dev -- --port 3001` from `admin`; its local Firebase configuration defaults to `developify-5615a`.

The API listens on port 3000 at `/v1`; Swagger is at `/docs`. For Flutter live mode, set `MOCK_MODE=false`, `FIREBASE_ENABLED=true`, and `API_BASE_URL` to the API URL.

## Firebase configuration deployment

The Firebase CLI configuration, Firestore rules, and indexes are in `developify-mobile`. Before deploying, compare `firestore.rules` with the rules currently published in Firebase Console: `firebase deploy --only firestore --project developify-5615a` replaces the deployed rules and indexes for this project. The checked-in rules deny client writes and allow an authenticated user to read only their own `/users/{uid}` document. The Admin SDK used by the backend operates under its service-account IAM permissions and does not rely on client Firestore rules.

## Render API deployment

The Render web service uses `backend` as its Root Directory, `npm install && npm run build` as its build command, and `npm run start:prod` as its start command. Set `PORT` through Render and configure:

- `FIREBASE_PROJECT_ID=developify-5615a`
- `FIREBASE_STORAGE_BUCKET` to the bucket name shown in Firebase Console if Storage is enabled with approved billing
- `FIREBASE_SERVICE_ACCOUNT_JSON` as a Render secret, or use Google Application Default Credentials where supported
- `ADMIN_ORIGIN` to the deployed admin origin (comma-separated if multiple origins are needed)
- `API_PUBLIC_URL` to the Render HTTPS URL

Firebase Storage is not currently enabled for this project; the console says a Blaze billing account is required. Do not upgrade billing without the owner's approval. Until Storage is enabled and `FIREBASE_STORAGE_BUCKET` is set, document uploads will return an explicit service-unavailable response. Never place a service-account key in the mobile app, admin bundle, Git, or a build-time variable.

## Vercel admin deployment

Use `admin` as the Root Directory and `npm run build` as the build command. Set `NEXT_PUBLIC_API_URL` to the Render API URL ending in `/v1`. The client Firebase settings use `NEXT_PUBLIC_FIREBASE_*` variables and default to the public app configuration for `developify-5615a`. After deployment, set Render's `ADMIN_ORIGIN` to the actual Vercel origin and redeploy the API so browser requests pass CORS.

## Operational limits

Payments and KYC are manual phase-one workflows. A deployed service is not evidence that live-money payment, KYC, email, or regulatory integrations are configured or approved.
